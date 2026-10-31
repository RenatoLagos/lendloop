// Offline validation of the exported n8n workflows (no n8n needed).
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../n8n/workflows/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const errors = [];
const ids = new Set();
const wfs = files.map((f) => {
  const text = readFileSync(new URL(f, dir), "utf8");
  let json;
  try { json = JSON.parse(text); } catch (e) { errors.push(`${f}: invalid JSON (${e.message})`); return null; }
  ids.add(json.id);
  return { f, text, json };
}).filter(Boolean);

const SECRET_PATTERNS = [
  [/[0-9a-f]{32,}/i, "long hex string (looks like a secret/key)"],
  [/sk_(test|live)_/i, "Clerk secret key"],
  [/Bearer\s+[A-Za-z0-9._-]{16,}/, "bearer token"],
  [/LENDLOOP_HMAC_SECRET["']?\s*[:=]\s*["'][^"']+["']/, "literal HMAC secret assignment"],
];

for (const { f, text, json } of wfs) {
  if (!Array.isArray(json.nodes) || typeof json.connections !== "object") errors.push(`${f}: missing nodes/connections`);
  const names = new Set(json.nodes.map((n) => n.name));
  if (names.size !== json.nodes.length) errors.push(`${f}: duplicate node names`);
  for (const [from, c] of Object.entries(json.connections)) {
    if (!names.has(from)) errors.push(`${f}: connection from unknown node ${from}`);
    for (const outs of c.main) for (const t of outs ?? []) if (!names.has(t.node)) errors.push(`${f}: connection to unknown node ${t.node}`);
  }
  for (const n of json.nodes) if (!n.type?.startsWith("n8n-nodes-base.")) errors.push(`${f}: unexpected node type ${n.type}`);
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) errors.push(`${f}: ${label}`);
  const ew = json.settings?.errorWorkflow;
  if (ew && !ids.has(ew)) errors.push(`${f}: errorWorkflow ${ew} not found among exported workflows`);
  if (/credentials/.test(text) && /"password"|"apiKey"/.test(text)) errors.push(`${f}: inline credential fields`);
  // Every secret access must go through $env.
  const refs = text.match(/LENDLOOP_HMAC_SECRET/g)?.length ?? 0;
  const envRefs = text.match(/\$env\.LENDLOOP_HMAC_SECRET/g)?.length ?? 0;
  const messages = (text.match(/LENDLOOP_HMAC_SECRET is not set/g)?.length ?? 0) + (text.match(/Signature = HMAC-SHA256\(LENDLOOP_HMAC_SECRET/g)?.length ?? 0) + (text.match(/key LENDLOOP_HMAC_SECRET/g)?.length ?? 0);
  if (refs > envRefs + messages) errors.push(`${f}: LENDLOOP_HMAC_SECRET referenced outside $env access`);
}

if (errors.length) {
  console.error("n8n validation FAILED:\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log(`n8n validation OK: ${wfs.length} workflows (${files.join(", ")}), no secret literals.`);
