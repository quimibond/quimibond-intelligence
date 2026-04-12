# Deployment & Operational Checklist

## Environment Variables (Vercel)

### Required
```
NEXT_PUBLIC_SUPABASE_URL=https://tozqezmivpblmcubmnpi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>   # ← CRITICAL, see below
ANTHROPIC_API_KEY=sk-ant-...
AUTH_PASSWORD=<cookie_password>
CRON_SECRET=<bearer_token_for_cron_endpoints>
```

### Optional
```
GOOGLE_SERVICE_ACCOUNT_JSON=<gmail_service_account>
GMAIL_ACCOUNTS_JSON={"email@quimibond.com": "department", ...}
VOYAGE_API_KEY=<voyage_embedding_key>       # for semantic search
WHATSAPP_API_KEY=<whatsapp_business_api>    # for push notifications
CLAUDE_MODEL=claude-sonnet-4-6              # default model override
```

### ⚠️ CRITICAL: SUPABASE_SERVICE_ROLE_KEY

This is the **single most important env var**. If not set, routes fall back
to `NEXT_PUBLIC_SUPABASE_ANON_KEY` and RLS policies will **silently reject
INSERTs** without throwing errors.

**History:** We had a 7-day silent insert failure on agent_insights because
this was missing. See migration 039 for the defense-in-depth fix.

**Resolution order in `getServiceClient()`:**
1. `SUPABASE_SERVICE_KEY` (legacy)
2. `SUPABASE_SERVICE_ROLE_KEY` (official name, use this)
3. `SUPABASE_SECRET_KEY`
4. `NEXT_PUBLIC_SUPABASE_ANON_KEY` (LAST RESORT, logs warning)

---

## Backend patterns

### ALWAYS use `getServiceClient()` in API routes

```ts
// ✅ Good
import { getServiceClient } from "@/lib/supabase-server";
const supabase = getServiceClient();

// ❌ Bad (misses env var fallbacks, bypasses warnings)
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);
```

### ALWAYS validate inserts with `assertInsert()` on critical paths

```ts
import { assertInsert } from "@/lib/supabase-server";

// Throws if data: [] (silent RLS rejection)
const saved = await assertInsert(
  supabase.from("agent_insights").insert(rows).select("id"),
  "agent_insights",
  rows.length
);
```

---

## RLS policy requirements

Every new table with RLS enabled needs policies for all operations the
backend will perform. Use `FOR ALL` as a default:

```sql
CREATE POLICY "anon_write_my_table" ON public.my_table
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
```

To check if any table is missing write policies, run:
```sql
SELECT * FROM data_quality_scorecard WHERE metric LIKE '%missing%';
```

---

## Crons (vercel.json)

Current schedule (21 crons):

| Path | Schedule | Purpose |
|------|----------|---------|
| /api/pipeline/sync-emails | */30 | Gmail sync |
| /api/pipeline/analyze | */5 | Email KG extraction |
| /api/agents/auto-fix | */30 | Data auto-correct |
| /api/agents/orchestrate | */30 | Run 1 director |
| /api/agents/cleanup | */30 | Deduplicate |
| /api/agents/validate | */30 | Auto-expire + auto-resolve |
| /api/agents/learn | 45 */4 | Feedback → memories |
| /api/pipeline/health-scores | 0 */6 | Recalculate scores |
| /api/pipeline/parse-cfdi | */30 | CFDI XML parser |
| /api/pipeline/snapshot | 30 5 | Daily Odoo snapshot |
| /api/pipeline/employee-metrics | 0 5 * * 1 | Weekly |
| /api/agents/evolve | 0 6 | Schema evolution |
| /api/pipeline/briefing | 30 6 | CEO daily briefing |
| /api/pipeline/reconcile | 0 7 | Auto-close resolved |
| /api/pipeline/embeddings | 15 */4 | pgvector |
| /api/agents/identity-resolution | 10 */2 | Link identities |
| /api/system/health | 0 */3 | System heartbeat |
| /api/system/data-quality-check | 0 */6 | Alerts on data issues |
| /api/pipeline/enrich-companies | 20 */4 | Fill domain/rfc/entity |
| /api/pipeline/verify-follow-ups | 0 8 | ROI verification |
| /api/pipeline/refresh-views | 30 */6 | Refresh matviews |
| /api/pipeline/retention | 0 3 * * 0 | Weekly cleanup |

---

## Pre-deploy checklist

Before pushing to main:

- [ ] `npx tsc --noEmit` passes (or only pre-existing errors remain)
- [ ] New tables have RLS write policies
- [ ] New API routes use `getServiceClient()`
- [ ] New insert paths use `.select()` + error check
- [ ] New cron endpoints added to `vercel.json`
- [ ] Migrations saved to `supabase/migrations/` with version prefix
- [ ] `data_quality_alerts()` runs clean locally

## Post-deploy verification

- [ ] Check latest deployment on Vercel is READY
- [ ] Query `SELECT * FROM data_quality_alerts()` — should be empty or known issues
- [ ] Query `SELECT * FROM claude_cost_summary LIMIT 5` — costs look reasonable
- [ ] Check `/system` page shows green status on DataQualityPanel
- [ ] Check `/agents` EffectivenessPanel — no agent with 0 insights after deploy
- [ ] Check Vercel runtime logs for errors (last 15 min)

---

## Monitoring queries

### Quick health snapshot
```sql
SELECT * FROM data_quality_scorecard
ORDER BY 
  CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
  value - threshold DESC;
```

### Cost this week
```sql
SELECT endpoint, round(sum(cost_7d)::numeric, 2) as cost_7d_usd
FROM claude_cost_summary
WHERE cost_7d > 0
GROUP BY endpoint
ORDER BY cost_7d_usd DESC LIMIT 10;
```

### Agent ROI
```sql
SELECT name, acted_rate_pct, dismiss_rate_pct, impact_delivered_mxn
FROM agent_effectiveness
ORDER BY acted_rate_pct DESC NULLS LAST;
```

### Follow-up proof
```sql
SELECT * FROM follow_up_roi ORDER BY total DESC;
```

---

## Common incidents & responses

### "Insights not appearing in frontend"
1. Check `agent_runs` — are they completing? Any `error_message`?
2. Check `data_quality_alerts()` — any critical FK issues?
3. Check Vercel logs for `insert error` or `[orchestrate]` messages
4. Check if RLS INSERT policies exist on `agent_insights`
5. Verify `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel env

### "API costs spiking"
1. Open `/system` → CostPanel → see which endpoint
2. Query `claude_cost_summary` for top 5 last 24h
3. Check if prompt caching is active (logs should show `cache: X read`)
4. Look for runaway loops in pipeline_logs

### "Director generating too many insights"
1. Check `agent_effectiveness` for that agent's dismiss_rate
2. If dismiss > 60%, `getAgentConfidenceThreshold` auto-raises to 0.92
3. Manually tighten in ai_agents.config.confidence_threshold if needed
4. Review its system_prompt for overly aggressive criteria

### "Orphan records in odoo_* tables"
Run `enrich_companies()` RPC — creates stub companies from partner_ids.
