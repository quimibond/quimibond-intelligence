// Apply the silver_inventory_adjustments migration via execute_safe_ddl RPC.
// (psql is blocked from this sandbox; only REST API works.)
const fs = require('fs');
const path = require('path');
const SQL_PATH = path.join(__dirname, '..', '..', 'supabase', 'migrations',
                            '20260427_silver_inventory_adjustments.sql');

const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HEADERS = { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function rpc(name, body) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(u + '/rest/v1/rpc/' + name, {
        method: 'POST', headers: HEADERS, body: JSON.stringify(body)
      });
      const t = await r.text();
      if (r.status === 503 || r.status === 502) { await sleep(2000 * (i + 1)); continue; }
      return { status: r.status, body: t };
    } catch (e) {
      if (i < 5) await sleep(1500 * (i + 1));
      else throw e;
    }
  }
  throw new Error('max retries');
}

// Split a SQL file into top-level statements separated by ";\n" outside strings.
// Naive approach: split on lines starting with non-whitespace and the previous
// statement ending with ';'. We'll parse on `^(--|\s)` lines as continuations.
function splitStatements(sql) {
  const stmts = [];
  let buf = '';
  let inDollar = false;
  const lines = sql.split('\n');
  for (const line of lines) {
    const dollarCount = (line.match(/\$\$/g) || []).length;
    if (dollarCount % 2 === 1) inDollar = !inDollar;
    buf += line + '\n';
    if (!inDollar && /;\s*(--.*)?$/.test(line)) {
      // Strip leading comment-only lines so a leading "-- header" doesn't
      // disqualify the whole statement.
      const stripped = buf.replace(/^(\s*--[^\n]*\n|\s*\n)+/, '').trim();
      if (stripped) stmts.push(stripped);
      buf = '';
    }
  }
  const final = buf.replace(/^(\s*--[^\n]*\n|\s*\n)+/, '').trim();
  if (final) stmts.push(final);
  return stmts;
}

(async () => {
  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  const stmts = splitStatements(sql);
  console.log(`Found ${stmts.length} statements.`);
  let okCount = 0;
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    const head = s.split('\n')[0].slice(0, 80);
    if (s.startsWith('COMMENT')) {
      // execute_safe_ddl probably blocks COMMENT — try anyway
    }
    process.stdout.write(`[${i + 1}/${stmts.length}] ${head}... `);
    const out = await rpc('execute_safe_ddl', {
      p_sql: s,
      p_description: `silver_inventory_adjustments stmt ${i + 1}`,
    });
    if (out.status === 200) {
      let parsed;
      try { parsed = JSON.parse(out.body); } catch { parsed = null; }
      if (parsed && parsed.success === false) {
        console.log('FAIL:', parsed.error || out.body.slice(0, 200));
      } else {
        console.log('OK');
        okCount++;
      }
    } else {
      console.log('HTTP', out.status, out.body.slice(0, 200));
    }
  }
  console.log(`\n${okCount}/${stmts.length} statements applied.`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
