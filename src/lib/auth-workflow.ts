import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isAdminRole, normalizeVertexRole, type VertexAuthRole } from "@/lib/auth-access-control";
import { getAuth, getInternalSignupSecret, getMicrosoftEntraProviderId, isMicrosoftEntraConfigured, sendAuthEmail } from "@/lib/auth";
import { env } from "cloudflare:workers";

type AuthUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  emailVerified?: boolean;
};

type AuthSession = {
  user: AuthUser;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
};

type AuthSessionSnapshot = {
  user: {
    id: string;
    email: string;
    name: string;
    role: VertexAuthRole;
    emailVerified: boolean;
  };
};

export type InviteRole = VertexAuthRole;

export type ManagedUserRole = VertexAuthRole;

export type ManagedUserRecord = {
  id: string;
  email: string;
  name: string;
  role: ManagedUserRole;
  emailVerified: number | boolean;
  createdAt: number | string;
  updatedAt: number | string;
};

export type InviteRecord = {
  id: string;
  email: string;
  name: string;
  role: InviteRole;
  expiresAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

const testInviteEmail = "rogerleecormier@gmail.com";
const allowedDomain = "vertexeducation.com";
const inviteTtlMs = 7 * 24 * 60 * 60 * 1000;
const emailVerifiedCallbackUrl = "/sign-in?verified=1";

function getDb() {
  const db = (env as Env).DB;
  if (!db) throw new Error("D1 binding DB is required for authentication.");
  return db;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAllowedAccountEmail(email: string) {
  const normalized = normalizeEmail(email);
  return normalized.endsWith(`@${allowedDomain}`) || normalized === testInviteEmail;
}

function inviteId() {
  return `invite-${crypto.randomUUID()}`;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenHash(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requestOrigin() {
  return new URL(getRequest().url).origin;
}

function inviteLink(token: string) {
  return `${requestOrigin()}/accept-invite?token=${encodeURIComponent(token)}`;
}

async function sessionFromRequest(request: Request) {
  const session = await getAuth(request).api.getSession({
    headers: request.headers,
  });
  return session as AuthSession | null;
}

async function currentSession() {
  return sessionFromRequest(getRequest());
}

function toSessionSnapshot(session: AuthSession): AuthSessionSnapshot {
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: normalizeVertexRole(session.user.role),
      emailVerified: Boolean(session.user.emailVerified),
    },
  };
}

const sessionMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  const session = await sessionFromRequest(request);
  return next({ context: { session } });
});

async function requireAdmin() {
  const session = await currentSession();
  if (!session) throw new Error("Sign in is required.");
  if (!isAdminRole(session.user.role)) throw new Error("Admin privileges are required.");
  return session;
}

async function getValidInvite(token: string) {
  const hash = await tokenHash(token);
  const invite = await getDb()
    .prepare(
      "SELECT id, email, name, role, expires_at as expiresAt, accepted_at as acceptedAt, revoked_at as revokedAt, created_at as createdAt FROM auth_invites WHERE token_hash = ? LIMIT 1",
    )
    .bind(hash)
    .first<InviteRecord>();

  if (!invite) throw new Error("Invite link is invalid.");
  if (invite.acceptedAt) throw new Error("Invite link has already been used.");
  if (invite.revokedAt) throw new Error("Invite link has been revoked.");
  if (invite.expiresAt < Date.now()) throw new Error("Invite link has expired.");
  if (!isAllowedAccountEmail(invite.email)) throw new Error(`Only ${allowedDomain} accounts are allowed.`);

  return invite;
}

