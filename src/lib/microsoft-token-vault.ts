/// <reference path="../../worker-configuration.d.ts" />

const graphTokenKeyPrefix = "graph-token";
const encryptionAlgorithm = "AES-GCM";
const encryptionKeyBytes = 32;
const ivBytes = 12;
const refreshSkewMs = 5 * 60 * 1000;
const defaultTenantId = "organizations";
const defaultGraphScope = "offline_access User.Read";

export type MicrosoftTokenVaultEnv = Env & {
  MICROSOFT_TOKEN_VAULT: KVNamespace;
  TOKEN_VAULT_KEY: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: string;
  MICROSOFT_ENTRA_CLIENT_ID?: string;
  MICROSOFT_ENTRA_CLIENT_SECRET?: string;
  MICROSOFT_ENTRA_TENANT_ID?: string;
};

export type MicrosoftGraphTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
};

type EncryptedTokenRecord = {
  version: 1;
  provider: "microsoft-graph";
  userId: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
  iv: string;
  ciphertext: string;
  updatedAt: number;
};

type EncryptedTokenPayload = {
  accessToken: string;
  refreshToken: string;
};

type MicrosoftTokenRefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export async function storeMicrosoftGraphTokens({
  env,
  userId,
  tokens,
}: {
  env: MicrosoftTokenVaultEnv;
  userId: string;
  tokens: MicrosoftGraphTokenSet;
}) {
  validateTokenSet(tokens);
  const record = await encryptTokenRecord({ env, userId, tokens });
  await env.MICROSOFT_TOKEN_VAULT.put(graphTokenKey(userId), JSON.stringify(record));
}

export async function getMicrosoftGraphTokens({
  env,
  userId,
}: {
  env: MicrosoftTokenVaultEnv;
  userId: string;
}) {
  const record = await getTokenRecord(env, userId);
  if (!record) return null;

  const payload = await decryptTokenRecord(env, record);
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresAt: record.expiresAt,
    scope: record.scope,
    tokenType: record.tokenType,
  } satisfies MicrosoftGraphTokenSet;
}

export async function getValidMicrosoftGraphTokens({
  env,
  userId,
}: {
  env: MicrosoftTokenVaultEnv;
  userId: string;
}) {
  const tokenSet = await getMicrosoftGraphTokens({ env, userId });
  if (!tokenSet) return null;

  if (tokenSet.expiresAt > Date.now() + refreshSkewMs) return tokenSet;

  const refreshedTokens = await refreshMicrosoftGraphTokens({ env, tokenSet });
  await storeMicrosoftGraphTokens({ env, userId, tokens: refreshedTokens });
  return refreshedTokens;
}

export async function deleteMicrosoftGraphTokens({
  env,
  userId,
}: {
  env: MicrosoftTokenVaultEnv;
  userId: string;
}) {
  await env.MICROSOFT_TOKEN_VAULT.delete(graphTokenKey(userId));
}

async function refreshMicrosoftGraphTokens({
  env,
  tokenSet,
}: {
  env: MicrosoftTokenVaultEnv;
  tokenSet: MicrosoftGraphTokenSet;
}) {
  const body = new URLSearchParams({
    client_id: microsoftClientId(env),
    client_secret: microsoftClientSecret(env),
    grant_type: "refresh_token",
    refresh_token: tokenSet.refreshToken,
    scope: tokenSet.scope || defaultGraphScope,
  });

  const response = await fetch(microsoftTokenEndpoint(env), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const result = await response.json<MicrosoftTokenRefreshResponse>();

  if (!response.ok || result.error || !result.access_token) {
    throw new Error(result.error_description || result.error || "Microsoft Graph token refresh failed.");
  }

  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token || tokenSet.refreshToken,
    expiresAt: Date.now() + Math.max(result.expires_in ?? 0, 0) * 1000,
    scope: result.scope || tokenSet.scope,
    tokenType: result.token_type || tokenSet.tokenType,
  } satisfies MicrosoftGraphTokenSet;
}

