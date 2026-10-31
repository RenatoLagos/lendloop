import { v } from "convex/values";

// Keep in sync with ./categories.ts (checked by tests/loanRules.test.ts).
export const categoryValidator = v.union(
  v.literal("power tools"),
  v.literal("hand tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("other"),
);

export const conditionValidator = v.union(
  v.literal("like new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);

export const loanStatusValidator = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("active"),
  v.literal("returned"),
);

export const eventStatusValidator = v.union(
  v.literal("pending"),
  v.literal("sent"),
  v.literal("failed"),
  // Terminal: attempts exhausted or a non-retryable 4xx. The sweeper skips it.
  v.literal("dead"),
);
