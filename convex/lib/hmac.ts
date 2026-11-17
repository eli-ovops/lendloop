/**
 * HMAC-SHA256 helpers for the Convex <-> n8n webhook channel.
 *
 * Convex actions/httpActions run in a WebCrypto environment (no Node
 * `crypto` module), so signing uses crypto.subtle. The n8n side uses
 * Node's crypto module; both produce identical hex digests.
 *
 * The shared secret lives ONLY in environment variables:
 * - Convex deployment env: N8N_WEBHOOK_SECRET
 * - n8n env:               LENDLOOP_WEBHOOK_SECRET  (same value)
 * It is never stored in the database or in workflow JSON.
 */

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(sig);
}

/** Constant-time comparison so signature checks do not leak via timing. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify an incoming `X-LendLoop-Signature` header value. Accepts both the
 * raw hex digest and the `sha256=<hex>` prefixed form.
 */
export async function verifyHmac(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;
  const expected = await hmacSha256Hex(secret, rawBody);
  return constantTimeEqual(provided.toLowerCase(), expected);
}
