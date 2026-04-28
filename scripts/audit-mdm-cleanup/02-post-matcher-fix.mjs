// 02-post-matcher-fix.mjs — verifica que matcher_company ahora retorna
// el ID correcto para varios test cases (post migration #1).
//
// Uso: node scripts/audit-mdm-cleanup/02-post-matcher-fix.mjs

import { fmtCount, fmtMxn } from "./lib.mjs";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function callMatcher(rfc, name, autocreate = false) {
  const resp = await fetch(URL + "/rest/v1/rpc/matcher_company", {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: "Bearer " + KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_rfc: rfc,
      p_name: name,
      p_domain: null,
      p_autocreate_shadow: autocreate,
    }),
  });
  return await resp.text();
}

async function main() {
  console.log("=".repeat(70));
  console.log("POST-MATCHER FIX VERIFICATION");
  console.log("=".repeat(70));

  // Expected: 1606 (SHAWMUT real)
  const r1 = await callMatcher("XEXX010101000", "SHAWMUT LLC", false);
  const r1Pass = r1.trim() === "1606";
  console.log(`\nmatcher('XEXX', 'SHAWMUT LLC') = ${r1.trim()}  ${r1Pass ? "✓" : "✗ (expected 1606)"}`);

  // Expected: NULL or shadow (no canonical with that name)
  const r2 = await callMatcher("XAXX010101000", "ALEJANDRO CERVANTES MARTÍNEZ", false);
  const r2Pass = r2.trim() === "null" || r2.trim() === "";
  console.log(`matcher('XAXX', 'ALEJANDRO CERVANTES MARTÍNEZ') = ${r2.trim()}  ${r2Pass ? "✓ (no existing canonical)" : "(some match)"}`);

  // Expected: 317 (existing JORGE JUÁREZ canonical)
  const r3 = await callMatcher("XAXX010101000", "JORGE JUÁREZ", false);
  console.log(`matcher('XAXX', 'JORGE JUÁREZ') = ${r3.trim()}  ${r3.trim() === "317" ? "✓" : "(may need migration #3 fuzzy 0.70)"}`);

  // Expected: 633 (existing JESUS ESCAMILLA)
  const r4 = await callMatcher("XAXX010101000", "JESÚS ESCAMILLA JAIMES", false);
  console.log(`matcher('XAXX', 'JESÚS ESCAMILLA JAIMES') = ${r4.trim()}  ${r4.trim() === "633" ? "✓" : "(may need migration #3 fuzzy 0.70)"}`);

  // Real RFC test (no generic)
  const r5 = await callMatcher("PNT920218IW5", "Quimibond", false);
  console.log(`matcher('PNT920218IW5', 'Quimibond') = ${r5.trim()}  (Quimibond's own RFC)`);

  console.log("\n=".repeat(70));
  console.log("Si todos los XEXX/XAXX retornan canonical real (no 11/630), el fix #1");
  console.log("está working. Si JORGE/JESÚS no matchean, eso es responsabilidad de #3.");
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
