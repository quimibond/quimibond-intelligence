// Resilient Supabase REST helper with retry/backoff.
// Avoid Range header (broken in this proxy). Use limit/offset.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const HEADERS = {
  apikey: KEY,
  Authorization: 'Bearer ' + KEY,
  'Accept-Profile': 'public',
};

const BACKOFF = [1500, 3000, 4500, 6000, 7500];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(path) {
  const url = URL + path;
  let lastErr = null;
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 503 || res.status === 502 || res.status === 504) {
          throw new Error('HTTP ' + res.status + ': ' + text.slice(0, 120));
        }
        // 4xx: don't retry, surface immediately
        throw new Error('HTTP ' + res.status + ' (no retry): ' + text.slice(0, 240));
      }
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || e);
      const transient = /DNS cache overflow|fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|HTTP 5\d\d|EAI_AGAIN|getaddrinfo|Unexpected token/.test(msg);
      if (!transient || attempt >= BACKOFF.length) break;
      await sleep(BACKOFF[attempt]);
    }
  }
  throw lastErr;
}

// Page through a table with limit/offset until result count < limit.
async function fetchAll(pathBase, { pageSize = 1000, maxPages = 1000 } = {}) {
  const sep = pathBase.includes('?') ? '&' : '?';
  const out = [];
  for (let p = 0; p < maxPages; p++) {
    const offset = p * pageSize;
    const path = `${pathBase}${sep}limit=${pageSize}&offset=${offset}`;
    const rows = await fetchJson(path);
    if (!Array.isArray(rows)) {
      throw new Error('Non-array response: ' + JSON.stringify(rows).slice(0, 200));
    }
    out.push(...rows);
    process.stderr.write(`  page ${p + 1}: +${rows.length} (total ${out.length})\n`);
    if (rows.length < pageSize) break;
  }
  return out;
}

module.exports = { fetchJson, fetchAll, URL, KEY };
