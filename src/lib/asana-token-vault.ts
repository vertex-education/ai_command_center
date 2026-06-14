/// <reference path="../../worker-configuration.d.ts" />

const asanaTokenKeyPrefix = "asana-token";
const encryptionAlgorithm = "AES-GCM";
const encryptionKeyBytes = 32;
const ivBytes = 12;
const refreshSkewMs = 5 * 60 * 1000;

export type AsanaTokenVaultEnv = Env & {
  MICROSOFT_TOKEN_VAULT: KVNamespace;
  TOKEN_VAULT_KEY: string;
  ASANA_CLIENT_ID?: string;
  ASANA_CLIENT_SECRET?: string;
};

export type AsanaTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
};

type EncryptedAsanaTokenRecord = {
  version: 1;
  provider: "asana";
  userId: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
  iv: string;
  ciphertext: string;
  updatedAt: number;
};

type EncryptedAsanaTokenPayload = {
  accessToken: string;
  refreshToken: string;
};

type AsanaTokenRefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export async function storeAsanaTokens({
  env,
  userId,
  tokens,
}: {
  env: AsanaTokenVaultEnv;
  userId: string;
  tokens: AsanaTokenSet;
}) {
  validateTokenSet(tokens);
  const record = await encryptTokenRecord({ env, userId, tokens });
  await env.MICROSOFT_TOKEN_VAULT.put(asanaTokenKey(userId), JSON.stringify(record));
}

export async function getAsanaTokens({
  env,
  userId,
}: {
  env: AsanaTokenVaultEnv;
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
  } satisfies AsanaTokenSet;
}

export async function getValidAsanaTokens({
  env,
  userId,
}: {
  env: AsanaTokenVaultEnv;
  userId: string;
}) {
  const tokenSet = await getAsanaTokens({ env, userId });
  if (!tokenSet) return null;

  if (tokenSet.expiresAt > Date.now() + refreshSkewMs) return tokenSet;

  const refreshedTokens = await refreshAsanaTokens({ env, tokenSet });
  await storeAsanaTokens({ env, userId, tokens: refreshedTokens });
  return refreshedTokens;
}

export async function deleteAsanaTokens({
  env,
  userId,
}: {
  env: AsanaTokenVaultEnv;
  userId: string;
}) {
  await env.MICROSOFT_TOKEN_VAULT.delete(asanaTokenKey(userId));
}

async function refreshAsanaTokens({
  env,
  tokenSet,
}: {
  env: AsanaTokenVaultEnv;
  tokenSet: AsanaTokenSet;
}) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokenSet.refreshToken,
    client_id: asanaClientId(env),
    client_secret: asanaClientSecret(env),
  });

  const response = await fetch("https://app.asana.com/-/oauth_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await response.json<AsanaTokenRefreshResponse>();

  if (!response.ok || result.error || !result.access_token) {
    throw new Error(result.error_description || result.error || "Asana token refresh failed.");
  }

  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token || tokenSet.refreshToken,
    expiresAt: Date.now() + Math.max(result.expires_in ?? 0, 0) * 1000,
    scope: result.scope || tokenSet.scope,
    tokenType: result.token_type || tokenSet.tokenType,
  } satisfies AsanaTokenSet;
}

async function encryptTokenRecord({
  env,
  userId,
  tokens,
}: {
  env: AsanaTokenVaultEnv;
  userId: string;
  tokens: AsanaTokenSet;
}) {
  const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
  const key = await importEncryptionKey(env.TOKEN_VAULT_KEY);
  const plaintext = new TextEncoder().encode(JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  } satisfies EncryptedAsanaTokenPayload));
  const ciphertext = await crypto.subtle.encrypt({ name: encryptionAlgorithm, iv }, key, plaintext);

  return {
    version: 1,
    provider: "asana",
    userId,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    tokenType: tokens.tokenType,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    updatedAt: Date.now(),
  } satisfies EncryptedAsanaTokenRecord;
}

async function decryptTokenRecord(env: AsanaTokenVaultEnv, record: EncryptedAsanaTokenRecord) {
  const key = await importEncryptionKey(env.TOKEN_VAULT_KEY);
  const plaintext = await crypto.subtle.decrypt(
    { name: encryptionAlgorithm, iv: base64UrlToBytes(record.iv) },
    key,
    base64UrlToBytes(record.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as EncryptedAsanaTokenPayload;
}

async function getTokenRecord(env: AsanaTokenVaultEnv, userId: string) {
  const record = await env.MICROSOFT_TOKEN_VAULT.get<EncryptedAsanaTokenRecord>(asanaTokenKey(userId), "json");
  if (!record || record.version !== 1 || record.provider !== "asana") return null;
  return record;
}

function asanaTokenKey(userId: string) {
  if (!userId.trim()) throw new Error("A user id is required for Asana token storage.");
  return `${asanaTokenKeyPrefix}:${encodeURIComponent(userId)}`;
}

function validateTokenSet(tokens: AsanaTokenSet) {
  if (!tokens.accessToken || !tokens.refreshToken) {
    throw new Error("Asana access and refresh tokens are required.");
  }
  if (!Number.isFinite(tokens.expiresAt) || tokens.expiresAt <= Date.now()) {
    throw new Error("Asana token expiry must be a future timestamp.");
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

function asanaClientId(env: AsanaTokenVaultEnv) {
  const clientId = env.ASANA_CLIENT_ID?.trim();
  if (!clientId) throw new Error("ASANA_CLIENT_ID is required for Asana OAuth.");
  return clientId;
}

function asanaClientSecret(env: AsanaTokenVaultEnv) {
  const clientSecret = env.ASANA_CLIENT_SECRET?.trim();
  if (!clientSecret) throw new Error("ASANA_CLIENT_SECRET is required for Asana OAuth.");
  return clientSecret;
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
