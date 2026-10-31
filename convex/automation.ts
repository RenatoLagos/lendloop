import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  EVENT_ID_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signPayload,
} from "./lib/hmac";
import { notificationKey, reminderKey, decideWrite } from "./lib/idempotency";
import { daysBetween, isOverdue, todayUtc } from "./lib/loanRules";
import { eventStatusValidator, loanStatusValidator } from "./lib/validators";

// Counts scheduler RUNS (one per successful claim), not individual HTTP tries:
// each run makes up to INLINE_RETRIES requests, so 5 runs can mean 15 requests.
const MAX_ATTEMPTS = 5;
const INLINE_RETRIES = 3; // HTTP tries inside one action run
// A pending claim older than this is considered orphaned (the action crashed
// after claiming) and may be reclaimed by claimEvent or re-driven by the sweeper.
const STUCK_PENDING_MS = 5 * 60 * 1000;

// ------------------------------------------------------------- outbound path

/**
 * Builds the MINIMAL webhook payload: only what the notification workflow
 * needs. No ids of users, no names, no descriptions, no other party's email.
 */
export const buildPayload = internalQuery({
  args: { loanId: v.id("loans"), status: loanStatusValidator },
  handler: async (ctx, { loanId, status }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    // requested -> tell the lender; returned -> tell the lender; others -> tell the borrower.
    const toLender = status === "requested" || status === "returned";
    const recipient = await ctx.db.get(toLender ? loan.lenderId : loan.borrowerId);
    if (!recipient) return null;
    return {
      eventId: notificationKey(loanId, status),
      event: "loan.status_changed" as const,
      loanId: loan._id as string,
      status,
      recipientRole: toLender ? ("lender" as const) : ("borrower" as const),
      recipientEmail: recipient.email,
      toolName: loan.toolName,
      startDate: loan.startDate,
      endDate: loan.endDate,
    };
  },
});

/** Claims the idempotency key. Returns false if already delivered or in flight. */
export const claimEvent = internalMutation({
  args: {
    loanId: v.id("loans"),
    idempotencyKey: v.string(),
    loanStatus: loanStatusValidator,
  },
  handler: async (ctx, { loanId, idempotencyKey, loanStatus }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (!existing) {
      await ctx.db.insert("automationEvents", {
        loanId,
        type: "notification",
        status: "pending",
        idempotencyKey,
        loanStatus,
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      });
      return true;
    }
    if (existing.status === "sent" || existing.status === "dead") return false;
    const stuck = existing.status === "pending" && now - existing.updatedAt > STUCK_PENDING_MS;
    if (existing.status === "failed" || stuck) {
      if (existing.attempts >= MAX_ATTEMPTS) {
        // Out of attempts (e.g. the last run crashed): make the give-up terminal.
        await ctx.db.patch(existing._id, { status: "dead", updatedAt: now });
        return false;
      }
      await ctx.db.patch(existing._id, {
        status: "pending",
        attempts: existing.attempts + 1,
        updatedAt: now,
      });
      return true;
    }
    return false; // pending and fresh: another run is delivering it
  },
});

export const finishEvent = internalMutation({
  args: {
    idempotencyKey: v.string(),
    status: eventStatusValidator,
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { idempotencyKey, status, detail }) => {
    const ev = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (!ev) return;
    // Terminal states are final: a late or duplicate run (e.g. after a stuck-pending
    // reclaim) must not overwrite `sent` or `dead`.
    if (ev.status === "sent" || ev.status === "dead") return;
    // A retryable failure on the last allowed attempt is terminal.
    const final = status === "failed" && ev.attempts >= MAX_ATTEMPTS ? "dead" : status;
    await ctx.db.patch(ev._id, { status: final, detail, updatedAt: Date.now() });
  },
});

/** Backoff base; overridable so tests do not wait. */
const retryBaseMs = () => Number(process.env.N8N_RETRY_BASE_MS ?? 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Scheduled after every loan mutation (ctx.scheduler.runAfter). */
export const deliverNotification = internalAction({
  args: { loanId: v.id("loans"), status: loanStatusValidator },
  handler: async (ctx, { loanId, status }) => {
    const payload = await ctx.runQuery(internal.automation.buildPayload, { loanId, status });
    if (!payload) return;

    const claimed = await ctx.runMutation(internal.automation.claimEvent, {
      loanId,
      idempotencyKey: payload.eventId,
      loanStatus: status,
    });
    if (!claimed) return; // duplicate trigger: already sent / in flight / gave up

    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_HMAC_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.automation.finishEvent, {
        idempotencyKey: payload.eventId,
        status: "failed",
        detail: "N8N_WEBHOOK_URL or LENDLOOP_HMAC_SECRET not configured",
      });
      return;
    }

    const body = JSON.stringify(payload);
    let lastError = "unknown";
    let retryable = true;
    for (let attempt = 1; attempt <= INLINE_RETRIES; attempt++) {
      try {
        const timestamp = String(Date.now()); // fresh per attempt (replay window)
        const signature = await signPayload(secret, timestamp, body);
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [TIMESTAMP_HEADER]: timestamp,
            [SIGNATURE_HEADER]: signature,
            [EVENT_ID_HEADER]: payload.eventId,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          await ctx.runMutation(internal.automation.finishEvent, {
            idempotencyKey: payload.eventId,
            status: "sent",
          });
          return;
        }
        lastError = `HTTP ${res.status}`;
        // 4xx (except 408/429) will not succeed on retry (e.g. 401 from a bad
        // secret): stop early and mark the event dead so the sweeper skips it.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          retryable = false;
          break;
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message.slice(0, 200) : "network error";
      }
      if (attempt < INLINE_RETRIES) await sleep(retryBaseMs() * 2 ** (attempt - 1));
    }
    await ctx.runMutation(internal.automation.finishEvent, {
      idempotencyKey: payload.eventId,
      status: retryable ? "failed" : "dead",
      detail: lastError,
    });
  },
});

