// Multi-period audit of 501.01.02. Decomposes each month's net by
// physical_subcategory + journal_category and identifies notable
// "unlinked" manual journal entries (asientos tapón del contador).
const fs = require('fs');
const path = require('path');

const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HEADERS = { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function rpc(name, body) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(u + '/rest/v1/rpc/' + name, {
        method: 'POST', headers: HEADERS, body: JSON.stringify(body),
      });
      const t = await r.text();
      if (r.status === 503 || r.status === 502) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 200));
      return JSON.parse(t);
    } catch (e) {
      if (i < 5) await sleep(1500 * (i + 1));
      else throw e;
    }
  }
}
async function get(path) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(u + path, { headers: HEADERS });
      const t = await r.text();
      if (r.status === 503 || r.status === 502) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 200));
      return JSON.parse(t);
    } catch (e) {
      if (i < 5) await sleep(1500 * (i + 1));
      else throw e;
    }
  }
}

const fmt = v => {
  const n = Math.round(Number(v) || 0);
  return n.toLocaleString('en-US');
};

const fmtSign = v => {
  const n = Math.round(Number(v) || 0);
  return (n >= 0 ? '+' : '') + n.toLocaleString('en-US');
};

(async () => {
  const FROM = '2024-01-01';
  const TO = '2026-12-31';
  const ACCOUNT = '501.01.02';

  console.log('Loading multi-period data for', ACCOUNT, FROM, '→', TO);

  // 1) Monthly net by account_bucket × journal_category
  const monthlyContable = await rpc('get_inventory_adjustments_monthly', {
    p_date_from: FROM,
    p_date_to: TO,
    p_account_codes: [ACCOUNT],
  });

  // 2) Monthly net by physical_subcategory (joined to stock_moves)
  const monthlyPhysical = await rpc('get_inventory_adjustments_physical_monthly', {
    p_date_from: FROM,
    p_date_to: TO,
    p_account_codes: [ACCOUNT],
  });

  // 3) Pull "unlinked" raw entries directly from odoo_account_entries_stock
  //    (entries with stock_move_ids empty AND a 501.01.02 line) so we can
  //    name the manual journals by ref + amount.
  const entries = await get(
    `/rest/v1/odoo_account_entries_stock?select=odoo_move_id,date,name,journal_name,move_type,ref,stock_move_ids,lines_stock&date=gte.${FROM}&date=lt.${TO}&order=date.asc`
  );

  // Aggregate monthly net per period
  const periodNet = new Map();
  for (const r of monthlyContable) {
    periodNet.set(r.period, (periodNet.get(r.period) || 0) + Number(r.net || 0));
  }

  // Aggregate monthly net per period × physical_subcategory
  const physBy = new Map();   // period → Map(subcat, net)
  for (const r of monthlyPhysical) {
    if (!physBy.has(r.period)) physBy.set(r.period, new Map());
    const m = physBy.get(r.period);
    m.set(r.physical_subcategory, (m.get(r.physical_subcategory) || 0) + Number(r.net || 0));
  }

  // Find unlinked manual entries hitting 501.01.02 (per the audit pattern)
  const unlinkedEntries = [];
  for (const e of entries) {
    const linkedCount = (e.stock_move_ids || []).length;
    const cogsLines = (e.lines_stock || []).filter(l => l.account_code === ACCOUNT);
    if (cogsLines.length === 0) continue;
    let dr = 0, cr = 0;
    for (const l of cogsLines) { dr += Number(l.debit || 0); cr += Number(l.credit || 0); }
    const net = dr - cr;
    if (linkedCount === 0 && Math.abs(net) >= 100_000) {
      unlinkedEntries.push({
        date: e.date,
        period: e.date.slice(0, 7),
        odoo_move_id: e.odoo_move_id,
        name: e.name,
        ref: (e.ref || '').slice(0, 100),
        journal_name: e.journal_name,
        net,
        cogs_lines: cogsLines.length,
      });
    }
  }
  unlinkedEntries.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  // ── REPORT ──────────────────────────────────────────────────────────

  console.log('\n═══ MONTHLY 501.01.02 NET (canonical balance) ═══\n');
  const periods = [...periodNet.keys()].sort();
  console.log('period       net          flag');
  for (const p of periods) {
    const v = periodNet.get(p);
    const flag = Math.abs(v) > 5_000_000 ? '🔴 atypical'
              : Math.abs(v) > 1_000_000 ? '🟡 high'
              : Math.abs(v) > 500_000 ? '· notable'
              : '';
    console.log(`${p}  ${fmtSign(v).padStart(13)}  ${flag}`);
  }

  console.log('\n═══ NOTABLE MONTHS (|net| > $500k) — physical decomposition ═══\n');
  for (const p of periods) {
    const v = periodNet.get(p);
    if (Math.abs(v) <= 500_000) continue;
    console.log(`── ${p} (net ${fmtSign(v)}) ──`);
    const subcats = [...(physBy.get(p)?.entries() || [])].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    for (const [sub, n] of subcats) {
      const pct = v !== 0 ? (n / v * 100) : 0;
      console.log(`  ${fmtSign(n).padStart(13)}  ${pct.toFixed(0).padStart(4)}%  ${sub}`);
    }
    // Unlinked entries for this period
    const u = unlinkedEntries.filter(x => x.period === p);
    if (u.length > 0) {
      console.log(`  └── unlinked manual journals:`);
      for (const x of u) {
        console.log(`       ${x.date} ${x.name}: ${fmtSign(x.net)} — ref="${x.ref}"`);
      }
    }
    console.log('');
  }

  console.log('\n═══ ALL UNLINKED MANUAL JOURNALS ($100k+) ═══\n');
  console.log('Asientos sin stock_move_ids (probable tapón del contador o asiento de ajuste):\n');
  let unlinkedTotal = 0;
  for (const x of unlinkedEntries) {
    console.log(`${x.date}  ${x.name.padEnd(22)} ${fmtSign(x.net).padStart(13)}  ${x.ref}`);
    unlinkedTotal += x.net;
  }
  console.log('─'.repeat(60));
  console.log(`${unlinkedEntries.length} entries totalizing ${fmtSign(unlinkedTotal)}`);

  // Save data
  fs.writeFileSync(
    path.join(__dirname, 'all_periods_data.json'),
    JSON.stringify({ monthlyContable, monthlyPhysical, unlinkedEntries }, null, 2)
  );
  console.log('\nData saved to all_periods_data.json');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
