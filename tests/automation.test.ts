// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const SECRET = "automation-test-secret";
const MINUTE = 60_000;

async function seedLoan(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const lender = await ctx.db.insert("users", { clerkId: "l", name: "Lena", email: "lena@x.test", role: "user", trustedLender: false });
    const borrower = await ctx.db.insert("users", { clerkId: "b", name: "Ben", email: "ben@x.test", role: "user", trustedLender: false });
    const toolId = await ctx.db.insert("tools", { ownerId: lender, name: "Ladder", category: "other", condition: "good", description: "" });
    const now = Date.now();
    return await ctx.db.insert("loans", { toolId, toolName: "Ladder", borrowerId: borrower, lenderId: lender, startDate: "2020-01-01", endDate: "2020-01-05", status: "active", createdAt: now, updatedAt: now });
  });
}

function seedEvent(
  t: TestConvex<typeof schema>,
  loanId: Id<"loans">,
  key: string,
  fields: { status: "pending" | "sent" | "failed" | "dead"; attempts: number; updatedAt?: number; type?: "notification" | "overdue-reminder" },
) {
  const now = Date.now();
  return t.run((ctx) =>
    ctx.db.insert("automationEvents", {
      loanId,
      type: fields.type ?? "notification",
      status: fields.status,
      idempotencyKey: key,
      loanStatus: "active",
      attempts: fields.attempts,
      createdAt: now,
      updatedAt: fields.updatedAt ?? now,
    }),
  );
}

const statusOf = (t: TestConvex<typeof schema>, key: string) =>
  t.run(async (ctx) => (await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("idempotencyKey", key)).unique())?.status);

describe("notification sweeper", () => {
  it("re-drives a pending event whose action crashed, but not a fresh one", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedLoan(t);
    await seedEvent(t, loanId, "stuck", { status: "pending", attempts: 1, updatedAt: Date.now() - 10 * MINUTE });
    await seedEvent(t, loanId, "fresh", { status: "pending", attempts: 1 });
    const retryable = await t.query(internal.automation.listRetryable, {});
    expect(retryable).toEqual([{ loanId, loanStatus: "active" }]);
  });

  it("reclaims a stuck pending claim and refuses a fresh one", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedLoan(t);
    await seedEvent(t, loanId, "stuck", { status: "pending", attempts: 1, updatedAt: Date.now() - 10 * MINUTE });
    const claim = (key: string) => t.mutation(internal.automation.claimEvent, { loanId, idempotencyKey: key, loanStatus: "active" });
    expect(await claim("stuck")).toBe(true);
    expect(await claim("stuck")).toBe(false); // now fresh again: another run owns it
  });

  it("marks a failed event dead on its last attempt and never claims a dead one", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedLoan(t);
    await seedEvent(t, loanId, "last", { status: "pending", attempts: 5 });
    await t.mutation(internal.automation.finishEvent, { idempotencyKey: "last", status: "failed", detail: "HTTP 500" });
    expect(await statusOf(t, "last")).toBe("dead");
    expect(await t.mutation(internal.automation.claimEvent, { loanId, idempotencyKey: "last", loanStatus: "active" })).toBe(false);
  });

  it("keeps a failed event retryable before the last attempt", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedLoan(t);
    await seedEvent(t, loanId, "early", { status: "pending", attempts: 2 });
    await t.mutation(internal.automation.finishEvent, { idempotencyKey: "early", status: "failed" });
    expect(await statusOf(t, "early")).toBe("failed");
  });

  it("a late run cannot overwrite a terminal state", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedLoan(t);
    await seedEvent(t, loanId, "done", { status: "sent", attempts: 1 });
    await seedEvent(t, loanId, "gone", { status: "dead", attempts: 5 });
    for (const key of ["done", "gone"]) {
      await t.mutation(internal.automation.finishEvent, { idempotencyKey: key, status: "failed", detail: "late" });
    }
    expect(await statusOf(t, "done")).toBe("sent");
    expect(await statusOf(t, "gone")).toBe("dead");
  });

  it("exhausted stale pending rows do not starve stuck pending ones", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedLoan(t);
    const old = Date.now() - 20 * MINUTE;
    for (let i = 0; i < 60; i++) await seedEvent(t, loanId, `p-old-${i}`, { status: "pending", attempts: 5, updatedAt: old });
    await seedEvent(t, loanId, "p-new", { status: "pending", attempts: 1, updatedAt: Date.now() - 10 * MINUTE });
    await t.mutation(internal.automation.reapExhausted, {});
    expect(await statusOf(t, "p-old-0")).toBe("dead");
    expect(await t.query(internal.automation.listRetryable, {})).toEqual([{ loanId, loanStatus: "active" }]);
  });

  it("exhausted rows do not starve newer failures", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedLoan(t);
    // 60 legacy rows left `failed` with no attempts remaining, older than the live one.
    for (let i = 0; i < 60; i++) await seedEvent(t, loanId, `old-${i}`, { status: "failed", attempts: 5 });
    // A failed reminder (never swept) must not take a window slot either.
    await seedEvent(t, loanId, "reminder", { status: "failed", attempts: 1, type: "overdue-reminder" });
    await seedEvent(t, loanId, "new", { status: "failed", attempts: 1 });

    await t.mutation(internal.automation.reapExhausted, {});
    await t.mutation(internal.automation.reapExhausted, {});
    expect(await statusOf(t, "old-0")).toBe("dead");
    expect(await t.query(internal.automation.listRetryable, {})).toEqual([{ loanId, loanStatus: "active" }]);
  });
});

describe("outbound delivery terminal states", () => {
  beforeEach(() => {
    vi.stubEnv("LENDLOOP_HMAC_SECRET", SECRET);
    vi.stubEnv("N8N_WEBHOOK_URL", "http://n8n.test/webhook/x");
    vi.stubEnv("N8N_RETRY_BASE_MS", "1");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a non-retryable 4xx goes straight to dead after one request", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedLoan(t);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await t.action(internal.automation.deliverNotification, { loanId, status: "active" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events.map((e) => e.status)).toEqual(["dead"]);
    expect(await t.query(internal.automation.listRetryable, {})).toEqual([]);
  });

  it("a 5xx stays failed (retryable) while attempts remain", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedLoan(t);
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }));
    await t.action(internal.automation.deliverNotification, { loanId, status: "active" });
    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events.map((e) => e.status)).toEqual(["failed"]);
  });
});
