/** Idempotency-key helpers and the dedup decision for write-backs. */

export type EventStatus = "pending" | "sent" | "failed" | "dead";

/** Overdue reminder key: `${loanId}:${YYYY-MM-DD}:overdue-reminder` (UTC day). */
export function reminderKey(loanId: string, isoDate: string): string {
  return `${loanId}:${isoDate}:overdue-reminder`;
}

/** Status-change notification key: one notification per loan per status. */
export function notificationKey(loanId: string, status: string): string {
  return `${loanId}:${status}:notification`;
}

const REMINDER_KEY = /^([A-Za-z0-9_-]+):(\d{4}-\d{2}-\d{2}):overdue-reminder$/;

export function parseReminderKey(
  key: string,
): { loanId: string; date: string } | null {
  const m = REMINDER_KEY.exec(key);
  return m ? { loanId: m[1], date: m[2] } : null;
}

/**
 * Decide what a write-back should do given the existing record (if any).
 * - no record            -> insert
 * - same status          -> duplicate (retry; no-op)
 * - failed -> sent       -> update (a later retry succeeded)
 * - sent -> anything     -> duplicate (never downgrade a delivered reminder)
 */
export function decideWrite(
  existing: EventStatus | null,
  incoming: "sent" | "failed",
): "insert" | "update" | "duplicate" {
  if (existing === null) return "insert";
  if (existing === "sent" || existing === "dead") return "duplicate"; // sent/dead are terminal
  if (existing === incoming) return "duplicate";
  return "update";
}
