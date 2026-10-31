export const CATEGORIES = [
  "power tools",
  "hand tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CONDITIONS = ["like new", "good", "fair", "worn"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const LIMITS = { name: 80, description: 500 } as const;
