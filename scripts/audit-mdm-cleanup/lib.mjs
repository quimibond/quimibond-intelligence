// Audit MDM cleanup — shared helpers
// Mismo patrón que scripts/audit-501-01-02/lib.js: REST con retry/backoff,
// sin Range header (proxy roto). Usa limit/offset.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const HEADERS = {
  apikey: KEY,
  Authorization: "Bearer " + KEY,
  "Accept-Profile": "public",
  "Content-Type": "application/json",
};

const BACKOFF = [1500, 3000, 4500, 6000, 7500];

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function fetchJson(path) {
  const url = URL + path;
  let lastErr = null;
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      const text = await res.text();
      if (!res.ok) {
        if ([502, 503, 504].includes(res.status)) {
          throw new Error("HTTP " + res.status + ": " + text.slice(0, 120));
        }
        throw new Error("HTTP " + res.status + ": " + text.slice(0, 200));
      }
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt < BACKOFF.length) await sleep(BACKOFF[attempt]);
    }
  }
  throw lastErr;
}

export async function rpc(fn, args = {}) {
  const url = URL + "/rest/v1/rpc/" + fn;
  let lastErr = null;
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(args),
      });
      const text = await res.text();
      if (!res.ok) {
        if ([502, 503, 504].includes(res.status)) {
          throw new Error("HTTP " + res.status + ": " + text.slice(0, 120));
        }
        throw new Error("HTTP " + res.status + ": " + text.slice(0, 200));
      }
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt < BACKOFF.length) await sleep(BACKOFF[attempt]);
    }
  }
  throw lastErr;
}

export function fmtCount(n) {
  return n != null ? n.toLocaleString("en-US") : "?";
}

export function fmtMxn(n) {
  if (n == null) return "?";
  const v = typeof n === "string" ? Number(n) : n;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
