#!/usr/bin/env bash
#
# Drives the historical Gmail backfill across all configured accounts.
#
# Strategy:
#   - Top-10 critical accounts (sales, ops, finance, exec) → 12 months
#   - Everything else → 3 months
#
# Each account is paginated automatically until done. Safe to re-run:
# emails are deduped on gmail_message_id at the DB layer.
#
# Requires:
#   BASE_URL     – e.g. https://quimibond-intelligence.vercel.app
#   CRON_SECRET  – matches the deployed env var
#   jq           – for JSON parsing
#
# Usage:
#   BASE_URL=https://... CRON_SECRET=xxx ./scripts/backfill-gmail.sh
#   BASE_URL=https://... CRON_SECRET=xxx ./scripts/backfill-gmail.sh info@quimibond.com  # one account
#
set -euo pipefail

: "${BASE_URL:?set BASE_URL to your Vercel deployment}"
: "${CRON_SECRET:?set CRON_SECRET to match the deployed env var}"

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

# Top 10 critical accounts → 12 months
CRITICAL_ACCOUNTS=(
  info@quimibond.com
  jose.mizrahi@quimibond.com
  jacobo.mizrahi@quimibond.com
  direcciondeoperaciones@quimibond.com
  cxcobrar@quimibond.com
  cxp@quimibond.com
  comprasplanta@quimibond.com
  ventas@quimibond.com
  ventasindustrial@quimibond.com
  irma.luna@quimibond.com
)

# Everything else → 3 months
SECONDARY_ACCOUNTS=(
  rhmexico@quimibond.com
  mas@quimibond.com
  sistemas@quimibond.com
  almacen.toluca@quimibond.com
  gilberto@quimibond.com
  aurelio@quimibond.com
  recursoshumanos@quimibond.com
  auditormp@quimibond.com
  innovacion@quimibond.com
  logistica@quimibond.com
  mantenimiento@quimibond.com
  magaly@quimibond.com
  manufactura@quimibond.com
  eduardo@quimibond.com
  ingenieriacc@quimibond.com
  jefe.calidad@quimibond.com
  juan@quimibond.com
  muestras@quimibond.com
  rocio@quimibond.com
  auxsgi@quimibond.com
  inspeccion@quimibond.com
  producto.innovacion@quimibond.com
  aux.almacentol@quimibond.com
  planeacion@quimibond.com
  proceso.innovacion@quimibond.com
  tac@quimibond.com
  admon.ventas@quimibond.com
  operadortratadora@quimibond.com
  javier@quimibond.com
  auditorcalidad@quimibond.com
  berenice.vazquez@quimibond.com
  supervisor@quimibond.com
  entretelas@quimibond.com
  tintoreria@quimibond.com
  tejido@quimibond.com
  auxcostos@quimibond.com
  auxlaboratorio@quimibond.com
  control.almacen@quimibond.com
  abraham@quimibond.com
  laboratorio@quimibond.com
)

# Compute since dates dynamically (12 months / 3 months ago)
SINCE_12M=$(date -u -v-12m +%Y-%m-%d 2>/dev/null || date -u -d '12 months ago' +%Y-%m-%d)
SINCE_3M=$(date -u -v-3m +%Y-%m-%d 2>/dev/null || date -u -d '3 months ago' +%Y-%m-%d)

backfill_account() {
  local account="$1"
  local since="$2"
  local token=""
  local total_emails=0
  local total_threads=0
  local pages=0

  printf "▶ %-45s (since %s)\n" "$account" "$since"

  while :; do
    pages=$((pages + 1))
    local url="${BASE_URL}/api/pipeline/backfill-emails?account=${account}&since=${since}"
    [[ -n "$token" ]] && url="${url}&pageToken=${token}"

    local resp
    resp=$(curl -sS -X POST "$url" -H "Authorization: Bearer ${CRON_SECRET}") || {
      echo "  ✖ curl failed on page $pages" >&2
      return 1
    }

    if echo "$resp" | jq -e '.error' >/dev/null 2>&1; then
      echo "  ✖ $(echo "$resp" | jq -r '.error // .detail')" >&2
      return 1
    fi

    local saved threads done next
    saved=$(echo "$resp" | jq -r '.emails_saved // 0')
    threads=$(echo "$resp" | jq -r '.threads_saved // 0')
    done=$(echo "$resp" | jq -r '.done // false')
    next=$(echo "$resp" | jq -r '.nextPageToken // ""')

    total_emails=$((total_emails + saved))
    total_threads=$((total_threads + threads))

    printf "  page %2d: +%4d emails, +%4d threads%s\n" "$pages" "$saved" "$threads" \
      "$([[ "$done" == "true" ]] && echo " ✓" || echo "")"

    [[ "$done" == "true" ]] && break
    token="$next"
    [[ -z "$token" ]] && break
    sleep 1   # be gentle with Gmail rate limits
  done

  printf "  total: %d emails / %d threads in %d pages\n\n" "$total_emails" "$total_threads" "$pages"
}

# Single-account mode
if [[ $# -gt 0 ]]; then
  for acct in "$@"; do
    # Default to 12m for ad-hoc runs
    backfill_account "$acct" "$SINCE_12M"
  done
  exit 0
fi

echo "═══ Critical accounts (12 months from $SINCE_12M) ═══"
for acct in "${CRITICAL_ACCOUNTS[@]}"; do
  backfill_account "$acct" "$SINCE_12M" || echo "  (continuing)"
done

echo "═══ Secondary accounts (3 months from $SINCE_3M) ═══"
for acct in "${SECONDARY_ACCOUNTS[@]}"; do
  backfill_account "$acct" "$SINCE_3M" || echo "  (continuing)"
done

echo "✓ Backfill complete"
