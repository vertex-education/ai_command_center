# Microsoft Graph Token Vault

Microsoft Graph access and refresh tokens are stored in Cloudflare KV through the `MICROSOFT_TOKEN_VAULT` binding. Token material is encrypted before it is written to KV with AES-256-GCM through the Workers Web Crypto API.

The vault helper lives in [src/lib/microsoft-token-vault.ts](../src/lib/microsoft-token-vault.ts).

## Required Cloudflare Resources

KV namespace:

```powershell
node ./scripts/run-wrangler.mjs kv namespace create MICROSOFT_TOKEN_VAULT --config=./wrangler.jsonc
```

Current namespace binding:

```jsonc
{
  "binding": "MICROSOFT_TOKEN_VAULT",
  "id": "79a29da0fd4a4b6ca90aa77aed5a39d8"
}
```

Required secrets:

```powershell
$tokenVaultKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$tokenVaultKey | node ./scripts/run-wrangler.mjs secret put TOKEN_VAULT_KEY --config=./wrangler.jsonc

"<microsoft-client-id>" | node ./scripts/run-wrangler.mjs secret put MICROSOFT_ENTRA_CLIENT_ID --config=./wrangler.jsonc
"<microsoft-client-secret>" | node ./scripts/run-wrangler.mjs secret put MICROSOFT_ENTRA_CLIENT_SECRET --config=./wrangler.jsonc
"<tenant-id>" | node ./scripts/run-wrangler.mjs secret put MICROSOFT_ENTRA_TENANT_ID --config=./wrangler.jsonc
```

`TOKEN_VAULT_KEY` must decode to exactly 32 bytes. Generate it once per environment and rotate only with a planned re-encryption pass for existing KV records.

## Storage Format

KV keys use this shape:

```text
graph-token:<encoded-user-id>
```

The KV value stores non-sensitive metadata plus an encrypted payload:

- `expiresAt`
- `scope`
- `tokenType`
- `iv`
- `ciphertext`

The encrypted payload contains the Microsoft Graph `accessToken` and `refreshToken`.

## Refresh Behavior

Call `getValidMicrosoftGraphTokens({ env, userId })` before making Microsoft Graph requests. It decrypts the stored token set and automatically refreshes it through the Microsoft identity platform when the access token is within five minutes of expiry.

Successful refreshes are immediately re-encrypted and written back to KV. If Microsoft rotates the refresh token, the replacement refresh token is stored.

## Usage

```ts
import { getValidMicrosoftGraphTokens } from "@/lib/microsoft-token-vault";

const tokens = await getValidMicrosoftGraphTokens({ env, userId });
if (!tokens) throw new Response("Microsoft Graph is not connected.", { status: 409 });

const graphResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
  headers: {
    Authorization: `Bearer ${tokens.accessToken}`,
  },
});
```

Microsoft OAuth sign-in stores returned Graph tokens through a Better Auth account-create hook before the account row is inserted. The hook writes the encrypted token set to KV and strips `accessToken`, `refreshToken`, and token expiry fields from the D1 account row. Use `deleteMicrosoftGraphTokens({ env, userId })` when a user disconnects Microsoft Graph access.