async function encryptTokenRecord({
  env,
  userId,
  tokens,
}: {
  env: MicrosoftTokenVaultEnv;
  userId: string;
  tokens: MicrosoftGraphTokenSet;
}) {
  const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
  const key = await importEncryptionKey(env.TOKEN_VAULT_KEY);
  const plaintext = new TextEncoder().encode(JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  } satisfies EncryptedTokenPayload));
  const ciphertext = await crypto.subtle.encrypt({ name: encryptionAlgorithm, iv }, key, plaintext);

  return {
    version: 1,
    provider: "microsoft-graph",
    userId,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    tokenType: tokens.tokenType,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    updatedAt: Date.now(),
  } satisfies EncryptedTokenRecord;
}

async function decryptTokenRecord(env: MicrosoftTokenVaultEnv, record: EncryptedTokenRecord) {
  const key = await importEncryptionKey(env.TOKEN_VAULT_KEY);
  const plaintext = await crypto.subtle.decrypt(
    { name: encryptionAlgorithm, iv: base64UrlToBytes(record.iv) },
    key,
    base64UrlToBytes(record.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as EncryptedTokenPayload;
}

async function getTokenRecord(env: MicrosoftTokenVaultEnv, userId: string) {
  const record = await env.MICROSOFT_TOKEN_VAULT.get<EncryptedTokenRecord>(graphTokenKey(userId), "json");
  if (!record || record.version !== 1 || record.provider !== "microsoft-graph") return null;
  return record;
}

function graphTokenKey(userId: string) {
  if (!userId.trim()) throw new Error("A user id is required for Microsoft Graph token storage.");
  return `${graphTokenKeyPrefix}:${encodeURIComponent(userId)}`;
}

function validateTokenSet(tokens: MicrosoftGraphTokenSet) {
  if (!tokens.accessToken || !tokens.refreshToken) {
    throw new Error("Microsoft Graph access and refresh tokens are required.");
  }
  if (!Number.isFinite(tokens.expiresAt) || tokens.expiresAt <= Date.now()) {
    throw new Error("Microsoft Graph token expiry must be a future timestamp.");
  }
}

async function importEncryptionKey(secret: string) {
  const keyBytes = parseEncryptionSecret(secret);
  if (keyBytes.byteLength !== encryptionKeyBytes) {
    throw new Error("TOKEN_VAULT_KEY must decode to exactly 32 bytes for AES-256-GCM.");
  }

  return crypto.subtle.importKey("raw", keyBytes, encryptionAlgorithm, false, ["encrypt", "decrypt"]);
}

function parseEncryptionSecret(secret: string) {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error("TOKEN_VAULT_KEY is required.");

  try {
    return base64UrlToBytes(trimmed);
  } catch {
    return new TextEncoder().encode(trimmed);
  }
}

function microsoftTokenEndpoint(env: MicrosoftTokenVaultEnv) {
  const tenantId = encodeURIComponent(microsoftTenantId(env));
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

function microsoftClientId(env: MicrosoftTokenVaultEnv) {
  const clientId = env.MICROSOFT_ENTRA_CLIENT_ID?.trim() || env.MICROSOFT_CLIENT_ID?.trim();
  if (!clientId) throw new Error("MICROSOFT_ENTRA_CLIENT_ID is required for Microsoft Graph token refresh.");
  return clientId;
}

function microsoftClientSecret(env: MicrosoftTokenVaultEnv) {
  const clientSecret = env.MICROSOFT_ENTRA_CLIENT_SECRET?.trim() || env.MICROSOFT_CLIENT_SECRET?.trim();
  if (!clientSecret) throw new Error("MICROSOFT_ENTRA_CLIENT_SECRET is required for Microsoft Graph token refresh.");
  return clientSecret;
}

function microsoftTenantId(env: MicrosoftTokenVaultEnv) {
  return env.MICROSOFT_ENTRA_TENANT_ID?.trim() || env.MICROSOFT_TENANT_ID?.trim() || defaultTenantId;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
