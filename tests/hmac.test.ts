import { describe, expect, it } from "vitest";
import { constantTimeEqual, signPayload, verifySignature } from "../convex/lib/hmac";

const secret = "test-secret-not-real";
const body = JSON.stringify({ loanId: "abc", status: "approved" });
const now = 1_760_000_000_000;
const ts = String(now);

describe("hmac", () => {
  it("accepts a valid signature", async () => {
    const signature = await signPayload(secret, ts, body);
    expect(await verifySignature({ secret, timestamp: ts, signature, rawBody: body, nowMs: now })).toEqual({ ok: true });
  });

  it("is deterministic and hex encoded", async () => {
    const a = await signPayload(secret, ts, body);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await signPayload(secret, ts, body)).toBe(a);
  });

  it("rejects a tampered body", async () => {
    const signature = await signPayload(secret, ts, body);
    const r = await verifySignature({ secret, timestamp: ts, signature, rawBody: body + " ", nowMs: now });
    expect(r).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a wrong secret", async () => {
    const signature = await signPayload("other", ts, body);
    const r = await verifySignature({ secret, timestamp: ts, signature, rawBody: body, nowMs: now });
    expect(r.ok).toBe(false);
  });

  it("rejects an expired timestamp (replay)", async () => {
    const old = String(now - 6 * 60 * 1000);
    const signature = await signPayload(secret, old, body);
    const r = await verifySignature({ secret, timestamp: old, signature, rawBody: body, nowMs: now });
    expect(r).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("rejects a timestamp too far in the future", async () => {
    const future = String(now + 6 * 60 * 1000);
    const signature = await signPayload(secret, future, body);
    const r = await verifySignature({ secret, timestamp: future, signature, rawBody: body, nowMs: now });
    expect(r.ok).toBe(false);
  });

  it("rejects a timestamp swapped after signing", async () => {
    const signature = await signPayload(secret, ts, body);
    const r = await verifySignature({ secret, timestamp: String(now + 1000), signature, rawBody: body, nowMs: now });
    expect(r).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("fails closed when the secret or headers are missing", async () => {
    expect(await verifySignature({ secret: undefined, timestamp: ts, signature: "x", rawBody: body, nowMs: now })).toEqual({ ok: false, reason: "missing_secret" });
    expect(await verifySignature({ secret, timestamp: null, signature: "x", rawBody: body, nowMs: now })).toEqual({ ok: false, reason: "missing_headers" });
    expect(await verifySignature({ secret, timestamp: "abc", signature: "x", rawBody: body, nowMs: now })).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("signs an empty body (GET requests)", async () => {
    const signature = await signPayload(secret, ts, "");
    expect((await verifySignature({ secret, timestamp: ts, signature, rawBody: "", nowMs: now })).ok).toBe(true);
  });

  it("constantTimeEqual handles equal, different and different-length input", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});
