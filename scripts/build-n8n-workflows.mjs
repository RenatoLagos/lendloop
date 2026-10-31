// Generates the importable n8n workflow JSON files in n8n/workflows/.
// Run: node scripts/build-n8n-workflows.mjs
// Code-node sources live here as plain template strings so they stay reviewable.
// Secrets are NEVER embedded: nodes read $env.LENDLOOP_HMAC_SECRET at runtime.
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const OUT = new URL("../n8n/workflows/", import.meta.url);
mkdirSync(OUT, { recursive: true });

// Stable ids so re-generating does not churn the diff.
const uid = (name) => {
  const h = createHash("sha1").update(name).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const ERROR_WORKFLOW_ID = "lendloopErrorHandler01";
const settings = { executionOrder: "v1", errorWorkflow: ERROR_WORKFLOW_ID, saveManualExecutions: true };

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters, id: uid(name), name, type, typeVersion, position, ...extra,
});
const link = (from, to, outIdx = 0) => ({ from, to, outIdx });
const connections = (links) => {
  const c = {};
  for (const { from, to, outIdx } of links) {
    c[from] ??= { main: [] };
    c[from].main[outIdx] ??= [];
    c[from].main[outIdx].push({ node: to, type: "main", index: 0 });
  }
  return c;
};
const retry = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

// ---------------------------------------------------------------- workflow 1
const verifyCode = `// Verifies HMAC-SHA256(secret, \`\${timestamp}.\${rawBody}\`) sent by Convex.
// Same scheme as convex/lib/hmac.ts. Requires NODE_FUNCTION_ALLOW_BUILTIN=crypto
// and N8N_BLOCK_ENV_ACCESS_IN_NODE=false (set in docker-compose.yml).
const crypto = require('crypto');
const secret = $env.LENDLOOP_HMAC_SECRET;
const item = $input.first();
const headers = item.json.headers || {};
const ts = headers['x-lendloop-timestamp'];
const sig = headers['x-lendloop-signature'];

const reject = (reason) => {
  console.warn('LendLoop webhook rejected: ' + reason); // reason stays in n8n logs, not in the HTTP response
  return [{ json: { valid: false, reason } }];
};

// The signature covers the exact bytes Convex sent (Webhook option "Raw Body").
// Re-serialising the parsed JSON could differ byte-for-byte, so fail closed instead.
let raw;
try {
  raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
} catch (e) {
  return reject('missing_raw_body');
}

if (!secret) return reject('missing_secret');
if (!ts || !sig) return reject('missing_headers');
if (!/^\\d{10,16}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) {
  return reject('bad_or_expired_timestamp');
}
const expected = Buffer.from(crypto.createHmac('sha256', secret).update(ts + '.' + raw).digest('hex'));
const received = Buffer.from(String(sig).trim().toLowerCase());
if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
  return reject('signature_mismatch');
}
let payload;
try { payload = JSON.parse(raw); } catch (e) { return reject('invalid_json'); }
if (!payload.eventId || !payload.recipientEmail || !payload.status) return reject('missing_fields');

return [{ json: { valid: true, payload } }];`;

const notifyCode = `// MOCK notification: logs the message. To send real email/Slack, replace this node
// with a Send Email / Slack node fed by $json.message and $json.to.
// Dedup: Convex already dedups by eventId; this static-data check guards against
// duplicate deliveries (retries) reaching a real channel. Only active/production runs persist it.
const p = $input.first().json.payload;
const sd = $getWorkflowStaticData('global');
sd.seen = sd.seen || {};
const now = Date.now();
for (const [k, t] of Object.entries(sd.seen)) if (now - t > 24 * 3600 * 1000) delete sd.seen[k];
const duplicate = Boolean(sd.seen[p.eventId]);

// Mask the local part so logs (and saved executions) do not hold full addresses.
const maskEmail = (e) => { const [u, d] = String(e).split('@'); return d ? u.slice(0, 1) + '***@' + d : '***'; };

const text = {
  requested: \`New borrow request for "\${p.toolName}" (\${p.startDate} to \${p.endDate}).\`,
  approved:  \`Your request for "\${p.toolName}" was approved (\${p.startDate} to \${p.endDate}).\`,
  declined:  \`Your request for "\${p.toolName}" was declined.\`,
  active:    \`"\${p.toolName}" has been handed over. Please return it by \${p.endDate}.\`,
  returned:  \`"\${p.toolName}" was marked as returned.\`,
}[p.status] || \`Loan for "\${p.toolName}" is now \${p.status}.\`;

if (!duplicate) {
  console.log('[MOCK NOTIFICATION] to=' + maskEmail(p.recipientEmail) + ' event=' + p.eventId + ' :: ' + text);
  sd.seen[p.eventId] = now;
}
return [{ json: { ok: true, duplicate, eventId: p.eventId, to: maskEmail(p.recipientEmail), message: text } }];`;

