import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export type AppRole = Doc<"users">["role"];

/**
 * The single authentication gate. Every public query/mutation (except the
 * intentionally public `tools.listPublic`) calls this first.
 * Identity comes from the verified Clerk JWT; role comes from the database,
 * never from the client.
 */
export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required." });
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_REGISTERED", message: "User profile not initialised." });
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Admin role required." });
  }
  return user;
}

/** Owner-or-admin check used for destructive listing operations. */
export function assertOwnerOrAdmin(user: Doc<"users">, ownerId: Doc<"users">["_id"]) {
  if (user._id !== ownerId && user.role !== "admin") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Not allowed." });
  }
}

export function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
