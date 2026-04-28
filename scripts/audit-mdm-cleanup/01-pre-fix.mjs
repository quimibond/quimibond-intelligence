// 01-pre-fix.mjs — snapshot pre-migration de los counts/values que las
// 3 migrations van a cambiar. Imprime + guarda en /tmp/mdm-pre.json
// para comparar después con 04-post-orphan-fix.mjs.
//
// Uso: node scripts/audit-mdm-cleanup/01-pre-fix.mjs

import { fetchJson, fmtCount, fmtMxn } from "./lib.mjs";
import fs from "node:fs";

async function main() {
  console.log("=".repeat(70));
  console.log("MDM CLEANUP — PRE-FIX SNAPSHOT (" + new Date().toISOString() + ")");
  console.log("=".repeat(70));

  // 1. matcher_company current state
  const matcherTest = await fetchJson(
    "/rest/v1/rpc/matcher_company?select=*"
  ).catch(() => null);
  // Direct call via POST
  const resp1 = await fetch(
    process.env.SUPABASE_URL + "/rest/v1/rpc/matcher_company",
    {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_rfc: "XEXX010101000",
        p_name: "SHAWMUT LLC",
        p_domain: null,
        p_autocreate_shadow: false,
      }),
    }
  );
  const matcherShawmut = await resp1.text();
  console.log("\nmatcher_company('XEXX010101000', 'SHAWMUT LLC'):");
  console.log("  → " + matcherShawmut + (matcherShawmut.includes("630") ? " ⚠ BUG (should be 1606)" : " ✓"));

  // 2. SHAWMUT 2026 invoices/revenue
  const shawmutInvoices = await fetchJson(
    "/rest/v1/canonical_invoices?select=canonical_id,amount_total_mxn_resolved&receptor_canonical_company_id=eq.1606&invoice_date_resolved=gte.2026-01-01&direction=eq.issued&is_quimibond_relevant=eq.true&limit=1000"
  );
  const shawmutRev2026 = shawmutInvoices.reduce((s, r) => s + Number(r.amount_total_mxn_resolved || 0), 0);
  console.log(`\nSHAWMUT id=1606 invoices 2026: ${fmtCount(shawmutInvoices.length)}, revenue ${fmtMxn(shawmutRev2026)}`);

  // 3. MOSTRADOR id=11 SAT-only orphans count
  const mostradorOrphans = await fetchJson(
    "/rest/v1/canonical_invoices?select=canonical_id&receptor_canonical_company_id=eq.11&odoo_invoice_id=is.null&receptor_rfc=eq.XAXX010101000&limit=10000"
  );
  console.log(`MOSTRADOR id=11 SAT-only orphans: ${fmtCount(mostradorOrphans.length)}`);

  // 4. HANGZHOU id=630 SAT-only orphans count
  const hangzhouOrphans = await fetchJson(
    "/rest/v1/canonical_invoices?select=canonical_id&receptor_canonical_company_id=eq.630&odoo_invoice_id=is.null&receptor_rfc=eq.XEXX010101000&limit=10000"
  );
  console.log(`HANGZHOU id=630 SAT-only orphans: ${fmtCount(hangzhouOrphans.length)}`);

  // 5. canonical_payments stale FK count
  // Vía RPC público no hay; usar PostgREST REST query con join no es trivial.
  // Reportamos lo conocido del audit.
  console.log("\ncanonical_payments stale FK (audit 2026-04-28): 31 rows / $2.44M MXN");

  // 6. Top 10 nombres distintos en MOSTRADOR id=11 (preview de fragmentación)
  const namesData = await fetchJson(
    "/rest/v1/canonical_invoices?select=receptor_nombre,amount_total_mxn_resolved&receptor_canonical_company_id=eq.11&odoo_invoice_id=is.null&receptor_rfc=eq.XAXX010101000&limit=5000"
  );
  const byName = new Map();
  for (const r of namesData) {
    const n = r.receptor_nombre || "(null)";
    const cur = byName.get(n) || { count: 0, total: 0 };
    cur.count++;
    cur.total += Number(r.amount_total_mxn_resolved || 0);
    byName.set(n, cur);
  }
  const sorted = [...byName.entries()].sort((a, b) => b[1].total - a[1].total);
  console.log("\nTop 10 nombres en MOSTRADOR id=11 (high-volume orphans):");
  for (const [name, { count, total }] of sorted.slice(0, 10)) {
    console.log(`  ${name.slice(0, 50).padEnd(50)} ${fmtCount(count).padStart(5)} fact  ${fmtMxn(total)}`);
  }

  // Save snapshot
  const snap = {
    timestamp: new Date().toISOString(),
    matcher_shawmut_returns: matcherShawmut.trim(),
    shawmut_invoices_2026: shawmutInvoices.length,
    shawmut_revenue_2026: shawmutRev2026,
    mostrador_id_11_orphans: mostradorOrphans.length,
    hangzhou_id_630_orphans: hangzhouOrphans.length,
    distinct_names_in_mostrador: byName.size,
    top_10_orphans: sorted.slice(0, 10).map(([n, { count, total }]) => ({ name: n, count, total })),
  };
  fs.writeFileSync("/tmp/mdm-pre.json", JSON.stringify(snap, null, 2));
  console.log("\n✓ Snapshot saved to /tmp/mdm-pre.json");
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
