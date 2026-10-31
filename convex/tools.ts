import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { assertOwnerOrAdmin, fail, requireUser } from "./lib/auth";
import { LIMITS } from "./lib/categories";
import { categoryValidator, conditionValidator } from "./lib/validators";
import { internal } from "./_generated/api";

type Availability = "available" | "reserved" | "on_loan";

async function availabilityOf(ctx: QueryCtx, toolId: Id<"tools">): Promise<Availability> {
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .collect();
  if (loans.some((l) => l.status === "active")) return "on_loan";
  if (loans.some((l) => l.status === "approved")) return "reserved";
  return "available";
}

function cleanText(value: string, max: number, label: string, required = true): string {
  const trimmed = value.trim();
  if (required && trimmed.length === 0) fail("INVALID", `${label} is required.`);
  if (trimmed.length > max) fail("INVALID", `${label} must be at most ${max} characters.`);
  return trimmed;
}

/**
 * PUBLIC (no auth). Data minimisation: only name + category of tools that are
 * not currently out on loan. No ids, no owner, no description.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(100);
    const out: { name: string; category: Doc<"tools">["category"] }[] = [];
    for (const t of tools) {
      if ((await availabilityOf(ctx, t._id)) !== "on_loan") {
        out.push({ name: t.name, category: t.category });
      }
    }
    return out;
  },
});

export const list = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    await requireUser(ctx);
    const tools = category
      ? await ctx.db.query("tools").withIndex("by_category", (q) => q.eq("category", category)).order("desc").take(200)
      : await ctx.db.query("tools").order("desc").take(200);
    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          ownerId: t.ownerId,
          ownerName: owner?.name ?? "Neighbor",
          ownerTrusted: owner?.trustedLender ?? false,
          availability: await availabilityOf(ctx, t._id),
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .take(200);
    return await Promise.all(
      tools.map(async (t) => ({
        id: t._id,
        name: t.name,
        category: t.category,
        condition: t.condition,
        description: t.description,
        availability: await availabilityOf(ctx, t._id),
      })),
    );
  },
});

const toolFields = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await ctx.db.insert("tools", {
      ownerId: user._id,
      name: cleanText(args.name, LIMITS.name, "Name"),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, LIMITS.description, "Description", false),
    });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) fail("NOT_FOUND", "Tool not found.");
    // Edit is owner-only; admins moderate by removing, not by rewriting content.
    if (tool.ownerId !== user._id) fail("FORBIDDEN", "Only the owner can edit a listing.");
    await ctx.db.patch(toolId, {
      name: cleanText(args.name, LIMITS.name, "Name"),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, LIMITS.description, "Description", false),
    });
  },
});

/** Owner or admin. Refuses while a loan is approved/active; declines open requests. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) fail("NOT_FOUND", "Tool not found.");
    assertOwnerOrAdmin(user, tool.ownerId);

    const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
    if (loans.some((l) => l.status === "approved" || l.status === "active")) {
      fail("CONFLICT", "This tool has an approved or active loan. Mark it returned first.");
    }
    const now = Date.now();
    for (const loan of loans.filter((l) => l.status === "requested")) {
      await ctx.db.patch(loan._id, { status: "declined", updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.automation.deliverNotification, {
        loanId: loan._id,
        status: "declined",
      });
    }
    await ctx.db.delete(toolId);
  },
});
