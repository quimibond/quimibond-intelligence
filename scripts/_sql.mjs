#!/usr/bin/env node
// Dev-only runner: hits Supabase PostgREST via HTTPS with retry on 503
// (egress proxy has flaky cache). Three modes:
//   node scripts/_sql.mjs ddl  '<sql>' '<description>'     -> execute_safe_ddl RPC
//   node scripts/_sql.mjs rpc  <name> '<json args>'        -> generic RPC
//   node scripts/_sql.mjs rest '<path>?<query>'            -> raw PostgREST GET
//
// Examples:
//   node scripts/_sql.mjs rest 'canonical_account_balances?select=period,balance&balance_sheet_bucket=eq.income&account_code=like.4*&limit=10'
//   node scripts/_sql.mjs rpc get_cogs_recursive_mp '{"p_date_from":"2026-04-01","p_date_to":"2026-05-01"}'

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing env"); process.exit(2); }

async function req(method, path, body) {
  const h = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  };
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(`${URL}${path}`, {
        method,
        headers: h,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      if (r.status === 503 && /DNS cache overflow|gateway|timeout/i.test(text)) {
        await new Promise((res) => setTimeout(res, 800 * attempt));
        continue;
      }
      return { status: r.status, body: text };
    } catch (e) {
      if (attempt === 5) throw e;
      await new Promise((res) => setTimeout(res, 800 * attempt));
    }
  }
  throw new Error("unreachable");
}

const [mode, ...rest] = process.argv.slice(2);
const run = async () => {
  if (mode === "ddl") {
    const [sql, desc = "ad-hoc"] = rest;
    const { status, body } = await req("POST", "/rest/v1/rpc/execute_safe_ddl", {
      p_sql: sql,
      p_description: desc,
    });
    console.log(status, body);
    return;
  }
  if (mode === "rpc") {
    const [name, argsJson = "{}"] = rest;
    const { status, body } = await req("POST", `/rest/v1/rpc/${name}`, JSON.parse(argsJson));
    console.log(status, body);
    return;
  }
  if (mode === "rest") {
    // PostgREST LIKE uses `*` as wildcard natively, no URL encoding needed.
    const pathAndQuery = rest.join(" ");
    const { status, body } = await req("GET", `/rest/v1/${pathAndQuery}`);
    console.log(status, body);
    return;
  }
  console.error("Modes: ddl | rpc | rest");
  process.exit(2);
};

run().catch((e) => { console.error("[err]", e.message || e); process.exit(1); });
