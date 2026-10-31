import { ConvexError } from "convex/values";

export function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const data = e.data as { message?: string } | string;
    return typeof data === "string" ? data : (data.message ?? "Request failed.");
  }
  return "Something went wrong. Please try again.";
}

export function timeAgo(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const units: [number, string][] = [[86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [size, label] of units) {
    if (s >= size) {
      const n = Math.floor(s / size);
      return `${n} ${label}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

export function activityLabel(a: { type: string; status: string; at: number }): string {
  const what = a.type === "overdue-reminder" ? "Reminder" : "Notification";
  const state = a.status === "sent" ? "sent" : a.status === "failed" ? "failed" : a.status === "dead" ? "failed (gave up)" : "pending";
  return `${what} ${state} ${timeAgo(a.at)}`;
}
