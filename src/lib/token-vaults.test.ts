import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteAsanaTokens,
  getAsanaTokens,
  getValidAsanaTokens,
  storeAsanaTokens,
  type AsanaTokenVaultEnv,
} from "@/lib/asana-token-vault";
import {
  deleteMicrosoftGraphTokens,
  getMicrosoftGraphTokens,
  getValidMicrosoftGraphTokens,
  storeMicrosoftGraphTokens,
  type MicrosoftTokenVaultEnv,
} from "@/lib/microsoft-token-vault";

function base64Key() {
  const bytes = new Uint8Array(32);
  bytes.forEach((_value, index) => {
    bytes[index] = index + 1;
  });
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function kvMock() {
  const store = new Map<string, string>();
  return {
    store,
    namespace: {
      async put(key: string, value: string) {
        store.set(key, value);
      },
      async get(key: string, type?: "json" | "text") {
        const value = store.get(key) ?? null;
        if (value === null) return null;
        return type === "json" ? JSON.parse(value) : value;
      },
      async delete(key: string) {
        store.delete(key);
      },
    } as unknown as KVNamespace,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encrypted token vaults", () => {
  it("stores, decrypts, and deletes Microsoft Graph tokens without plaintext KV records", async () => {
    const kv = kvMock();
    const env = {
      MICROSOFT_TOKEN_VAULT: kv.namespace,
      TOKEN_VAULT_KEY: base64Key(),
    } as MicrosoftTokenVaultEnv;

    await storeMicrosoftGraphTokens({
      env,
      userId: "user@example.com",
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: Date.now() + 60_000,
        scope: "offline_access User.Read",
        tokenType: "Bearer",
      },
    });

    const stored = kv.store.get("graph-token:user%40example.com") ?? "";
    expect(stored).not.toContain("access-token");
    expect(stored).not.toContain("refresh-token");
    await expect(getMicrosoftGraphTokens({ env, userId: "user@example.com" })).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      scope: "offline_access User.Read",
      tokenType: "Bearer",
    });

    await deleteMicrosoftGraphTokens({ env, userId: "user@example.com" });
    await expect(getMicrosoftGraphTokens({ env, userId: "user@example.com" })).resolves.toBeNull();
  });

  it("refreshes Microsoft Graph tokens when they are within the skew window", async () => {
    const kv = kvMock();
    const env = {
      MICROSOFT_TOKEN_VAULT: kv.namespace,
      TOKEN_VAULT_KEY: base64Key(),
      MICROSOFT_ENTRA_CLIENT_ID: "client-id",
      MICROSOFT_ENTRA_CLIENT_SECRET: "client-secret",
      MICROSOFT_ENTRA_TENANT_ID: "tenant-id",
    } as MicrosoftTokenVaultEnv;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: "new-access",
      expires_in: 3600,
      scope: "offline_access User.Read",
      token_type: "Bearer",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await storeMicrosoftGraphTokens({
      env,
      userId: "user-1",
      tokens: {
        accessToken: "old-access",
        refreshToken: "old-refresh",
        expiresAt: Date.now() + 1_000,
      },
    });

    await expect(getValidMicrosoftGraphTokens({ env, userId: "user-1" })).resolves.toMatchObject({
      accessToken: "new-access",
      refreshToken: "old-refresh",
      tokenType: "Bearer",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token", expect.objectContaining({
      method: "POST",
    }));
  });

  it("stores, decrypts, and deletes Asana tokens in the shared encrypted vault", async () => {
    const kv = kvMock();
    const env = {
      MICROSOFT_TOKEN_VAULT: kv.namespace,
      TOKEN_VAULT_KEY: base64Key(),
    } as AsanaTokenVaultEnv;

    await storeAsanaTokens({
      env,
      userId: "user-1",
      tokens: {
        accessToken: "asana-access",
        refreshToken: "asana-refresh",
        expiresAt: Date.now() + 60_000,
        scope: "default",
      },
    });

    expect(kv.store.get("asana-token:user-1")).not.toContain("asana-access");
    await expect(getAsanaTokens({ env, userId: "user-1" })).resolves.toMatchObject({
      accessToken: "asana-access",
      refreshToken: "asana-refresh",
      scope: "default",
    });

    await deleteAsanaTokens({ env, userId: "user-1" });
    await expect(getAsanaTokens({ env, userId: "user-1" })).resolves.toBeNull();
  });

  it("refreshes Asana tokens with configured OAuth credentials", async () => {
    const kv = kvMock();
    const env = {
      MICROSOFT_TOKEN_VAULT: kv.namespace,
      TOKEN_VAULT_KEY: base64Key(),
      ASANA_CLIENT_ID: "asana-client",
      ASANA_CLIENT_SECRET: "asana-secret",
    } as AsanaTokenVaultEnv;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: "new-asana-access",
      refresh_token: "new-asana-refresh",
      expires_in: 1800,
      token_type: "bearer",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await storeAsanaTokens({
      env,
      userId: "user-1",
      tokens: {
        accessToken: "old-asana-access",
        refreshToken: "old-asana-refresh",
        expiresAt: Date.now() + 1_000,
      },
    });

    await expect(getValidAsanaTokens({ env, userId: "user-1" })).resolves.toMatchObject({
      accessToken: "new-asana-access",
      refreshToken: "new-asana-refresh",
      tokenType: "bearer",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://app.asana.com/-/oauth_token", expect.objectContaining({
      method: "POST",
    }));
  });

  it("rejects invalid vault input early", async () => {
    const env = {
      MICROSOFT_TOKEN_VAULT: kvMock().namespace,
      TOKEN_VAULT_KEY: base64Key(),
    } as MicrosoftTokenVaultEnv;

    await expect(storeMicrosoftGraphTokens({
      env,
      userId: "user-1",
      tokens: {
        accessToken: "",
        refreshToken: "refresh",
        expiresAt: Date.now() + 60_000,
      },
    })).rejects.toThrow("access and refresh tokens are required");

    await expect(storeMicrosoftGraphTokens({
      env,
      userId: "",
      tokens: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 60_000,
      },
    })).rejects.toThrow("A user id is required");
  });
});
