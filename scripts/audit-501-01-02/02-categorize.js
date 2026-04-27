// Categorize Dec 2025 done stock moves by direction (location_usage -> location_dest_usage)
// and reveal which slice carries the $10.54M residual hitting 501.01.02.
const fs = require('fs');
const path = require('path');

const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'dec2025_moves.json'), 'utf8'));

const num = v => Number(v) || 0;
const fmt = v => Math.round(v).toLocaleString('en-US');

console.log('=== Dec 2025 done moves: total', rows.length);
console.log('Sum value (raw):', fmt(rows.reduce((a, r) => a + num(r.value), 0)));

// 1) Group by direction (origin->dest usage)
const byDir = {};
for (const r of rows) {
  const k = `${r.location_usage} -> ${r.location_dest_usage}`;
  byDir[k] = byDir[k] || { count: 0, value: 0, has_acct: 0, value_acct: 0, value_no_acct: 0 };
  byDir[k].count++;
  byDir[k].value += num(r.value);
  if (r.has_account_move) {
    byDir[k].has_acct++;
    byDir[k].value_acct += num(r.value);
  } else {
    byDir[k].value_no_acct += num(r.value);
  }
}
console.log('\n=== By direction (origin->dest usage)');
console.log('count\tvalue (sum, may have signs)\thas_acct\tvalue (has_acct)\tvalue (no_acct)\tdir');
const dirs = Object.entries(byDir).sort((a, b) => Math.abs(b[1].value) - Math.abs(a[1].value));
for (const [k, v] of dirs) {
  console.log(`${v.count}\t${fmt(v.value)}\t${v.has_acct}\t${fmt(v.value_acct)}\t${fmt(v.value_no_acct)}\t${k}`);
}

// 2) Analyze the sign of value
const pos = rows.filter(r => num(r.value) > 0);
const neg = rows.filter(r => num(r.value) < 0);
const zero = rows.filter(r => num(r.value) === 0);
console.log('\n=== Sign of value');
console.log('positive: count', pos.length, 'sum', fmt(pos.reduce((a, r) => a + num(r.value), 0)));
console.log('negative: count', neg.length, 'sum', fmt(neg.reduce((a, r) => a + num(r.value), 0)));
console.log('zero    : count', zero.length);

// 3) is_inventory specifically
const inv = rows.filter(r => r.is_inventory);
const invByDir = {};
for (const r of inv) {
  const k = `${r.location_usage} -> ${r.location_dest_usage}`;
  invByDir[k] = invByDir[k] || { count: 0, value: 0, value_pos: 0, value_neg: 0 };
  invByDir[k].count++;
  invByDir[k].value += num(r.value);
  if (num(r.value) > 0) invByDir[k].value_pos += num(r.value);
  if (num(r.value) < 0) invByDir[k].value_neg += num(r.value);
}
console.log('\n=== is_inventory=true breakdown by direction');
console.log('count\ttotal value\tpos value\tneg value\tdir');
for (const [k, v] of Object.entries(invByDir).sort((a, b) => Math.abs(b[1].value) - Math.abs(a[1].value))) {
  console.log(`${v.count}\t${fmt(v.value)}\t${fmt(v.value_pos)}\t${fmt(v.value_neg)}\t${k}`);
}

// 4) Filter "candidate moves that hit 501.01.02"
// Hypothesis A: only moves involving location_usage='inventory' (adjustments)
// Hypothesis B: ALL moves involving 'inventory' OR 'production' OR is_inventory=true
const isAdj = r => r.location_usage === 'inventory' || r.location_dest_usage === 'inventory' || r.is_inventory;
const adj = rows.filter(isAdj);
const adjAcct = adj.filter(r => r.has_account_move);
console.log('\n=== Inventory adjustment candidates (any side = inventory or is_inventory=true)');
console.log('count', adj.length, 'sum value', fmt(adj.reduce((a, r) => a + num(r.value), 0)));
console.log('with has_account_move=true:', adjAcct.length, 'sum value', fmt(adjAcct.reduce((a, r) => a + num(r.value), 0)));

// Net signed flow: loss (internal->inventory) Dr 501.01.02 ; gain (inventory->internal) Cr 501.01.02
let lossDr = 0, gainCr = 0, lossCount = 0, gainCount = 0;
for (const r of adj) {
  const v = Math.abs(num(r.value));
  if (r.location_dest_usage === 'inventory') { lossDr += v; lossCount++; }
  else if (r.location_usage === 'inventory') { gainCr += v; gainCount++; }
}
console.log('Loss (internal->inventory) Dr 501.01.02: count', lossCount, 'abs value', fmt(lossDr));
console.log('Gain (inventory->internal) Cr 501.01.02: count', gainCount, 'abs value', fmt(gainCr));
console.log('Net Dr - Cr (theoretical 501.01.02 hit):', fmt(lossDr - gainCr));

// 5) Print 5 samples each direction, including acct ids
console.log('\n=== Samples: internal -> inventory (LOSS, biggest abs value)');
const lossSamples = rows.filter(r => r.location_dest_usage === 'inventory').sort((a, b) => Math.abs(num(b.value)) - Math.abs(num(a.value))).slice(0, 10);
for (const r of lossSamples) {
  console.log(JSON.stringify({ id: r.odoo_move_id, p: r.product_ref, qty: r.quantity, val: r.value, ref: r.reference, dir: r.location_usage + '->' + r.location_dest_usage, has_a: r.has_account_move, picking: r.picking_name, is_inv: r.is_inventory }));
}
console.log('\n=== Samples: inventory -> internal (GAIN, biggest abs value)');
const gainSamples = rows.filter(r => r.location_usage === 'inventory').sort((a, b) => Math.abs(num(b.value)) - Math.abs(num(a.value))).slice(0, 10);
for (const r of gainSamples) {
  console.log(JSON.stringify({ id: r.odoo_move_id, p: r.product_ref, qty: r.quantity, val: r.value, ref: r.reference, dir: r.location_usage + '->' + r.location_dest_usage, has_a: r.has_account_move, picking: r.picking_name, is_inv: r.is_inventory }));
}