/** Cron sweeper: re-drives failed and orphaned-pending notifications (bounded by MAX_ATTEMPTS). */
export const retryFailed = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.automation.reapExhausted, {});
    const failed = await ctx.runQuery(internal.automation.listRetryable, {});
    for (const ev of failed) {
      await ctx.scheduler.runAfter(0, internal.automation.deliverNotification, {
        loanId: ev.loanId,
        status: ev.loanStatus,
      });
    }
  },
});

/**
 * Moves rows that already used all their attempts to the terminal `dead`
 * status: `failed` ones, and stale `pending` ones (the last run crashed after
 * claiming). New rows reach `dead` through finishEvent/claimEvent; this drains
 * rows that were left behind, so they cannot crowd retryable rows out of the
 * sweeper windows.
 */
export const reapExhausted = internalMutation({
  args: {},
  handler: async (ctx) => {
    const failed = await ctx.db
      .query("automationEvents")
      .withIndex("by_status_type", (q) => q.eq("status", "failed").eq("type", "notification"))
      .take(100);
    for (const e of failed) {
      if (e.attempts >= MAX_ATTEMPTS) await ctx.db.patch(e._id, { status: "dead", updatedAt: Date.now() });
    }
    const stale = await ctx.db
      .query("automationEvents")
      .withIndex("by_status_type", (q) =>
        q.eq("status", "pending").eq("type", "notification").lt("updatedAt", Date.now() - STUCK_PENDING_MS),
      )
      .take(100);
    for (const e of stale) {
      if (e.attempts >= MAX_ATTEMPTS) await ctx.db.patch(e._id, { status: "dead", updatedAt: Date.now() });
    }
  },
});

export const listRetryable = internalQuery({
  args: {},
  handler: async (ctx) => {
    const failed = await ctx.db
      .query("automationEvents")
      .withIndex("by_status_type", (q) => q.eq("status", "failed").eq("type", "notification"))
      .take(50);
    // Orphaned claims: the action died after claimEvent, so nothing else will finish them.
    const stuck = await ctx.db
      .query("automationEvents")
      .withIndex("by_status_type", (q) =>
        q.eq("status", "pending").eq("type", "notification").lt("updatedAt", Date.now() - STUCK_PENDING_MS),
      )
      .take(50);
    return [...failed, ...stuck]
      .filter((e) => e.loanStatus && e.attempts < MAX_ATTEMPTS)
      .map((e) => ({ loanId: e.loanId as Id<"loans">, loanStatus: e.loanStatus! }));
  },
});

// -------------------------------------------------------------- inbound path

/** Overdue loans not yet reminded today. Fields are limited to what the reminder needs. */
export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const candidates = [
      ...(await ctx.db.query("loans").withIndex("by_status", (q) => q.eq("status", "approved")).take(500)),
      ...(await ctx.db.query("loans").withIndex("by_status", (q) => q.eq("status", "active")).take(500)),
    ].filter((l) => isOverdue(l, today));

    const out = [];
    for (const loan of candidates) {
      const key = reminderKey(loan._id, today);
      const done = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
        .unique();
      if (done?.status === "sent") continue;
      const borrower = await ctx.db.get(loan.borrowerId);
      if (!borrower) continue;
      out.push({
        loanId: loan._id as string,
        idempotencyKey: key,
        borrowerEmail: borrower.email,
        toolName: loan.toolName,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    return out;
  },
});

/** Idempotent write-back of a reminder result from n8n. */
export const recordReminder = internalMutation({
  args: {
    loanId: v.string(), // untrusted input from n8n: normalised below
    idempotencyKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { loanId: rawLoanId, idempotencyKey, status, detail }) => {
    const loanId = ctx.db.normalizeId("loans", rawLoanId);
    const loan = loanId ? await ctx.db.get(loanId) : null;
    if (!loanId || !loan) return { result: "unknown_loan" as const };
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    const decision = decideWrite(existing?.status ?? null, status);
    const now = Date.now();
    if (decision === "insert") {
      await ctx.db.insert("automationEvents", {
        loanId,
        type: "overdue-reminder",
        status,
        idempotencyKey,
        attempts: 1,
        detail: detail?.slice(0, 200),
        createdAt: now,
        updatedAt: now,
      });
      return { result: "created" as const };
    }
    if (decision === "update" && existing) {
      await ctx.db.patch(existing._id, {
        status,
        attempts: existing.attempts + 1,
        detail: detail?.slice(0, 200),
        updatedAt: now,
      });
      return { result: "updated" as const };
    }
    return { result: "duplicate" as const };
  },
});
