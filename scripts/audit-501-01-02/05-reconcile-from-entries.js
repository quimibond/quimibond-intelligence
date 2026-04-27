// Pull all dec 2025 odoo_account_entries_stock and reconcile 501.01.02
const fs = require('fs');
const path = require('path');
const { fetchAll } = require('./lib.js');

(async () => {
  const base = `/rest/v1/odoo_account_entries_stock?select=odoo_move_id,date,name,journal_name,journal_type,move_type,stock_move_ids,lines_stock,ref&date=gte.2025-12-01&date=lt.2026-01-01&order=date.asc`;
  const rows = await fetchAll(base, { pageSize: 500 });
  fs.writeFileSync(path.join(__dirname, 'dec2025_entries.json'), JSON.stringify(rows));
  console.log('saved', rows.length, 'entries');

  let dr501_01_02 = 0, cr501_01_02 = 0, n501 = 0;
  const byAccount = {};
  for (const e of rows) {
    for (const l of (e.lines_stock || [])) {
      const code = l.account_code || '';
      byAccount[code] = byAccount[code] || { dr: 0, cr: 0, n: 0 };
      byAccount[code].dr += Number(l.debit) || 0;
      byAccount[code].cr += Number(l.credit) || 0;
      byAccount[code].n++;
      if (code === '501.01.02') {
        dr501_01_02 += Number(l.debit) || 0;
        cr501_01_02 += Number(l.credit) || 0;
        n501++;
      }
    }
  }
  const fmt = v => Math.round(v).toLocaleString('en-US');
  console.log('501.01.02 from odoo_account_entries_stock Dec 2025:');
  console.log('  Dr:', fmt(dr501_01_02), 'Cr:', fmt(cr501_01_02), 'NET:', fmt(dr501_01_02 - cr501_01_02), `(${n501} lines)`);
  console.log('vs canonical_account_balances NET: 10,544,206');
  console.log('GAP:', fmt(dr501_01_02 - cr501_01_02 - 10544206));
  console.log();
  console.log('All accounts in lines_stock (dec 2025):');
  for (const [k, v] of Object.entries(byAccount).sort((a,b) => Math.abs(b[1].dr - b[1].cr) - Math.abs(a[1].dr - a[1].cr))) {
    console.log(`  ${k.padEnd(10)} Dr=${fmt(v.dr).padStart(15)} Cr=${fmt(v.cr).padStart(15)} NET=${fmt(v.dr - v.cr).padStart(15)} (${v.n} lines)`);
  }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
