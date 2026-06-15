import { env } from "cloudflare:workers";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth";
import { admin, organization } from "better-auth/plugins";
import { genericOAuth, type GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { vertexAccessControl, vertexAuthRoles } from "@/lib/auth-access-control";
import { storeMicrosoftGraphTokens, type MicrosoftTokenVaultEnv } from "@/lib/microsoft-token-vault";

type EmailAddress = {
  email: string;
  name?: string;
};

type EmailMessage = {
  to: string | EmailAddress | Array<string | EmailAddress>;
  from: string | EmailAddress;
  subject: string;
  html?: string;
  text?: string;
};

type SendEmailBinding = {
  send(message: EmailMessage): Promise<{ messageId: string }>;
};

type AuthEnv = Env & {
  BETTER_AUTH_SECRET?: string;
  EMAIL?: SendEmailBinding;
  MICROSOFT_ENTRA_CLIENT_ID?: string;
  MICROSOFT_ENTRA_CLIENT_SECRET?: string;
  MICROSOFT_ENTRA_TENANT_ID?: string;
};

const internalSignupHeader = "x-vertex-ai-invite-flow";
const microsoftEntraProviderId = "microsoft-entra-id";
const localDevSecret = "vertex-ai-local-dev-secret-change-before-production";
const sender = { email: "noreply@rcormier.dev", name: "VertexAI" };
const sessionExpiresInSeconds = 60 * 60 * 24 * 30;
const sessionUpdateAgeSeconds = 60 * 60 * 24;
const localDevTrustedOrigins = Array.from({ length: 11 }, (_value, index) => {
  const port = 3000 + index;
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}).flat();

function getRuntimeEnv() {
  return env as AuthEnv;
}

export function getAuthSecret() {
  return getRuntimeEnv().BETTER_AUTH_SECRET ?? localDevSecret;
}

export function getMicrosoftEntraProviderId() {
  return microsoftEntraProviderId;
}

export function isMicrosoftEntraConfigured() {
  const runtimeEnv = getRuntimeEnv();
  return Boolean(
    runtimeEnv.MICROSOFT_ENTRA_CLIENT_ID?.trim() &&
    runtimeEnv.MICROSOFT_ENTRA_CLIENT_SECRET?.trim() &&
    runtimeEnv.MICROSOFT_ENTRA_TENANT_ID?.trim(),
  );
}

export function getInternalSignupSecret() {
  return getAuthSecret();
}

export function getAuth(request?: Request) {
  const runtimeEnv = getRuntimeEnv();
  const origin = request ? new URL(request.url).origin : undefined;

  return betterAuth({
    database: runtimeEnv.DB,
    secret: getAuthSecret(),
    baseURL: origin,
    trustedOrigins: origin ? Array.from(new Set([origin, ...localDevTrustedOrigins])) : localDevTrustedOrigins,
    session: {
      expiresIn: sessionExpiresInSeconds,
      updateAge: sessionUpdateAgeSeconds,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
    },
    account: {
      accountLinking: {
        trustedProviders: [microsoftEntraProviderId],
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => {
            if (account.providerId !== microsoftEntraProviderId || !account.accessToken || !account.refreshToken) return;

            const expiresAt = account.accessTokenExpiresAt?.getTime();
            if (!expiresAt) throw new Error("Microsoft Graph access token expiry is required.");

            await storeMicrosoftGraphTokens({
              env: runtimeEnv as MicrosoftTokenVaultEnv,
              userId: account.userId,
              tokens: {
                accessToken: account.accessToken,
                refreshToken: account.refreshToken,
                expiresAt,
                scope: account.scope ?? undefined,
                tokenType: "Bearer",
              },
            });

            return {
              data: {
                ...account,
                accessToken: null,
                refreshToken: null,
                accessTokenExpiresAt: null,
                refreshTokenExpiresAt: null,
              },
            };
          },
        },
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail({
          actionUrl: url,
          to: user.email,
          subject: "Verify your VertexAI email",
          text: `Verify your email address to finish creating your VertexAI account: ${url}`,
          html: `<p>Verify your email address to finish creating your VertexAI account.</p><p><a href="${url}">Verify email</a></p>`,
        });
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;

        const flowSecret = ctx.headers?.get(internalSignupHeader) ?? ctx.request?.headers.get(internalSignupHeader);
        if (flowSecret !== getInternalSignupSecret()) {
          throw new APIError("FORBIDDEN", {
            message: "Accounts can only be created through an administrator invite.",
          });
        }
      }),
    },
    plugins: [
      admin({
        ac: vertexAccessControl,
        adminRoles: ["admin"],
        defaultRole: "contributor",
        roles: vertexAuthRoles,
      }),
      organization({
        ac: vertexAccessControl,
        allowUserToCreateOrganization: false,
        creatorRole: "admin",
        roles: vertexAuthRoles,
      }),
      ...getMicrosoftEntraPlugins(),
      tanstackStartCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof getAuth>;

function getMicrosoftEntraPlugins() {
  const runtimeEnv = getRuntimeEnv();
  const clientId = runtimeEnv.MICROSOFT_ENTRA_CLIENT_ID?.trim();
  const clientSecret = runtimeEnv.MICROSOFT_ENTRA_CLIENT_SECRET?.trim();
  const tenantId = runtimeEnv.MICROSOFT_ENTRA_TENANT_ID?.trim();
  if (!clientId || !clientSecret || !tenantId) return [];
  if (["common", "organizations", "consumers"].includes(tenantId.toLowerCase())) {
    console.warn(
      "Microsoft Entra sign-in is disabled because MICROSOFT_ENTRA_TENANT_ID must be an authorized tenant ID, not a multi-tenant alias.",
    );
    return [];
  }

  const expectedIssuer = microsoftIssuer(tenantId);
  const provider = {
    providerId: microsoftEntraProviderId,
    authorizationUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    userInfoUrl: "https://graph.microsoft.com/oidc/userinfo",
    clientId,
    clientSecret,
    pkce: true,
    disableSignUp: true,
    issuer: expectedIssuer,
    requireIssuerValidation: true,
    scopes: ["openid", "profile", "email", "offline_access", "User.Read"],
    getUserInfo: async (tokens) => {
      validateMicrosoftIdTokenIssuer(tokens.idToken, expectedIssuer);
      const profile = await fetchMicrosoftUserInfo(tokens.accessToken);
      if (!profile.email || !isAllowedMicrosoftAccountEmail(profile.email)) {
        throw new APIError("FORBIDDEN", { message: "Microsoft sign-in is limited to authorized Vertex accounts." });
      }
      return profile;
    },
  } satisfies GenericOAuthConfig;

  return [
    genericOAuth({
      config: [provider],
    }),
  ];
}

function microsoftIssuer(tenantId: string) {
  return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}

function validateMicrosoftIdTokenIssuer(idToken: string | undefined, expectedIssuer: string) {
  if (!idToken) throw new APIError("UNAUTHORIZED", { message: "Microsoft did not return an ID token." });

  const payload = decodeJwtPayload(idToken);
  if (payload.iss !== expectedIssuer) {
    throw new APIError("UNAUTHORIZED", { message: "Microsoft token issuer does not match the authorized tenant." });
  }
}

async function fetchMicrosoftUserInfo(accessToken: string | undefined) {
  if (!accessToken) throw new APIError("UNAUTHORIZED", { message: "Microsoft did not return an access token." });

  const response = await fetch("https://graph.microsoft.com/oidc/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new APIError("UNAUTHORIZED", { message: "Microsoft profile lookup failed." });

  const profile = (await response.json()) as {
    sub?: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    email?: string;
    preferred_username?: string;
    picture?: string;
    email_verified?: boolean;
  };
  if (!profile.sub) throw new APIError("UNAUTHORIZED", { message: "Microsoft profile did not include a subject." });

  return {
    id: profile.sub,
    name: profile.name ?? `${profile.given_name ?? ""} ${profile.family_name ?? ""}`.trim(),
    email: profile.email ?? profile.preferred_username,
    image: profile.picture,
    emailVerified: profile.email_verified ?? false,
  };
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".");
  if (!payload) throw new APIError("UNAUTHORIZED", { message: "Microsoft returned an invalid ID token." });

  try {
    const base64 = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return JSON.parse(atob(base64)) as { iss?: string };
  } catch {
    throw new APIError("UNAUTHORIZED", { message: "Microsoft returned an unreadable ID token." });
  }
}

function isAllowedMicrosoftAccountEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith("@vertexeducation.com");
}

export async function sendAuthEmail({
  actionUrl,
  html,
  subject,
  text,
  to,
}: {
  actionUrl?: string;
  html?: string;
  subject: string;
  text: string;
  to: string;
}) {
  const email = getRuntimeEnv().EMAIL;
  if (!email) {
    console.info(`[auth-email-disabled] ${subject} -> ${to}: ${text}`);
    await recordAuthEmailEvent({ actionUrl, reason: "Cloudflare email binding EMAIL is not configured.", sent: false, subject, to });
    return { sent: false, reason: "Cloudflare email binding EMAIL is not configured.", actionUrl };
  }

  try {
    const result = await email.send({
      to,
      from: sender,
      subject,
      text,
      html,
    });
    await recordAuthEmailEvent({ actionUrl, sent: true, subject, to });
    return { sent: true, messageId: result.messageId };
  } catch (error) {
    console.error("Cloudflare email send failed", error);
    const reason = error instanceof Error ? error.message : "Cloudflare email send failed.";
    await recordAuthEmailEvent({ actionUrl, reason, sent: false, subject, to });
    return {
      sent: false,
      reason,
      actionUrl,
    };
  }
}

async function recordAuthEmailEvent({
  actionUrl,
  reason,
  sent,
  subject,
  to,
}: {
  actionUrl?: string;
  reason?: string;
  sent: boolean;
  subject: string;
  to: string;
}) {
  const runtimeEnv = getRuntimeEnv();
  if (!runtimeEnv.DB) return;

  try {
    await runtimeEnv.DB.prepare(
      "INSERT INTO auth_email_events (id, recipient, subject, action_url, sent, failure_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(`email-${crypto.randomUUID()}`, to.toLowerCase(), subject, actionUrl ?? null, sent ? 1 : 0, reason ?? null, Date.now())
      .run();
  } catch (error) {
    console.error("Failed to record auth email event", error);
  }
}
