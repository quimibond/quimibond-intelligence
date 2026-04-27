// Compute the net signed flow that should hit 501.01.02 by category + cross-check
// against $10,544,205.73 (Dec 2025 net Dr-Cr in canonical_account_balances).
const fs = require('fs');
const path = require('path');

const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'dec2025_moves.json'), 'utf8'));
const num = v => Number(v) || 0;
const fmt = v => Math.round(v).toLocaleString('en-US');

// Sign convention: any move with location_dest_usage = 'inventory' and is_inventory=true
// (or location_usage='internal' moving to 'inventory' adj location) creates a LOSS = +Dr 501.01.02.
// inventory -> internal creates a GAIN = -Cr 501.01.02 (negative).
// inventory -> inventory: 1-sided journal where one side has has_account_move=true.
// Production moves with has_account_move=true land in 5xx (raw consumption) and 115 (FG receipt).

function signedAdj(r) {
  const v = num(r.value);
  if (!v) return 0;
  // Treat moves with has_account_move=true as the only ones that book to GL
  if (!r.has_account_move) return 0;
  if (r.location_usage !== 'inventory' && r.location_dest_usage !== 'inventory' && !r.is_inventory) return 0;
  // Loss direction: + (Dr 501.01.02)
  if (r.location_dest_usage === 'inventory') return +v;
  // Gain direction: - (Cr 501.01.02)
  if (r.location_usage === 'inventory') return -v;
  // is_inventory=true with no inv side (rare): treat as loss
  return +v;
}

// Net by reference taxonomy
function refKey(r) {
  let key = r.reference || '(null)';
  key = key.replace(/\([^)]+\)/, '(usuario)');
  key = key.replace(/SP\/\d+/, 'SP/<n>');
  key = key.replace(/UB\/\d+/, 'UB/<n>');
  key = key.replace(/TL\/[A-Z\-]+\/\d+/, 'TL/<picking>');
  key = key.replace(/INV-\w+\/\d+/, 'INV-<n>');
  return key;
}

const tax = {};
let total = 0;
for (const r of rows) {
  const v = signedAdj(r);
  if (v === 0) continue;
  const k = refKey(r);
  tax[k] = tax[k] || { count: 0, dr: 0, cr: 0, net: 0 };
  tax[k].count++;
  if (v > 0) tax[k].dr += v; else tax[k].cr += -v;
  tax[k].net += v;
  total += v;
}
console.log('Total signed flow attributable to 501.01.02 (gated by has_account_move=true): ', fmt(total));
console.log('Actual 501.01.02 net Dec 2025: 10,544,206');
console.log('\nBreakdown by reference taxonomy (ordered by net):');
console.log('     Dr             Cr            NET    count  ref');
for (const [k, v] of Object.entries(tax).sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net)).slice(0, 25)) {
  console.log(`${fmt(v.dr).padStart(12)}  ${fmt(v.cr).padStart(12)}  ${fmt(v.net).padStart(12)}  ${String(v.count).padStart(6)}  ${k}`);
}

// Same breakdown by product for the LOSS slice (Dr 501.01.02)
console.log('\nTop 20 products by NET Dr 501.01.02 contribution:');
const prod = {};
for (const r of rows) {
  const v = signedAdj(r);
  if (v === 0) continue;
  const p = r.product_ref || '(null)';
  prod[p] = prod[p] || { count: 0, net: 0 };
  prod[p].count++;
  prod[p].net += v;
}
for (const [k, v] of Object.entries(prod).sort((a, b) => b[1].net - a[1].net).slice(0, 20)) {
  console.log(`  ${fmt(v.net).padStart(12)}  ${String(v.count).padStart(6)}  ${k}`);
}

// Same by user (extracted from 'Cantidad de producto actualizada (X)' references)
console.log('\nManual stock edits by user:');
const userMap = {};
for (const r of rows) {
  if (!r.reference || !r.reference.startsWith('Cantidad de producto actualizada')) continue;
  const v = signedAdj(r);
  if (v === 0) continue;
  const m = r.reference.match(/\(([^)]+)\)/);
  const u = m ? m[1] : '(unknown)';
  userMap[u] = userMap[u] || { count: 0, net: 0 };
  userMap[u].count++;
  userMap[u].net += v;
}
for (const [k, v] of Object.entries(userMap).sort((a, b) => b[1].net - a[1].net)) {
  console.log(`  ${fmt(v.net).padStart(12)}  ${String(v.count).padStart(6)}  ${k}`);
}