const ifTrue = (leftExpr) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
    conditions: [{
      id: uid("cond-" + leftExpr), leftValue: leftExpr, rightValue: "",
      operator: { type: "boolean", operation: "true", singleValue: true },
    }],
    combinator: "and",
  },
  options: {},
});

const wf1 = {
  name: "LendLoop - Loan event notification",
  id: "lendloopLoanEvents01",
  nodes: [
    node("Webhook", "n8n-nodes-base.webhook", 2, [0, 200], {
      httpMethod: "POST", path: "lendloop-loan-events", responseMode: "responseNode",
      options: { rawBody: true },
    }, { webhookId: uid("webhook-loan-events") }),
    node("Verify signature", "n8n-nodes-base.code", 2, [240, 200], { jsCode: verifyCode }),
    node("Signature valid?", "n8n-nodes-base.if", 2.2, [480, 200], ifTrue("={{ $json.valid }}")),
    node("Mock notification", "n8n-nodes-base.code", 2, [720, 100], { jsCode: notifyCode }),
    node("Respond 200", "n8n-nodes-base.respondToWebhook", 1.1, [960, 100], {
      respondWith: "json",
      responseBody: "={{ JSON.stringify({ ok: true, eventId: $json.eventId, duplicate: $json.duplicate }) }}",
      options: { responseCode: 200 },
    }),
    node("Respond 401", "n8n-nodes-base.respondToWebhook", 1.1, [720, 320], {
      respondWith: "json", responseBody: '{"error":"unauthorized"}', options: { responseCode: 401 },
    }),
    node("Note", "n8n-nodes-base.stickyNote", 1, [0, 360], {
      content: "Convex -> n8n. Signature = HMAC-SHA256(LENDLOOP_HMAC_SECRET, `${timestamp}.${rawBody}`). Invalid or stale requests get 401 and are never processed. Convex records the 2xx/non-2xx outcome on the loan (automationEvents) and retries failures.",
      width: 420, height: 120,
    }),
  ],
  connections: connections([
    link("Webhook", "Verify signature"),
    link("Verify signature", "Signature valid?"),
    link("Signature valid?", "Mock notification", 0),
    link("Signature valid?", "Respond 401", 1),
    link("Mock notification", "Respond 200"),
  ]),
  settings, active: false, pinData: {}, tags: [],
};

// ---------------------------------------------------------------- workflow 2
const signGetCode = `// Signs the (empty-body) GET request: HMAC-SHA256(secret, \`\${timestamp}.\`)
const crypto = require('crypto');
const secret = $env.LENDLOOP_HMAC_SECRET;
if (!secret) throw new Error('LENDLOOP_HMAC_SECRET is not set in the n8n environment');
const timestamp = String(Date.now());
const signature = crypto.createHmac('sha256', secret).update(timestamp + '.').digest('hex');
return [{ json: { timestamp, signature } }];`;

const reminderCode = `// MOCK reminder per overdue loan, then sign the write-back body.
// Replace the console.log with a Send Email / Slack node for real delivery; on delivery
// failure set status to 'failed' so Convex records it (and a later run can succeed: failed -> sent).
const crypto = require('crypto');
const secret = $env.LENDLOOP_HMAC_SECRET;
if (!secret) throw new Error('LENDLOOP_HMAC_SECRET is not set in the n8n environment');

// Mask the local part so logs (and saved executions) do not hold full addresses.
const maskEmail = (e) => { const [u, d] = String(e).split('@'); return d ? u.slice(0, 1) + '***@' + d : '***'; };

return $input.all().map((item) => {
  const l = item.json;
  console.log('[MOCK REMINDER] to=' + maskEmail(l.borrowerEmail) + ' :: "' + l.toolName + '" was due ' + l.endDate + ' (' + l.daysOverdue + ' day(s) overdue)');
  const body = JSON.stringify({
    loanId: l.loanId,
    idempotencyKey: l.idempotencyKey, // minted by Convex: <loanId>:<YYYY-MM-DD>:overdue-reminder
    status: 'sent',
    detail: 'mock reminder logged',
  });
  const timestamp = String(Date.now());
  const signature = crypto.createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
  return { json: { body, timestamp, signature } };
});`;

const sigHeaders = {
  sendHeaders: true,
  headerParameters: { parameters: [
    { name: "X-LendLoop-Timestamp", value: "={{ $json.timestamp }}" },
    { name: "X-LendLoop-Signature", value: "={{ $json.signature }}" },
  ] },
};

