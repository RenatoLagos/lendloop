import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { fail, requireAdmin, requireUser } from "./lib/auth";
import {
  BLOCKING_STATUSES,
  canTransition,
  isOverdue,
  rangesOverlap,
  todayUtc,
  validateDateRange,
  type LoanStatus,
} from "./lib/loanRules";

async function hasConflict(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  range: { startDate: string; endDate: string },
  excludeLoanId?: Id<"loans">,
): Promise<boolean> {
  const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
  return loans.some(
    (l) =>
      l._id !== excludeLoanId &&
      BLOCKING_STATUSES.includes(l.status) &&
      rangesOverlap(l, range),
  );
}

async function transition(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  to: LoanStatus,
) {
  if (!canTransition(loan.status, to)) {
    fail("INVALID_TRANSITION", `A ${loan.status} loan cannot become ${to}.`);
  }
  await ctx.db.patch(loan._id, { status: to, updatedAt: Date.now() });
  // Outbound automation runs after the transaction commits, never inline.
  await ctx.scheduler.runAfter(0, internal.automation.deliverNotification, {
    loanId: loan._id,
    status: to,
  });
}

async function loadLoanAs(ctx: MutationCtx, loanId: Id<"loans">, role: "lender") {
  const user = await requireUser(ctx);
  const loan = await ctx.db.get(loanId);
  if (!loan) fail("NOT_FOUND", "Loan not found.");
  if (role === "lender" && loan.lenderId !== user._id) {
    fail("FORBIDDEN", "Only the lender of this tool can do that.");
  }
  return { user, loan };
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) fail("NOT_FOUND", "Tool not found.");
    if (tool.ownerId === user._id) fail("INVALID", "You cannot borrow your own tool.");

    const dateError = validateDateRange(startDate, endDate, todayUtc());
    if (dateError) fail("INVALID", dateError);
    if (await hasConflict(ctx, toolId, { startDate, endDate })) {
      fail("CONFLICT", "The tool is already booked for those dates.");
    }
    const mine = await ctx.db.query("loans").withIndex("by_borrower", (q) => q.eq("borrowerId", user._id)).collect();
    if (mine.some((l) => l.toolId === toolId && l.status === "requested")) {
      fail("CONFLICT", "You already have a pending request for this tool.");
    }

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: tool.name,
      borrowerId: user._id,
      lenderId: tool.ownerId,
      startDate,
      endDate,
      status: "requested",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.automation.deliverNotification, {
      loanId,
      status: "requested",
    });
    return loanId;
  },
});

export const decide = mutation({
  args: { loanId: v.id("loans"), decision: v.union(v.literal("approved"), v.literal("declined")) },
  handler: async (ctx, { loanId, decision }) => {
    const { loan } = await loadLoanAs(ctx, loanId, "lender");
    if (decision === "approved" && loan.endDate < todayUtc()) {
      fail("INVALID", "This request has expired: its end date has passed.");
    }
    if (decision === "approved" && (await hasConflict(ctx, loan.toolId, loan, loan._id))) {
      fail("CONFLICT", "Another approved loan overlaps these dates.");
    }
    await transition(ctx, loan, decision);
  },
});

export const markHandedOver = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await loadLoanAs(ctx, loanId, "lender");
    await transition(ctx, loan, "active");
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await loadLoanAs(ctx, loanId, "lender");
    await transition(ctx, loan, "returned");
  },
});

// ---------------------------------------------------------------- read models

async function present(ctx: QueryCtx, loans: Doc<"loans">[], exposeEmails = false) {
  const today = todayUtc();
  return await Promise.all(
    loans.map(async (l) => {
      const [borrower, lender, events] = await Promise.all([
        ctx.db.get(l.borrowerId),
        ctx.db.get(l.lenderId),
        ctx.db.query("automationEvents").withIndex("by_loan", (q) => q.eq("loanId", l._id)).collect(),
      ]);
      return {
        id: l._id,
        toolName: l.toolName,
        startDate: l.startDate,
        endDate: l.endDate,
        status: l.status,
        overdue: isOverdue(l, today),
        borrowerName: borrower?.name ?? "Neighbor",
        lenderName: lender?.name ?? "Neighbor",
        // Email is only exposed on the admin view (moderation) — never to the other party.
        borrowerEmail: exposeEmails ? borrower?.email : undefined,
        lenderEmail: exposeEmails ? lender?.email : undefined,
        activity: events
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 5)
          .map((e) => ({ type: e.type, status: e.status, at: e.updatedAt })),
      };
    }),
  );
}

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const loans = await ctx.db.query("loans").withIndex("by_borrower", (q) => q.eq("borrowerId", user._id)).order("desc").take(200);
    return await present(ctx, loans);
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const loans = await ctx.db.query("loans").withIndex("by_lender", (q) => q.eq("lenderId", user._id)).order("desc").take(200);
    return await present(ctx, loans);
  },
});

export const adminAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(500);
    return await present(ctx, loans, true);
  },
});