async function createInviteRecord({
  email,
  invitedByUserId,
  name,
  role,
}: {
  email: string;
  invitedByUserId: string | null;
  name: string;
  role: InviteRole;
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = normalizeVertexRole(role);
  if (!isAllowedAccountEmail(normalizedEmail)) {
    throw new Error(`Only ${allowedDomain} emails are allowed. ${testInviteEmail} is enabled as the configured test account.`);
  }

  const token = randomToken();
  const hash = await tokenHash(token);
  const now = Date.now();
  const expiresAt = now + inviteTtlMs;
  const id = inviteId();

  await getDb()
    .prepare(
      "INSERT INTO auth_invites (id, email, name, role, token_hash, invited_by_user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, normalizedEmail, name.trim(), normalizedRole, hash, invitedByUserId, expiresAt, now)
    .run();

  const link = inviteLink(token);
  const emailResult = await sendAuthEmail({
    actionUrl: link,
    to: normalizedEmail,
    subject: "Your VertexAI invite",
    text: `You have been invited to VertexAI. Create your account here: ${link}`,
    html: `<p>You have been invited to VertexAI.</p><p><a href="${link}">Create your account</a></p><p>This link expires in 7 days.</p>`,
  });

  return { id, email: normalizedEmail, role: normalizedRole, inviteLink: link, emailResult };
}

async function latestAuthActionUrl(email: string, subjectPrefix: string) {
  const row = await getDb()
    .prepare(
      "SELECT action_url as actionUrl, sent, failure_reason as failureReason FROM auth_email_events WHERE recipient = ? AND subject LIKE ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(normalizeEmail(email), `${subjectPrefix}%`)
    .first<{ actionUrl: string | null; sent: number; failureReason: string | null }>();

  return row;
}

export const getSession = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .handler(async ({ context }) => {
    const session = context.session;
    if (!session) return null;
    return toSessionSnapshot(session);
  });

export const getSessionSnapshot = getSession;

export const startMicrosoftSignIn = createServerFn({ method: "POST" }).handler(async () => {
  if (!isMicrosoftEntraConfigured()) throw new Error("Microsoft sign-in is not configured.");

  const request = getRequest();
  const result = await getAuth(request).api.signInWithOAuth2({
    body: {
      providerId: getMicrosoftEntraProviderId(),
      callbackURL: "/",
      errorCallbackURL: "/sign-in?oauthError=1",
      disableRedirect: true,
    },
    headers: request.headers,
  });

  const url = (result as { url?: string }).url;
  if (!url) throw new Error("Microsoft did not return an authorization URL.");
  return { url };
});

export const getInvitePreview = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const invite = await getValidInvite(data.token);
    return {
      email: invite.email,
      name: invite.name,
      role: normalizeVertexRole(invite.role),
      expiresAt: new Date(invite.expiresAt).toLocaleString(),
    };
  });

export const acceptInvite = createServerFn({ method: "POST" })
  .validator((data: { token: string; name: string; password: string }) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    const invite = await getValidInvite(data.token);
    const headers = new Headers(request.headers);
    headers.set("x-vertex-ai-invite-flow", getInternalSignupSecret());

    const result = await getAuth(request).api.signUpEmail({
      body: {
        name: data.name.trim() || invite.name,
        email: invite.email,
        password: data.password,
        callbackURL: emailVerifiedCallbackUrl,
      },
      headers,
    });

    const userId = (result as { user?: { id?: string } }).user?.id;
    if (!userId) throw new Error("Account was not created.");

    const role = normalizeVertexRole(invite.role);
    await getDb().prepare('UPDATE "user" SET role = ?, updatedAt = ? WHERE id = ?').bind(role, Date.now(), userId).run();
    await getDb().prepare("UPDATE auth_invites SET accepted_at = ? WHERE id = ?").bind(Date.now(), invite.id).run();

    const verificationEmail = await latestAuthActionUrl(invite.email, "Verify your VertexAI email");

    return {
      email: invite.email,
      role,
      verificationLink: verificationEmail?.sent ? null : verificationEmail?.actionUrl,
      verificationEmailError: verificationEmail?.sent ? null : verificationEmail?.failureReason,
      message: "Account created. Check your email to verify the address before signing in.",
    };
  });

export const createUserInvite = createServerFn({ method: "POST" })
  .validator((data: { email: string; name: string; role: InviteRole }) => data)
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    return createInviteRecord({
      email: data.email,
      name: data.name,
      role: data.role,
      invitedByUserId: session.user.id,
    });
  });

export const listUserInvites = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const result = await getDb()
    .prepare(
      "SELECT id, email, name, role, expires_at as expiresAt, accepted_at as acceptedAt, revoked_at as revokedAt, created_at as createdAt FROM auth_invites ORDER BY created_at DESC LIMIT 50",
    )
    .all<InviteRecord>();

  return (result.results ?? []).map((invite) => ({
    ...invite,
    role: normalizeVertexRole(invite.role),
    expiresLabel: new Date(invite.expiresAt).toLocaleString(),
    createdLabel: new Date(invite.createdAt).toLocaleString(),
    status: invite.revokedAt ? "Revoked" : invite.acceptedAt ? "Accepted" : invite.expiresAt < Date.now() ? "Expired" : "Pending",
  }));
});

export const listManagedUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const result = await getDb()
    .prepare('SELECT id, email, name, role, emailVerified, createdAt, updatedAt FROM "user" ORDER BY email ASC')
    .all<ManagedUserRecord>();

  return (result.results ?? []).map((user) => ({
    ...user,
    role: normalizeVertexRole(user.role),
    emailVerified: Boolean(user.emailVerified),
    createdLabel: new Date(user.createdAt).toLocaleString(),
    updatedLabel: new Date(user.updatedAt).toLocaleString(),
  }));
});

export const updateManagedUser = createServerFn({ method: "POST" })
  .validator((data: { userId: string; name: string; role: ManagedUserRole }) => data)
  .handler(async ({ data }) => {
    await requireAdmin();
    const name = data.name.trim();
    const role = normalizeVertexRole(data.role);
    if (!name) throw new Error("Name is required.");

    const result = await getDb()
      .prepare('UPDATE "user" SET name = ?, role = ?, updatedAt = ? WHERE id = ?')
      .bind(name, role, Date.now(), data.userId)
      .run();

    if (!result.meta.changes) throw new Error("User was not found.");
    return { id: data.userId, name, role };
  });

export const deleteManagedUser = createServerFn({ method: "POST" })
  .validator((data: { userId: string }) => data)
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    if (data.userId === session.user.id) throw new Error("You cannot delete your own account.");

    const result = await getDb().prepare('DELETE FROM "user" WHERE id = ?').bind(data.userId).run();

    if (!result.meta.changes) throw new Error("User was not found.");
    return { id: data.userId };
  });

export const revokeUserInvite = createServerFn({ method: "POST" })
  .validator((data: { inviteId: string }) => data)
  .handler(async ({ data }) => {
    await requireAdmin();
    const invite = await getDb()
      .prepare("SELECT id, accepted_at as acceptedAt, revoked_at as revokedAt FROM auth_invites WHERE id = ? LIMIT 1")
      .bind(data.inviteId)
      .first<Pick<InviteRecord, "id" | "acceptedAt" | "revokedAt">>();

    if (!invite) throw new Error("Invite was not found.");
    if (invite.acceptedAt) throw new Error("Accepted invites cannot be revoked.");
    if (invite.revokedAt) return { id: invite.id, status: "Revoked" };

    await getDb().prepare("UPDATE auth_invites SET revoked_at = ? WHERE id = ?").bind(Date.now(), invite.id).run();

    return { id: invite.id, status: "Revoked" };
  });
