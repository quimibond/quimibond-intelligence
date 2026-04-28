// 03-pre-orphan-fix.mjs — snapshot detallado pre-migration #3
// (orphan resolution). Imprime fragmentación de SHAWMUT, FXI, etc.
//
// Uso: node scripts/audit-mdm-cleanup/03-pre-orphan-fix.mjs

import { fetchJson, fmtCount, fmtMxn } from "./lib.mjs";
import fs from "node:fs";

async function aggByName(canonical_id, rfc, fieldName) {
  const all = [];
  let offset = 0;
  while (true) {
    const data = await fetchJson(
      `/rest/v1/canonical_invoices?select=${fieldName},amount_total_mxn_resolved&receptor_canonical_company_id=eq.${canonical_id}&odoo_invoice_id=is.null&receptor_rfc=eq.${rfc}&limit=1000&offset=${offset}`
    );
    all.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  const byName = new Map();
  for (const r of all) {
    const n = r[fieldName] || "(null)";
    const cur = byName.get(n) || { count: 0, total: 0 };
    cur.count++;
    cur.total += Number(r.amount_total_mxn_resolved || 0);
    byName.set(n, cur);
  }
  return byName;
}

async function main() {
  console.log("=".repeat(80));
  console.log("PRE-ORPHAN FIX (migration #3)");
  console.log("=".repeat(80));

  console.log("\nMOSTRADOR id=11 — fragmentación pre-fix:");
  const mostrador = await aggByName(11, "XAXX010101000", "receptor_nombre");
  const sortedM = [...mostrador.entries()]
    .filter(([_, { count, total }]) => count >= 5 || total >= 50000)
    .sort((a, b) => b[1].total - a[1].total);
  console.log(`  Total nombres distintos: ${mostrador.size}`);
  console.log(`  High-volume (count>=5 OR total>=$50K): ${sortedM.length}`);
  console.log(`\n  Top 25 (los que migration #3 va a procesar):`);
  for (const [name, { count, total }] of sortedM.slice(0, 25)) {
    console.log(`    ${name.slice(0, 55).padEnd(55)} ${fmtCount(count).padStart(5)} ${fmtMxn(total).padStart(15)}`);
  }

  console.log("\n\nHANGZHOU id=630 — fragmentación pre-fix:");
  const hangzhou = await aggByName(630, "XEXX010101000", "receptor_nombre");
  const sortedH = [...hangzhou.entries()]
    .filter(([_, { count, total }]) => count >= 5 || total >= 50000)
    .sort((a, b) => b[1].total - a[1].total);
  console.log(`  Total nombres distintos: ${hangzhou.size}`);
  console.log(`  High-volume: ${sortedH.length}`);
  console.log(`\n  Top 20:`);
  for (const [name, { count, total }] of sortedH.slice(0, 20)) {
    console.log(`    ${name.slice(0, 55).padEnd(55)} ${fmtCount(count).padStart(5)} ${fmtMxn(total).padStart(15)}`);
  }

  // SHAWMUT fragmentation
  console.log("\n\nSHAWMUT specifically (todas las variantes):");
  const allShawmut = await fetchJson(
    "/rest/v1/canonical_invoices?select=receptor_nombre,receptor_canonical_company_id,amount_total_mxn_resolved&direction=eq.issued&receptor_nombre=ilike.*shawmut*&limit=500"
  );
  const shawmutByLocation = new Map();
  for (const r of allShawmut) {
    const key = `${r.receptor_canonical_company_id}|${r.receptor_nombre}`;
    const cur = shawmutByLocation.get(key) || { count: 0, total: 0 };
    cur.count++;
    cur.total += Number(r.amount_total_mxn_resolved || 0);
    shawmutByLocation.set(key, cur);
  }
  for (const [key, { count, total }] of [...shawmutByLocation.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const [cid, name] = key.split("|");
    console.log(`    canon=${cid.padStart(6)} ${name.slice(0, 35).padEnd(35)} ${fmtCount(count).padStart(5)} ${fmtMxn(total).padStart(15)}`);
  }

  fs.writeFileSync("/tmp/mdm-orphan-pre.json", JSON.stringify({
    timestamp: new Date().toISOString(),
    mostrador_distinct_names: mostrador.size,
    mostrador_high_volume: sortedM.length,
    hangzhou_distinct_names: hangzhou.size,
    hangzhou_high_volume: sortedH.length,
    top_25_mostrador: sortedM.slice(0, 25).map(([n, v]) => ({ name: n, ...v })),
    top_20_hangzhou: sortedH.slice(0, 20).map(([n, v]) => ({ name: n, ...v })),
  }, null, 2));
  console.log("\n✓ Snapshot saved to /tmp/mdm-orphan-pre.json");
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
