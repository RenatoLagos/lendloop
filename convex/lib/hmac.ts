/**
 * HMAC-SHA256 request signing shared by both integration directions.
 *
 *   signature = hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`))
 *
 * Pure module (Web Crypto only) so it runs in the Convex runtime, in Node
 * (vitest) and is mirrored by the n8n Code nodes (see n8n/workflows).
 */

export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const EVENT_ID_HEADER = "x-lendloop-event-id";

/** Maximum clock skew / replay window accepted on either side. */
export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signPayload(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  return toHex(mac);
}

/** Constant-time string comparison (no early exit on the first differing byte). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  // Length is not secret (fixed-size hex digest), but never short-circuit the loop.
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export type VerifyFailure =
  | "missing_secret"
  | "missing_headers"
  | "bad_timestamp"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

export async function verifySignature(args: {
  secret: string | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  rawBody: string;
  nowMs?: number;
  toleranceMs?: number;
}): Promise<VerifyResult> {
  const { secret, timestamp, signature, rawBody } = args;
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };

  if (!/^\d{10,16}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  const now = args.nowMs ?? Date.now();
  const tolerance = args.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  if (Math.abs(now - Number(timestamp)) > tolerance) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const expected = await signPayload(secret, timestamp, rawBody);
  return constantTimeEqual(expected, signature.trim().toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "signature_mismatch" };
}
