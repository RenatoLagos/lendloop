// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { signPayload } from "../convex/lib/hmac";
import { reminderKey } from "../convex/lib/idempotency";
import { todayUtc } from "../convex/lib/loanRules";

const modules = import.meta.glob("../convex/**/*.ts");
const SECRET = "http-test-secret";

async function signedInit(method: "GET" | "POST", body = "", secret = SECRET, ts = String(Date.now())) {
  return {
    method,
    body: method === "POST" ? body : undefined,
    headers: { "content-type": "application/json", "x-lendloop-timestamp": ts, "x-lendloop-signature": await signPayload(secret, ts, body) },
  };
}

async function seedOverdueLoan(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const lender = await ctx.db.insert("users", { clerkId: "l", name: "Lena", email: "lena@x.test", role: "user", trustedLender: false });
    const borrower = await ctx.db.insert("users", { clerkId: "b", name: "Ben", email: "ben@x.test", role: "user", trustedLender: false });
    const toolId = await ctx.db.insert("tools", { ownerId: lender, name: "Ladder", category: "other", condition: "good", description: "" });
    const now = Date.now();
    return await ctx.db.insert("loans", { toolId, toolName: "Ladder", borrowerId: borrower, lenderId: lender, startDate: "2020-01-01", endDate: "2020-01-05", status: "active", createdAt: now, updatedAt: now });
  });
}

describe("n8n HTTP endpoints", () => {
  beforeEach(() => {
    vi.stubEnv("LENDLOOP_HMAC_SECRET", SECRET);
    vi.useFakeTimers();
  });

  it("rejects unsigned, wrongly signed and stale requests with 401", async () => {
    const t = convexTest(schema, modules);
    expect((await t.fetch("/n8n/overdue-loans", { method: "GET" })).status).toBe(401);
    expect((await t.fetch("/n8n/overdue-loans", await signedInit("GET", "", "wrong-secret"))).status).toBe(401);
    const stale = String(Date.now() - 10 * 60 * 1000);
    expect((await t.fetch("/n8n/overdue-loans", await signedInit("GET", "", SECRET, stale))).status).toBe(401);
  });

  it("returns overdue loans with only the fields the reminder needs", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedOverdueLoan(t);
    const res = await t.fetch("/n8n/overdue-loans", await signedInit("GET"));
    expect(res.status).toBe(200);
    const { loans } = await res.json();
    expect(loans).toHaveLength(1);
    expect(Object.keys(loans[0]).sort()).toEqual(["borrowerEmail", "daysOverdue", "endDate", "idempotencyKey", "loanId", "toolName"]);
    expect(loans[0].idempotencyKey).toBe(reminderKey(loanId, todayUtc()));
  });

  it("write-back is idempotent: retries do not create duplicates", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedOverdueLoan(t);
    const body = JSON.stringify({ loanId, idempotencyKey: reminderKey(loanId, todayUtc()), status: "sent" });

    const first = await (await t.fetch("/n8n/reminder-status", await signedInit("POST", body))).json();
    const second = await (await t.fetch("/n8n/reminder-status", await signedInit("POST", body))).json();
    expect(first.result).toBe("created");
    expect(second.result).toBe("duplicate");

    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events).toHaveLength(1);

    // Once sent, the loan drops off the overdue feed for today.
    const { loans } = await (await t.fetch("/n8n/overdue-loans", await signedInit("GET"))).json();
    expect(loans).toHaveLength(0);
  });

  it("upgrades failed -> sent but never downgrades sent -> failed", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedOverdueLoan(t);
    const key = reminderKey(loanId, todayUtc());
    const post = async (status: string) =>
      (await (await t.fetch("/n8n/reminder-status", await signedInit("POST", JSON.stringify({ loanId, idempotencyKey: key, status })))).json()).result;
    expect(await post("failed")).toBe("created");
    expect(await post("sent")).toBe("updated");
    expect(await post("failed")).toBe("duplicate");
    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("sent");
  });

  it("validates the idempotency key, body and signature", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedOverdueLoan(t);
    const send = async (obj: unknown) => (await t.fetch("/n8n/reminder-status", await signedInit("POST", JSON.stringify(obj)))).status;
    expect(await send({ loanId, idempotencyKey: "nope", status: "sent" })).toBe(400);
    expect(await send({ loanId, idempotencyKey: reminderKey(loanId, "2020-01-01"), status: "sent" })).toBe(400); // wrong day
    expect(await send({ loanId, idempotencyKey: reminderKey("other", todayUtc()), status: "sent" })).toBe(400); // other loan
    expect(await send({ loanId, idempotencyKey: reminderKey(loanId, todayUtc()), status: "weird" })).toBe(400);
    // Impossible calendar dates parse to NaN day diffs; they must not slip past the +/- 1 day check.
    for (const date of ["2026-13-45", "2026-02-30", "not-a-date", "0000-00-00"]) {
      expect(await send({ loanId, idempotencyKey: `${loanId}:${date}:overdue-reminder`, status: "sent" })).toBe(400);
    }
    const tampered = await signedInit("POST", JSON.stringify({ loanId, idempotencyKey: reminderKey(loanId, todayUtc()), status: "sent" }));
    tampered.body = tampered.body!.replace("sent", "failed");
    expect((await t.fetch("/n8n/reminder-status", tampered)).status).toBe(401);
  });

  it("outbound notification: records sent on 2xx, failed on 5xx, and dedups by event id", async () => {
    vi.useRealTimers();
    vi.stubEnv("N8N_WEBHOOK_URL", "http://n8n.test/webhook/x");
    vi.stubEnv("N8N_RETRY_BASE_MS", "1");
    const t = convexTest(schema, modules);
    const loanId = await seedOverdueLoan(t);
    const calls: { headers: Record<string, string>; body: string }[] = [];
    let status = 200;
    vi.stubGlobal("fetch", async (_u: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push(init);
      return new Response("{}", { status });
    });

    await t.action(internal.automation.deliverNotification, { loanId, status: "active" });
    await t.action(internal.automation.deliverNotification, { loanId, status: "active" }); // duplicate trigger
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0].body);
    expect(Object.keys(payload).sort()).toEqual(["endDate", "event", "eventId", "loanId", "recipientEmail", "recipientRole", "startDate", "status", "toolName"]);
    expect(payload.recipientEmail).toBe("ben@x.test"); // active -> borrower
    const sig = await signPayload(SECRET, calls[0].headers["x-lendloop-timestamp"], calls[0].body);
    expect(calls[0].headers["x-lendloop-signature"]).toBe(sig);

    status = 500; // a different event (returned) fails after retries and is recorded as failed
    await t.action(internal.automation.deliverNotification, { loanId, status: "returned" });
    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events.map((e) => e.status).sort()).toEqual(["failed", "sent"]);
    expect(calls.length).toBe(1 + 3); // 3 inline attempts on 5xx
  });
});
