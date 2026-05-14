#!/usr/bin/env node
// CLI: imprime un reporte de integridad de datos.
//
// Uso:
//   node scripts/validate-data-integrity.mjs              # contra prod (default)
//   node scripts/validate-data-integrity.mjs --json       # raw JSON
//   BASE_URL=http://localhost:3000 node scripts/validate-data-integrity.mjs
//
// Requiere env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY si llama Supabase
// directo, o CRON_SECRET + BASE_URL si llama al endpoint /api/system/data-integrity.

const BASE_URL = process.env.BASE_URL || "https://quimibond-intelligence.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;
const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");

if (!CRON_SECRET) {
  console.error("Falta CRON_SECRET en env. Export it before running.");
  process.exit(2);
}

const res = await fetch(`${BASE_URL}/api/system/data-integrity`, {
  headers: { Authorization: `Bearer ${CRON_SECRET}` },
});
const body = await res.json();

if (asJson) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(body.overall === "critical" ? 1 : 0);
}

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", cyan: "\x1b[36m",
};
const icon = (s) => (s === "critical" ? `${C.red}✗${C.reset}` : s === "warning" ? `${C.yellow}⚠${C.reset}` : `${C.green}✓${C.reset}`);
const color = (s) => (s === "critical" ? C.red : s === "warning" ? C.yellow : C.green);

console.log("");
console.log(`${C.bold}Quimibond data-integrity audit${C.reset}  ${C.dim}${body.generated_at}${C.reset}`);
console.log(`${color(body.overall)}● ${body.overall.toUpperCase()}${C.reset}  ${body.criticals} críticos · ${body.warnings} warnings  ${C.dim}(${body.duration_ms}ms)${C.reset}`);
console.log("");

for (const p of body.probes) {
  console.log(`  ${icon(p.severity)} ${C.bold}${p.probe.padEnd(24)}${C.reset} ${p.message}`);
  if (p.severity !== "ok" && p.details) {
    const dump = JSON.stringify(p.details, null, 2).split("\n").map((l) => `      ${C.dim}${l}${C.reset}`).join("\n");
    console.log(dump);
  }
}
console.log("");
process.exit(body.overall === "critical" ? 1 : 0);
