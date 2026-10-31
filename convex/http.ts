import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "./lib/hmac";
import { parseReminderKey, reminderKey } from "./lib/idempotency";
import { daysBetween, isIsoDate, todayUtc } from "./lib/loanRules";

const http = httpRouter();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** Verifies the HMAC + timestamp. Returns the raw body, or a 401 Response. */
async function authenticate(req: Request): Promise<{ raw: string } | Response> {
  const raw = await req.text();
  const result = await verifySignature({
    secret: process.env.LENDLOOP_HMAC_SECRET,
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    signature: req.headers.get(SIGNATURE_HEADER),
    rawBody: raw,
  });
  if (!result.ok) {
    // Generic body: do not tell an attacker which check failed. Reason is logged.
    console.warn(`n8n request rejected: ${result.reason}`);
    return json({ error: "unauthorized" }, 401);
  }
  return { raw };
}

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;
    const loans = await ctx.runQuery(internal.automation.overdueLoans, {});
    return json({ loans });
  }),
});

http.route({
  path: "/n8n/reminder-status",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(auth.raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const { loanId, idempotencyKey, status, detail } = body;
    if (
      typeof loanId !== "string" ||
      typeof idempotencyKey !== "string" ||
      (status !== "sent" && status !== "failed") ||
      (detail !== undefined && typeof detail !== "string")
    ) {
      return json({ error: "invalid_body" }, 400);
    }
    // The key must be well-formed, belong to this loan, and be for ~today (UTC).
    const parsed = parseReminderKey(idempotencyKey);
    if (
      !parsed ||
      !isIsoDate(parsed.date) || // NaN day diffs would slip past the +/- 1 day check
      parsed.loanId !== loanId ||
      idempotencyKey !== reminderKey(loanId, parsed.date) ||
      Math.abs(daysBetween(parsed.date, todayUtc())) > 1
    ) {
      return json({ error: "invalid_idempotency_key" }, 400);
    }

    const out = await ctx.runMutation(internal.automation.recordReminder, {
      loanId,
      idempotencyKey,
      status,
      detail,
    });
    if (out.result === "unknown_loan") return json({ error: "unknown_loan" }, 404);
    return json({ ok: true, result: out.result });
  }),
});

export default http;
