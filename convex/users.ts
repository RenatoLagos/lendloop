import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { adminEmails, fail, requireAdmin } from "./lib/auth";

/**
 * Creates or refreshes the profile row for the signed-in Clerk user.
 * Name/email come from the verified JWT. The role is NEVER taken from the
 * client: it is `user` unless the email is in the ADMIN_EMAILS bootstrap
 * allowlist (server env) when the row is FIRST created. After that, roles change
 * only via `users:setRole`, so a demoted admin stays demoted.
 */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("UNAUTHENTICATED", "Sign in required.");
    const email = identity.email?.trim().toLowerCase();
    if (!email) fail("MISSING_EMAIL", "The Clerk JWT template must include the email claim.");
    const name = (identity.name ?? email.split("@")[0]).trim().slice(0, 80);
    const allowlisted = adminEmails().includes(email);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!existing) {
      return await ctx.db.insert("users", {
        clerkId: identity.subject,
        name,
        email,
        role: allowlisted ? "admin" : "user",
        trustedLender: false,
      });
    }
    const patch: { name?: string; email?: string } = {};
    if (existing.name !== name) patch.name = name;
    if (existing.email !== email) patch.email = email;
    if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
    return existing._id;
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return null;
    return { id: user._id, name: user.name, role: user.role, trustedLender: user.trustedLender };
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(500);
    return users.map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) fail("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/**
 * Internal only (not callable from clients). Promote/demote from the CLI:
 *   npx convex run users:setRole '{"email":"me@example.com","role":"admin"}'
 */
export const setRole = internalMutation({
  args: { email: v.string(), role: v.union(v.literal("admin"), v.literal("user")) },
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .unique();
    if (!user) fail("NOT_FOUND", "No user with that email (they must sign in once first).");
    await ctx.db.patch(user._id, { role });
  },
});
