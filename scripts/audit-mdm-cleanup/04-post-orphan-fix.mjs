// 04-post-orphan-fix.mjs — verifica resultado post migration #3.
// Compara contra /tmp/mdm-orphan-pre.json y reporta deltas.
//
// Esperado:
//  - MOSTRADOR id=11 invoices: 2,076 → ~500-800 (los low-volume legítimos)
//  - HANGZHOU id=630 invoices: 299 → ~30-50
//  - Nuevos shadows con shadow_reason='orphan_resolved_from_default_sink'
//  - SHAWMUT id=1606 revenue 2026: ~$8M → ~$25M+
//  - FXI INC aparece como nuevo canonical_company con $90M+
//
// Uso: node scripts/audit-mdm-cleanup/04-post-orphan-fix.mjs

import { fetchJson, fmtCount, fmtMxn } from "./lib.mjs";
import fs from "node:fs";

async function main() {
  console.log("=".repeat(80));
  console.log("POST-ORPHAN FIX VERIFICATION (migration #3)");
  console.log("=".repeat(80));

  // 1. Default sinks remaining count
  const mostradorRem = await fetchJson(
    "/rest/v1/canonical_invoices?select=canonical_id&receptor_canonical_company_id=eq.11&odoo_invoice_id=is.null&receptor_rfc=eq.XAXX010101000&limit=10000"
  );
  const hangzhouRem = await fetchJson(
    "/rest/v1/canonical_invoices?select=canonical_id&receptor_canonical_company_id=eq.630&odoo_invoice_id=is.null&receptor_rfc=eq.XEXX010101000&limit=10000"
  );
  console.log(`\nDefault sinks remaining (low-volume mostradores legítimos):`);
  console.log(`  MOSTRADOR id=11:  ${fmtCount(mostradorRem.length)}`);
  console.log(`  HANGZHOU id=630:  ${fmtCount(hangzhouRem.length)}`);

  // 2. New shadows created
  const newShadows = await fetchJson(
    "/rest/v1/canonical_companies?select=id,display_name,canonical_name,rfc&shadow_reason=eq.orphan_resolved_from_default_sink&limit=200"
  );
  console.log(`\nNew shadows created: ${fmtCount(newShadows.length)}`);
  if (newShadows.length > 0) {
    console.log("  Top 15 shadows nuevos:");
    for (const s of newShadows.slice(0, 15)) {
      console.log(`    id=${s.id} rfc=${s.rfc} ${s.display_name.slice(0, 50)}`);
    }
  }

  // 3. SHAWMUT post-fix (todas las invoices ahora apuntan a id=1606)
  const shawmutAll = await fetchJson(
    "/rest/v1/canonical_invoices?select=canonical_id,amount_total_mxn_resolved&receptor_canonical_company_id=eq.1606&direction=eq.issued&is_quimibond_relevant=eq.true&limit=2000"
  );
  const shawmutTotal = shawmutAll.reduce((s, r) => s + Number(r.amount_total_mxn_resolved || 0), 0);
  const shawmut2026 = await fetchJson(
    "/rest/v1/canonical_invoices?select=canonical_id,amount_total_mxn_resolved&receptor_canonical_company_id=eq.1606&direction=eq.issued&is_quimibond_relevant=eq.true&invoice_date_resolved=gte.2026-01-01&limit=500"
  );
  const shawmut2026Total = shawmut2026.reduce((s, r) => s + Number(r.amount_total_mxn_resolved || 0), 0);
  console.log(`\nSHAWMUT id=1606:`);
  console.log(`  Total invoices (lifetime): ${fmtCount(shawmutAll.length)}, ${fmtMxn(shawmutTotal)}`);
  console.log(`  YTD 2026:                  ${fmtCount(shawmut2026.length)}, ${fmtMxn(shawmut2026Total)}`);

  // 4. FXI nuevo canonical (si lo creó migration #3)
  const fxiSearch = await fetchJson(
    "/rest/v1/canonical_companies?select=id,display_name,rfc&display_name=ilike.*fxi*&limit=10"
  );
  console.log(`\nFXI canonical_companies:`);
  for (const c of fxiSearch) {
    const inv = await fetchJson(
      `/rest/v1/canonical_invoices?select=canonical_id,amount_total_mxn_resolved&receptor_canonical_company_id=eq.${c.id}&direction=eq.issued&limit=500`
    );
    const tot = inv.reduce((s, r) => s + Number(r.amount_total_mxn_resolved || 0), 0);
    console.log(`  id=${c.id} ${c.display_name.padEnd(35)} rfc=${c.rfc} → ${fmtCount(inv.length)} fact, ${fmtMxn(tot)}`);
  }

  // 5. Compare against pre-snapshot
  if (fs.existsSync("/tmp/mdm-orphan-pre.json")) {
    const pre = JSON.parse(fs.readFileSync("/tmp/mdm-orphan-pre.json", "utf8"));
    console.log("\n=".repeat(80));
    console.log("COMPARACIÓN PRE / POST");
    console.log("=".repeat(80));
    console.log(`  MOSTRADOR distinct names:   ${pre.mostrador_distinct_names} → (post-fix queda solo low-vol)`);
    console.log(`  HANGZHOU  distinct names:   ${pre.hangzhou_distinct_names} → (idem)`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
