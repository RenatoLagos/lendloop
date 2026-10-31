import { describe, expect, it } from "vitest";
import { decideWrite, notificationKey, parseReminderKey, reminderKey } from "../convex/lib/idempotency";

describe("idempotency keys", () => {
  it("formats the reminder key as loanId:date:overdue-reminder", () => {
    expect(reminderKey("k57abc", "2026-11-01")).toBe("k57abc:2026-11-01:overdue-reminder");
  });
  it("round-trips through parseReminderKey", () => {
    expect(parseReminderKey(reminderKey("k57abc", "2026-11-01"))).toEqual({ loanId: "k57abc", date: "2026-11-01" });
  });
  it("rejects malformed keys", () => {
    for (const bad of ["", "abc", "a:2026-1-1:overdue-reminder", "a:2026-11-01:other", "a b:2026-11-01:overdue-reminder"]) {
      expect(parseReminderKey(bad)).toBeNull();
    }
  });
  it("makes one notification key per loan per status", () => {
    expect(notificationKey("L1", "approved")).toBe("L1:approved:notification");
    expect(notificationKey("L1", "approved")).not.toBe(notificationKey("L1", "declined"));
  });
});

describe("decideWrite (dedup decision)", () => {
  it("inserts when nothing exists", () => {
    expect(decideWrite(null, "sent")).toBe("insert");
    expect(decideWrite(null, "failed")).toBe("insert");
  });
  it("treats a retry with the same status as a duplicate", () => {
    expect(decideWrite("sent", "sent")).toBe("duplicate");
    expect(decideWrite("failed", "failed")).toBe("duplicate");
  });
  it("upgrades failed -> sent but never downgrades sent", () => {
    expect(decideWrite("failed", "sent")).toBe("update");
    expect(decideWrite("sent", "failed")).toBe("duplicate");
  });
  it("lets a pending record be completed", () => {
    expect(decideWrite("pending", "sent")).toBe("update");
  });
});