const wf2 = {
  name: "LendLoop - Overdue reminders",
  id: "lendloopOverdue0001",
  nodes: [
    node("Daily 09:00", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 200], {
      rule: { interval: [{ field: "days", daysInterval: 1, triggerAtHour: 9 }] },
    }),
    node("Sign GET request", "n8n-nodes-base.code", 2, [220, 200], { jsCode: signGetCode }),
    node("Fetch overdue loans", "n8n-nodes-base.httpRequest", 4.2, [440, 200], {
      method: "GET", url: "={{ $env.CONVEX_SITE_URL + '/n8n/overdue-loans' }}",
      ...sigHeaders, options: { timeout: 15000 },
    }, retry),
    node("Split loans", "n8n-nodes-base.splitOut", 1, [660, 200], { fieldToSplitOut: "loans", options: {} }),
    node("Mock reminder + sign", "n8n-nodes-base.code", 2, [880, 200], { jsCode: reminderCode }),
    node("Write back status", "n8n-nodes-base.httpRequest", 4.2, [1100, 200], {
      method: "POST", url: "={{ $env.CONVEX_SITE_URL + '/n8n/reminder-status' }}",
      ...sigHeaders,
      sendBody: true, contentType: "raw", rawContentType: "application/json", body: "={{ $json.body }}",
      options: { timeout: 15000 },
    // Each loan is independent: after 3 failed tries keep going with the next item
    // instead of aborting the whole run; "Write-back failed?" fails the run afterwards.
    }, { ...retry, onError: "continueRegularOutput" }),
    // Every write-back is attempted first (n8n runs a node over all items before the next
    // node starts); only then do failed items fail the execution so the error workflow alerts.
    node("Write-back failed?", "n8n-nodes-base.if", 2.2, [1320, 200], ifTrue("={{ $json.error !== undefined }}")),
    node("Fail run", "n8n-nodes-base.stopAndError", 1, [1540, 120], {
      errorMessage: "One or more overdue-reminder write-backs failed after retries (see this execution for the failed items).",
    }),
    node("Note", "n8n-nodes-base.stickyNote", 1, [0, 380], {
      content: "Daily: signed GET to Convex -> one mock reminder per overdue loan -> signed idempotent write-back (key <loanId>:<date>:overdue-reminder). HTTP nodes retry 3x. A failed write-back does not abort the run: every loan is attempted, then 'Fail run' fails the execution so the error workflow alerts. A real email provider must be idempotent per idempotencyKey, because a failed write-back means the same reminder is offered again on the next run.",
      width: 480, height: 150,
    }),
  ],
  connections: connections([
    link("Daily 09:00", "Sign GET request"),
    link("Sign GET request", "Fetch overdue loans"),
    link("Fetch overdue loans", "Split loans"),
    link("Split loans", "Mock reminder + sign"),
    link("Mock reminder + sign", "Write back status"),
    link("Write back status", "Write-back failed?"),
    link("Write-back failed?", "Fail run", 0),
  ]),
  settings, active: false, pinData: {}, tags: [],
};

// ---------------------------------------------------------------- workflow 3
const alertCode = `// Builds an alert from execution METADATA only (no loan data, no payloads).
const e = $input.first().json;
const wfName = e.workflow && e.workflow.name;
const err = (e.execution && e.execution.error && e.execution.error.message) || 'unknown error';
const text = 'LendLoop automation FAILED: "' + wfName + '" execution ' + (e.execution && e.execution.id) +
  ' at node "' + ((e.execution && e.execution.lastNodeExecuted) || '?') + '": ' + err.slice(0, 300) +
  (e.execution && e.execution.url ? ' -> ' + e.execution.url : '');
console.error('[LENDLOOP ERROR] ' + text); // always visible in n8n logs + execution list
return [{ json: { text, content: text } }];`;

const wf3 = {
  name: "LendLoop - Error handler",
  id: ERROR_WORKFLOW_ID,
  nodes: [
    node("Error Trigger", "n8n-nodes-base.errorTrigger", 1, [0, 200], {}),
    node("Format alert", "n8n-nodes-base.code", 2, [220, 200], { jsCode: alertCode }),
    node("Alert channel configured?", "n8n-nodes-base.if", 2.2, [440, 200], {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [{
          id: uid("cond-alert-url"), leftValue: "={{ $env.ALERT_WEBHOOK_URL }}", rightValue: "",
          operator: { type: "string", operation: "notEmpty", singleValue: true },
        }],
        combinator: "and",
      },
      options: {},
    }),
    node("Post to Slack/Discord webhook", "n8n-nodes-base.httpRequest", 4.2, [680, 120], {
      method: "POST", url: "={{ $env.ALERT_WEBHOOK_URL }}",
      sendBody: true, specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ text: $json.text, content: $json.content }) }}",
      options: { timeout: 10000 },
    }, retry),
  ],
  connections: connections([
    link("Error Trigger", "Format alert"),
    link("Format alert", "Alert channel configured?"),
    link("Alert channel configured?", "Post to Slack/Discord webhook", 0),
  ]),
  settings: { executionOrder: "v1" }, active: false, pinData: {}, tags: [],
};

const files = {
  "01-loan-event-notification.json": wf1,
  "02-overdue-reminders.json": wf2,
  "00-error-handler.json": wf3,
};
for (const [file, wf] of Object.entries(files)) {
  writeFileSync(new URL(file, OUT), JSON.stringify(wf, null, 2) + "\n");
  console.log("wrote n8n/workflows/" + file);
}
