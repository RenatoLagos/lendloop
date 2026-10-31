import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  categoryValidator,
  conditionValidator,
  eventStatusValidator,
  loanStatusValidator,
} from "./lib/validators";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    // Snapshot: the loan history survives deletion of the tool.
    toolName: v.string(),
    borrowerId: v.id("users"),
    lenderId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD (UTC)
    endDate: v.string(),
    status: loanStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_tool", ["toolId"])
    .index("by_status", ["status"]),

  automationEvents: defineTable({
    loanId: v.id("loans"),
    type: v.union(v.literal("notification"), v.literal("overdue-reminder")),
    status: eventStatusValidator,
    idempotencyKey: v.string(),
    // Loan status that triggered a notification (needed for retries).
    loanStatus: v.optional(loanStatusValidator),
    attempts: v.number(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"])
    .index("by_status", ["status"])
    // Sweeper: (status, type) equality, then a range on updatedAt for stale pending claims.
    .index("by_status_type", ["status", "type", "updatedAt"]),
});
