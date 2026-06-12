import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { getAuth, getInternalSignupSecret, sendAuthEmail } from "@/lib/auth";
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

export type InviteRole = "admin" | "user" | "viewer";

export type ManagedUserRole = "admin" | "user" | "viewer";

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

async function currentSession() {
  const request = getRequest();
  const session = await getAuth(request).api.getSession({
    headers: request.headers,
  });
  return session as AuthSession | null;
}

async function requireAdmin() {
  const session = await currentSession();
  if (!session) throw new Error("Sign in is required.");
  if (session.user.role !== "admin") throw new Error("Admin privileges are required.");
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
    .bind(id, normalizedEmail, name.trim(), role, hash, invitedByUserId, expiresAt, now)
    .run();

  const link = inviteLink(token);
  const emailResult = await sendAuthEmail({
    actionUrl: link,
    to: normalizedEmail,
    subject: "Your Vertex AI Command Center invite",
    text: `You have been invited to Vertex AI Command Center. Create your account here: ${link}`,
    html: `<p>You have been invited to Vertex AI Command Center.</p><p><a href="${link}">Create your account</a></p><p>This link expires in 7 days.</p>`,
  });

  return { id, email: normalizedEmail, role, inviteLink: link, emailResult };
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

export const getSessionSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  const session = await currentSession();
  if (!session) return null;
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role ?? "user",
      emailVerified: Boolean(session.user.emailVerified),
    },
  };
});

export const getInvitePreview = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const invite = await getValidInvite(data.token);
    return {
      email: invite.email,
      name: invite.name,
      role: invite.role,
      expiresAt: new Date(invite.expiresAt).toLocaleString(),
    };
  });

export const acceptInvite = createServerFn({ method: "POST" })
  .validator((data: { token: string; name: string; password: string }) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    const invite = await getValidInvite(data.token);
    const headers = new Headers(request.headers);
    headers.set("x-ai-command-center-invite-flow", getInternalSignupSecret());

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

    await getDb()
      .prepare('UPDATE "user" SET role = ?, updatedAt = ? WHERE id = ?')
      .bind(invite.role, Date.now(), userId)
      .run();
    await getDb()
      .prepare("UPDATE auth_invites SET accepted_at = ? WHERE id = ?")
      .bind(Date.now(), invite.id)
      .run();

    const verificationEmail = await latestAuthActionUrl(invite.email, "Verify your Vertex AI Command Center email");

    return {
      email: invite.email,
      role: invite.role,
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
    role: user.role === "admin" ? "admin" : user.role === "viewer" ? "viewer" : "user",
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
    const role = data.role === "admin" ? "admin" : data.role === "viewer" ? "viewer" : "user";
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

    const result = await getDb()
      .prepare('DELETE FROM "user" WHERE id = ?')
      .bind(data.userId)
      .run();

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

    await getDb()
      .prepare("UPDATE auth_invites SET revoked_at = ? WHERE id = ?")
      .bind(Date.now(), invite.id)
      .run();

    return { id: invite.id, status: "Revoked" };
  });
