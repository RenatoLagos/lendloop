import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { signPayload } from "../convex/lib/hmac";

const require_ = createRequire(import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function codeOf(file: string, nodeName: string): string {
  const wf = JSON.parse(readFileSync(new URL(`../n8n/workflows/${file}`, import.meta.url), "utf8"));
  return wf.nodes.find((n: { name: string }) => n.name === nodeName).parameters.jsCode;
}

/** Runs an n8n Code node body with a minimal stub of the n8n runtime. */
async function runNode(code: string, env: Record<string, string>, json: unknown, raw?: string) {
  const fn = new AsyncFunction("require", "$env", "$input", "$getWorkflowStaticData", code);
  const ctx = {
    helpers: {
      getBinaryDataBuffer: async () => {
        if (raw === undefined) throw new Error("no binary");
        return Buffer.from(raw);
      },
    },
  };
  const store = {};
  return fn.call(ctx, require_, env, { first: () => ({ json }), all: () => [{ json }] }, () => store);
}

const secret = "unit-test-secret";
const payload = { eventId: "L1:approved:notification", status: "approved", recipientEmail: "a@b.test", toolName: "Drill", startDate: "2026-11-02", endDate: "2026-11-04" };
const raw = JSON.stringify(payload);

describe("n8n 'Verify signature' node accepts what Convex signs", () => {
  const code = codeOf("01-loan-event-notification.json", "Verify signature");
  const headersFor = (ts: string, sig: string) => ({ headers: { "x-lendloop-timestamp": ts, "x-lendloop-signature": sig }, body: payload });

  it("accepts a Convex-signed body", async () => {
    const ts = String(Date.now());
    const out = await runNode(code, { LENDLOOP_HMAC_SECRET: secret }, headersFor(ts, await signPayload(secret, ts, raw)), raw);
    expect(out[0].json.valid).toBe(true);
    expect(out[0].json.payload.eventId).toBe(payload.eventId);
  });

  it("rejects a tampered body", async () => {
    const ts = String(Date.now());
    const out = await runNode(code, { LENDLOOP_HMAC_SECRET: secret }, headersFor(ts, await signPayload(secret, ts, raw)), raw.replace("Drill", "Saw"));
    expect(out[0].json.valid).toBe(false);
  });

  it("rejects a stale timestamp", async () => {
    const ts = String(Date.now() - 10 * 60 * 1000);
    const out = await runNode(code, { LENDLOOP_HMAC_SECRET: secret }, headersFor(ts, await signPayload(secret, ts, raw)), raw);
    expect(out[0].json.valid).toBe(false);
  });

  it("fails closed without a secret", async () => {
    const out = await runNode(code, {}, { headers: {}, body: payload }, raw);
    expect(out[0].json.valid).toBe(false);
  });
});

describe("n8n workflow hardening", () => {
  const wfFile = (file: string) => JSON.parse(readFileSync(new URL(`../n8n/workflows/${file}`, import.meta.url), "utf8"));
  const verify = codeOf("01-loan-event-notification.json", "Verify signature");

  it("verifier fails closed when the raw body is unavailable", async () => {
    const ts = String(Date.now());
    const headers = { "x-lendloop-timestamp": ts, "x-lendloop-signature": await signPayload(secret, ts, raw) };
    const out = await runNode(verify, { LENDLOOP_HMAC_SECRET: secret }, { headers, body: payload }); // no raw binary
    expect(out[0].json).toMatchObject({ valid: false, reason: "missing_raw_body" });
    expect(verify).not.toContain("JSON.stringify");
  });

  it("write-back continues on error so one failure does not abort the other loans", () => {
    const writeBack = wfFile("02-overdue-reminders.json").nodes.find((n: { name: string }) => n.name === "Write back status");
    expect(writeBack.onError).toBe("continueRegularOutput");
    expect(writeBack.retryOnFail).toBe(true);
  });

  it("failed write-backs still fail the execution after all items were attempted", () => {
    const wf = wfFile("02-overdue-reminders.json");
    const types = Object.fromEntries(wf.nodes.map((n: { name: string; type: string }) => [n.name, n.type]));
    expect(wf.connections["Write back status"].main[0][0].node).toBe("Write-back failed?");
    expect(types["Write-back failed?"]).toBe("n8n-nodes-base.if");
    const trueBranch = wf.connections["Write-back failed?"].main[0][0].node;
    expect(types[trueBranch]).toBe("n8n-nodes-base.stopAndError");
    expect(wf.settings.errorWorkflow).toBeTruthy();
  });

  it("mock logs mask recipient emails", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    try {
      await runNode(codeOf("01-loan-event-notification.json", "Mock notification"), {}, { payload });
      const loan = { loanId: "L1", idempotencyKey: "L1:2026-11-01:overdue-reminder", borrowerEmail: "ben@x.test", toolName: "Drill", endDate: "2026-10-30", daysOverdue: 2 };
      await runNode(codeOf("02-overdue-reminders.json", "Mock reminder + sign"), { LENDLOOP_HMAC_SECRET: secret }, loan);
    } finally {
      spy.mockRestore();
    }
    expect(logs.length).toBe(2);
    expect(logs.join("\n")).not.toMatch(/a@b\.test|ben@x\.test/);
    expect(logs.join("\n")).toContain("***@");
  });
});

describe("n8n signed requests are accepted by Convex verification", () => {
  it("overdue GET signature verifies for an empty body", async () => {
    const out = await runNode(codeOf("02-overdue-reminders.json", "Sign GET request"), { LENDLOOP_HMAC_SECRET: secret }, {});
    const { timestamp, signature } = out[0].json;
    expect(signature).toBe(await signPayload(secret, timestamp, ""));
  });

  it("write-back signature verifies for the exact body and carries no email", async () => {
    const loan = { loanId: "L1", idempotencyKey: "L1:2026-11-01:overdue-reminder", borrowerEmail: "a@b.test", toolName: "Drill", endDate: "2026-10-30", daysOverdue: 2 };
    const out = await runNode(codeOf("02-overdue-reminders.json", "Mock reminder + sign"), { LENDLOOP_HMAC_SECRET: secret }, loan);
    const { body, timestamp, signature } = out[0].json;
    expect(signature).toBe(await signPayload(secret, timestamp, body));
    expect(JSON.parse(body)).toMatchObject({ loanId: "L1", status: "sent", idempotencyKey: loan.idempotencyKey });
    expect(body).not.toContain("a@b.test");
  });
});
