#!/usr/bin/env node
/**
 * Fase 0 del plan de memoria: corre las 40 preguntas de questions.json contra
 * /api/chat y guarda respuestas + calificación automática mínima (fragmentos
 * esperados, latencia, tools usadas). La calificación fina es humana: el JSON
 * de salida se revisa a mano y se compara entre corridas (baseline vs cada
 * fase).
 *
 * Uso:
 *   BASE_URL=https://quimibond-intelligence.vercel.app QB_AUTH_COOKIE=... \
 *     node scripts/memory-eval/run.mjs [--only q01,q05] [--label baseline]
 *
 * Auth: /api/chat va detrás del middleware de AUTH_PASSWORD; se manda la
 * cookie `qb-auth` (QB_AUTH_COOKIE). Salida en scripts/memory-eval/results/.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL;
const COOKIE = process.env.QB_AUTH_COOKIE;
if (!BASE_URL) {
  console.error("BASE_URL es obligatorio (p.ej. https://quimibond-intelligence.vercel.app)");
  process.exit(2);
}

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = argVal("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const label = argVal("--label") ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

const { questions } = JSON.parse(readFileSync(join(here, "questions.json"), "utf-8"));
const selected = only ? questions.filter((q) => only.includes(q.id)) : questions;

async function ask(message) {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE ? { Cookie: `qb-auth=${COOKIE}` } : {}),
    },
    body: JSON.stringify({ message, history: [] }),
  });
  if (!res.ok) {
    return { text: "", tools: [], error: `${res.status} ${await res.text().catch(() => "")}`.slice(0, 300), ms: Date.now() - started };
  }
  // SSE: eventos {type: tool|delta|done|error}
  const raw = await res.text();
  let text = "";
  const tools = [];
  let error = null;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim());
      if (ev.type === "delta") text += ev.text ?? ev.delta ?? "";
      else if (ev.type === "tool") tools.push(ev.name);
      else if (ev.type === "done" && ev.text) text = ev.text;
      else if (ev.type === "error") error = ev.message ?? String(ev.error ?? "error");
    } catch {
      /* línea parcial */
    }
  }
  return { text, tools, error, ms: Date.now() - started };
}

const results = [];
for (const q of selected) {
  process.stdout.write(`${q.id} ${q.q.slice(0, 60)}… `);
  const r = await ask(q.q);
  const lower = r.text.toLowerCase();
  const hits = (q.expect ?? []).filter((e) => lower.includes(String(e).toLowerCase()));
  const passAuto = q.expect?.length ? hits.length === q.expect.length : null;
  console.log(r.error ? `ERROR ${r.error}` : `${Math.round(r.ms / 1000)}s tools=[${r.tools.join(",")}] auto=${passAuto === null ? "n/a" : passAuto ? "ok" : "miss"}`);
  results.push({
    id: q.id,
    area: q.area,
    question: q.q,
    expect: q.expect,
    notes: q.notes,
    answer: r.text,
    tools: r.tools,
    latency_ms: r.ms,
    auto_pass: passAuto,
    error: r.error,
    human_score: null,
    human_notes: "",
  });
}

const outDir = join(here, "results");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${label}.json`);
const summary = {
  label,
  base_url: BASE_URL,
  run_at: new Date().toISOString(),
  total: results.length,
  errors: results.filter((r) => r.error).length,
  auto_pass: results.filter((r) => r.auto_pass === true).length,
  auto_evaluable: results.filter((r) => r.auto_pass !== null).length,
  avg_latency_ms: Math.round(results.reduce((s, r) => s + r.latency_ms, 0) / Math.max(results.length, 1)),
  tool_usage: results.flatMap((r) => r.tools).reduce((acc, t) => ((acc[t] = (acc[t] ?? 0) + 1), acc), {}),
};
writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
console.log("\nResumen:", JSON.stringify(summary, null, 2));
console.log(`Guardado en ${outPath}. Califica human_score (0-2) a mano y compara contra la corrida baseline.`);
