/** Pure loan business rules (dates, overlap, state machine, overdue). */

export type LoanStatus =
  | "requested"
  | "approved"
  | "declined"
  | "active"
  | "returned";

export const MAX_LOAN_DAYS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function todayUtc(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

/** Returns an error message, or null when the range is acceptable. */
export function validateDateRange(
  start: string,
  end: string,
  today: string,
): string | null {
  if (!isIsoDate(start) || !isIsoDate(end)) return "Dates must be YYYY-MM-DD.";
  if (start < today) return "Start date cannot be in the past.";
  if (end < start) return "End date must be on or after the start date.";
  if (daysBetween(start, end) + 1 > MAX_LOAN_DAYS) {
    return `A loan can last at most ${MAX_LOAN_DAYS} days.`;
  }
  return null;
}

/** Inclusive range overlap. */
export function rangesOverlap(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

const TRANSITIONS: Record<LoanStatus, LoanStatus[]> = {
  requested: ["approved", "declined"],
  approved: ["active", "returned"],
  active: ["returned"],
  declined: [],
  returned: [],
};

export function canTransition(from: LoanStatus, to: LoanStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A loan is overdue when it is still out (approved/active) past its end date. */
export function isOverdue(
  loan: { status: LoanStatus; endDate: string },
  today: string,
): boolean {
  return (loan.status === "approved" || loan.status === "active") && loan.endDate < today;
}

/** Statuses that block the tool for overlapping dates. */
export const BLOCKING_STATUSES: LoanStatus[] = ["approved", "active"];
