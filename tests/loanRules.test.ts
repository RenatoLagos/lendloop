import { describe, expect, it } from "vitest";
import { CATEGORIES, CONDITIONS } from "../convex/lib/categories";
import {
  canTransition,
  daysBetween,
  isIsoDate,
  isOverdue,
  rangesOverlap,
  validateDateRange,
} from "../convex/lib/loanRules";

describe("date rules", () => {
  const today = "2026-11-01";
  it("accepts a valid range", () => expect(validateDateRange("2026-11-02", "2026-11-05", today)).toBeNull());
  it("accepts a one-day loan starting today", () => expect(validateDateRange(today, today, today)).toBeNull());
  it("rejects past start, inverted range, bad format, too long", () => {
    expect(validateDateRange("2026-10-31", "2026-11-05", today)).toMatch(/past/);
    expect(validateDateRange("2026-11-05", "2026-11-02", today)).toMatch(/End date/);
    expect(validateDateRange("11/02/2026", "2026-11-05", today)).toMatch(/YYYY-MM-DD/);
    expect(validateDateRange("2026-11-01", "2026-12-15", today)).toMatch(/at most/);
  });
  it("validates calendar dates", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
  });
  it("counts days", () => expect(daysBetween("2026-11-01", "2026-11-04")).toBe(3));
});

describe("overlap and state machine", () => {
  it("detects inclusive overlap", () => {
    expect(rangesOverlap({ startDate: "2026-11-01", endDate: "2026-11-03" }, { startDate: "2026-11-03", endDate: "2026-11-05" })).toBe(true);
    expect(rangesOverlap({ startDate: "2026-11-01", endDate: "2026-11-02" }, { startDate: "2026-11-03", endDate: "2026-11-05" })).toBe(false);
  });
  it("allows only valid transitions", () => {
    expect(canTransition("requested", "approved")).toBe(true);
    expect(canTransition("requested", "returned")).toBe(false);
    expect(canTransition("approved", "active")).toBe(true);
    expect(canTransition("active", "returned")).toBe(true);
    expect(canTransition("declined", "approved")).toBe(false);
    expect(canTransition("returned", "active")).toBe(false);
  });
  it("flags overdue only for loans still out", () => {
    expect(isOverdue({ status: "active", endDate: "2026-10-30" }, "2026-11-01")).toBe(true);
    expect(isOverdue({ status: "approved", endDate: "2026-10-30" }, "2026-11-01")).toBe(true);
    expect(isOverdue({ status: "returned", endDate: "2026-10-30" }, "2026-11-01")).toBe(false);
    expect(isOverdue({ status: "active", endDate: "2026-11-01" }, "2026-11-01")).toBe(false);
  });
});

describe("validators stay in sync with constants", () => {
  it("lists every category and condition in the schema validators", async () => {
    const { categoryValidator, conditionValidator } = await import("../convex/lib/validators");
    const cats = (categoryValidator as unknown as { members: { value: string }[] }).members.map((m) => m.value);
    const conds = (conditionValidator as unknown as { members: { value: string }[] }).members.map((m) => m.value);
    expect(cats).toEqual([...CATEGORIES]);
    expect(conds).toEqual([...CONDITIONS]);
  });
});
