/**
 * Google service-account authentication using only Web Crypto
 * (the `googleapis` npm package does not run on Cloudflare Workers).
 *
 * Flow: sign a JWT with the service account's private key -> exchange it at
 * Google's token endpoint for a 1-hour access token -> cache it in memory.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Read-only scopes: this server can never change anything in GSC or GA4.
const SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
].join(" ");

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

let cached: { token: string; expiresAt: number; keyId: string } | null = null;

function base64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export function parseServiceAccount(json: string | undefined): ServiceAccount {
  if (!json) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON secret is not set. See README → Setup step 4.",
    );
  }
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(json);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.",
    );
  }
  return sa;
}

export async function getGoogleAccessToken(saJson: string | undefined): Promise<string> {
  const sa = parseServiceAccount(saJson);
  const now = Math.floor(Date.now() / 1000);

  // Reuse a cached token until 5 minutes before it expires.
  if (cached && cached.keyId === sa.client_email && cached.expiresAt - 300 > now) {
    return cached.token;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: SCOPES,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64url(sig)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Google token exchange failed (${res.status}): ${body.error_description ?? body.error ?? "unknown error"}`,
    );
  }

  cached = {
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600),
    keyId: sa.client_email,
  };
  return body.access_token;
}
