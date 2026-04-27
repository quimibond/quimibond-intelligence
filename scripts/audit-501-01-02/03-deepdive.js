// Deep dive into the candidates that likely fed $10.54M into 501.01.02 (Dec 2025).
// Hypothesis: scrap routes ('SP/...') + LIMPIEZA MAQUINA CARDA cluster + physical count.
const fs = require('fs');
const path = require('path');

const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'dec2025_moves.json'), 'utf8'));
const num = v => Number(v) || 0;
const fmt = v => Math.round(v).toLocaleString('en-US');

// 1) LIMPIEZA MAQUINA CARDA cluster
const limpieza = rows.filter(r => r.product_ref === 'LIMPIEZA MAQUINA CARDA');
console.log('=== LIMPIEZA MAQUINA CARDA cluster');
console.log('count', limpieza.length, 'sum value', fmt(limpieza.reduce((a, r) => a + num(r.value), 0)));
const limpByDir = {};
for (const r of limpieza) {
  const k = `${r.location_usage} -> ${r.location_dest_usage}`;
  limpByDir[k] = limpByDir[k] || { count: 0, value: 0, has_acct: 0 };
  limpByDir[k].count++;
  limpByDir[k].value += num(r.value);
  if (r.has_account_move) limpByDir[k].has_acct++;
}
for (const [k, v] of Object.entries(limpByDir)) console.log(`  ${k}: count=${v.count} value=${fmt(v.value)} has_acct=${v.has_acct}`);

// References breakdown
const refMap = {};
for (const r of limpieza) {
  const ref = r.reference || '(null)';
  refMap[ref] = refMap[ref] || { count: 0, value: 0 };
  refMap[ref].count++;
  refMap[ref].value += num(r.value);
}
console.log('  ref breakdown:');
for (const [k, v] of Object.entries(refMap).sort((a, b) => b[1].value - a[1].value)) {
  console.log(`    ${k}: count=${v.count} value=${fmt(v.value)}`);
}

// 2) Scrap pickings: reference starting with 'SP/'
const scrap = rows.filter(r => r.reference && r.reference.startsWith('SP/'));
console.log('\n=== Scrap pickings (ref starts with SP/)');
console.log('count', scrap.length, 'sum value', fmt(scrap.reduce((a, r) => a + num(r.value), 0)));
const scrapByDir = {};
for (const r of scrap) {
  const k = `${r.location_usage} -> ${r.location_dest_usage}`;
  scrapByDir[k] = scrapByDir[k] || { count: 0, value: 0 };
  scrapByDir[k].count++;
  scrapByDir[k].value += num(r.value);
}
for (const [k, v] of Object.entries(scrapByDir)) console.log(`  ${k}: count=${v.count} value=${fmt(v.value)}`);
// top 10 scrap by value
console.log('  top 10 scrap moves:');
for (const r of scrap.sort((a, b) => num(b.value) - num(a.value)).slice(0, 10)) {
  console.log(`    ${r.reference} ${r.product_ref} qty=${r.quantity} val=${fmt(num(r.value))}`);
}

// 3) Physical count: ref = 'Physical Inventory' or starts with 'Cantidad de producto actualizada'
const phys = rows.filter(r => r.reference === 'Physical Inventory');
console.log('\n=== Physical Inventory moves');
console.log('count', phys.length, 'sum value', fmt(phys.reduce((a, r) => a + num(r.value), 0)));
const physByDir = {};
for (const r of phys) {
  const k = `${r.location_usage} -> ${r.location_dest_usage}`;
  physByDir[k] = physByDir[k] || { count: 0, value: 0 };
  physByDir[k].count++;
  physByDir[k].value += num(r.value);
}
for (const [k, v] of Object.entries(physByDir)) console.log(`  ${k}: count=${v.count} value=${fmt(v.value)}`);

const cynthia = rows.filter(r => r.reference && r.reference.startsWith('Cantidad de producto actualizada'));
console.log('\n=== "Cantidad de producto actualizada" (manual stock edits)');
console.log('count', cynthia.length, 'sum value', fmt(cynthia.reduce((a, r) => a + num(r.value), 0)));
const cynUsers = {};
for (const r of cynthia) {
  const m = (r.reference || '').match(/\(([^)]+)\)/);
  const u = m ? m[1] : '(unknown)';
  cynUsers[u] = cynUsers[u] || { count: 0, value: 0 };
  cynUsers[u].count++;
  cynUsers[u].value += num(r.value);
}
for (const [k, v] of Object.entries(cynUsers).sort((a, b) => b[1].value - a[1].value)) {
  console.log(`  ${k}: count=${v.count} value=${fmt(v.value)}`);
}

// 4) "Lote trasladado" / serial transfer
const lot = rows.filter(r => r.reference === 'Número de serie/lote trasladado');
console.log('\n=== "Número de serie/lote trasladado"');
console.log('count', lot.length, 'sum value', fmt(lot.reduce((a, r) => a + num(r.value), 0)));
const lotByDir = {};
for (const r of lot) {
  const k = `${r.location_usage} -> ${r.location_dest_usage}`;
  lotByDir[k] = lotByDir[k] || { count: 0, value: 0 };
  lotByDir[k].count++;
  lotByDir[k].value += num(r.value);
}
for (const [k, v] of Object.entries(lotByDir)) console.log(`  ${k}: count=${v.count} value=${fmt(v.value)}`);
const lotProds = {};
for (const r of lot) {
  const p = r.product_ref || '(null)';
  lotProds[p] = (lotProds[p] || 0) + num(r.value);
}
for (const [k, v] of Object.entries(lotProds).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  prod ${k}: ${fmt(v)}`);
}

// 5) Reference taxonomy across the whole month
console.log('\n=== Reference taxonomy (top 30 by total value, only rows w/ value>0 and in adjustment slice)');
const adjRows = rows.filter(r => num(r.value) > 0 && (r.location_usage === 'inventory' || r.location_dest_usage === 'inventory' || r.is_inventory));
const refTax = {};
for (const r of adjRows) {
  let key = r.reference || '(null)';
  // Generalize: replace the user-name parens
  key = key.replace(/\([^)]+\)/, '(...)');
  // Generalize SP/12345 -> SP/<n>
  key = key.replace(/SP\/\d+/, 'SP/<n>');
  refTax[key] = refTax[key] || { count: 0, value: 0 };
  refTax[key].count++;
  refTax[key].value += num(r.value);
}
for (const [k, v] of Object.entries(refTax).sort((a, b) => b[1].value - a[1].value).slice(0, 30)) {
  console.log(`  ${fmt(v.value).padStart(15)} | ${String(v.count).padStart(6)} | ${k}`);
}

// 6) Top 20 products by value in adjustment slice
console.log('\n=== Top products by value in adjustment slice');
const prodMap = {};
for (const r of adjRows) {
  const p = r.product_ref || '(null)';
  prodMap[p] = prodMap[p] || { count: 0, value: 0 };
  prodMap[p].count++;
  prodMap[p].value += num(r.value);
}
for (const [k, v] of Object.entries(prodMap).sort((a, b) => b[1].value - a[1].value).slice(0, 20)) {
  console.log(`  ${fmt(v.value).padStart(15)} | ${String(v.count).padStart(6)} | ${k}`);
}
