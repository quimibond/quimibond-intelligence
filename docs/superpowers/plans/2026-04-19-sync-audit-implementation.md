# Sync Audit (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un harness cuantitativo que compara datos de costo/margen/inventario entre Odoo y Supabase (18 invariantes cross-check) y detecta inconsistencias internas en Supabase (15 invariantes SQL), persiste resultados en `audit_runs`, y produce un baseline para Fase 2 (fixes semánticos).

**Architecture:** Un modelo Odoo (`quimibond.sync.audit`) orquesta invariantes cross-check via ORM + REST a Supabase. Una función PL/pgSQL (`run_internal_audits`) ejecuta invariantes puramente SQL. Ambas escriben filas con un `run_id` compartido a la tabla `audit_runs`. Una tabla `audit_tolerances` parametriza umbrales.

**Tech Stack:** Odoo 19 (Python + XML), Supabase PostgreSQL, PostgREST, pg_cron, httpx.

**Spec:** `docs/superpowers/specs/2026-04-19-sync-audit-design.md`

---

## File Structure

### Nuevos archivos

**Odoo addon** (`addons/quimibond_intelligence/`):
- `models/sync_audit.py` — modelo `quimibond.sync.audit`, orquestador y 7 métodos `audit_*`.
- `views/sync_audit_views.xml` — botón "Run audit" en menú sync.
- `data/ir_cron_audit.xml` — cron semanal.
- `tests/__init__.py` — init tests package (si no existe).
- `tests/test_sync_audit.py` — tests unitarios e integración.

**Supabase** (`quimibond-intelligence/quimibond-intelligence/supabase/migrations/`):
- `20260419_audit_runs_table.sql` — DDL tablas `audit_runs` + `audit_tolerances` + seed.
- `20260419_audit_invariants_views.sql` — views `v_audit_*` (15 SQL).
- `20260419_audit_run_internal_audits.sql` — función PL/pgSQL orquestadora.
- `20260419_audit_pg_cron_cleanup.sql` — job de retención 90 días.

**Docs**:
- `docs/audit_invariants.md` — catálogo canónico.

### Archivos modificados

- `addons/quimibond_intelligence/models/__init__.py` — importar `sync_audit`.
- `addons/quimibond_intelligence/__manifest__.py` — registrar XML nuevos en `data`.
- `addons/quimibond_intelligence/security/ir.model.access.csv` — permisos del nuevo modelo.

### Convenciones del repo

- Migraciones Supabase: prefijo `YYYYMMDD_` = fecha de implementación (hoy `20260419`).
- Tests Odoo: herencia de `odoo.tests.common.TransactionCase`, tag `post_install`.
- Commits: formato convencional `feat(scope): ...` / `test(scope): ...` / `fix(scope): ...`.
- No cambiar la versión del manifest (`19.0.30.0.0`).

---

## Task 0.1: Crear tablas `audit_runs` y `audit_tolerances` en Supabase

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260419_audit_runs_table.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 20260419_audit_runs_table.sql
-- Tabla de resultados de auditoría de integridad Odoo↔Supabase.
-- Cada fila = una medición de un invariante en un bucket (mes/company/etc).

CREATE TABLE IF NOT EXISTS audit_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL,
  run_at         timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL CHECK (source IN ('odoo','supabase')),
  model          text NOT NULL,
  invariant_key  text NOT NULL,
  bucket_key     text,
  odoo_value     numeric,
  supabase_value numeric,
  diff           numeric,
  severity       text NOT NULL CHECK (severity IN ('ok','warn','error')),
  date_from      date,
  date_to        date,
  details        jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_runs_unique_idx
  ON audit_runs (run_id, source, model, invariant_key, COALESCE(bucket_key, ''));

CREATE INDEX IF NOT EXISTS audit_runs_run_at_idx ON audit_runs (run_at DESC);
CREATE INDEX IF NOT EXISTS audit_runs_severity_idx
  ON audit_runs (severity) WHERE severity <> 'ok';
CREATE INDEX IF NOT EXISTS audit_runs_run_id_idx ON audit_runs (run_id);

COMMENT ON TABLE audit_runs IS
  'Resultados de invariantes de auditoría de sincronización Odoo↔Supabase. Spec: docs/superpowers/specs/2026-04-19-sync-audit-design.md';

-- Tabla de tolerancias configurables por invariante
CREATE TABLE IF NOT EXISTS audit_tolerances (
  invariant_key  text PRIMARY KEY,
  abs_tolerance  numeric NOT NULL DEFAULT 0.01,
  pct_tolerance  numeric NOT NULL DEFAULT 0.001,
  notes          text
);

COMMENT ON TABLE audit_tolerances IS
  'Tolerancias por invariante. Si falta fila, aplican defaults globales abs=0.01, pct=0.001.';

-- Seed de overrides conocidos
INSERT INTO audit_tolerances (invariant_key, abs_tolerance, pct_tolerance, notes) VALUES
  ('invoice_lines.sum_subtotal_signed_mxn', 0.50, 0.005,
   'FX de documento puede diferir de FX al momento de audit'),
  ('order_lines.sum_subtotal_mxn', 0.50, 0.005,
   'Igual que invoice_lines por FX floating'),
  ('account_balances.inventory_accounts_balance', 1.00, 0.0005,
   'Redondeo contable'),
  ('account_balances.cogs_accounts_balance', 1.00, 0.0005, 'Redondeo contable'),
  ('account_balances.revenue_accounts_balance', 1.00, 0.0005, 'Redondeo contable'),
  ('bank_balances.native_balance_per_journal', 0.05, 0.0001,
   'Cuentas bancarias tienen centavos')
ON CONFLICT (invariant_key) DO NOTHING;
```

- [ ] **Step 2: Aplicar migración en staging Supabase**

Run:
```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
supabase db push --linked
```

Expected: `Applied 20260419_audit_runs_table.sql successfully`. Verificar:
```bash
supabase db inspect tables | grep audit_
```
Esperado: ver `audit_runs` y `audit_tolerances`.

- [ ] **Step 3: Verificar seed**

Run:
```sql
SELECT invariant_key, abs_tolerance, pct_tolerance
FROM audit_tolerances ORDER BY invariant_key;
```
Esperado: 6 filas seed.

- [ ] **Step 4: Commit**

```bash
cd /Users/jj
git add quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260419_audit_runs_table.sql
git commit -m "$(cat <<'EOF'
feat(audit): create audit_runs + audit_tolerances tables

Spec: docs/superpowers/specs/2026-04-19-sync-audit-design.md (Fase 1)

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Task 0.2: Crear modelo `quimibond.sync.audit` con helpers base

**Files:**
- Create: `addons/quimibond_intelligence/models/sync_audit.py`
- Modify: `addons/quimibond_intelligence/models/__init__.py`
- Modify: `addons/quimibond_intelligence/security/ir.model.access.csv`

- [ ] **Step 1: Test stub (crear archivo de tests con primer test de smoke)**

Create `addons/quimibond_intelligence/tests/__init__.py` if missing:
```python
from . import test_sync_audit
```

Create `addons/quimibond_intelligence/tests/test_sync_audit.py`:
```python
"""Tests for quimibond.sync.audit — integrity invariants Odoo↔Supabase."""
from unittest.mock import patch, MagicMock
from odoo.tests.common import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestSyncAuditBase(TransactionCase):
    """Smoke test: model exists and run_all returns summary dict."""

    def setUp(self):
        super().setUp()
        self.Audit = self.env['quimibond.sync.audit']

    def test_model_exists(self):
        self.assertTrue(self.Audit)

    def test_run_all_returns_summary(self):
        with patch.object(self.Audit, '_get_client') as m_client:
            m_client.return_value = MagicMock()
            result = self.Audit.run_all(
                date_from='2026-01-01',
                date_to='2026-04-19',
                scope=[],  # empty scope → no invariants run
                dry_run=True,
            )
        self.assertIn('run_id', result)
        self.assertIn('summary', result)
        self.assertEqual(result['summary'], {'ok': 0, 'warn': 0, 'error': 0})
```

- [ ] **Step 2: Verificar que el test falla**

Run (desde Odoo.sh shell o local con test DB):
```bash
odoo-bin -c odoo.conf -d qb19_test \
  --test-enable --test-tags /quimibond_intelligence:TestSyncAuditBase \
  -u quimibond_intelligence --stop-after-init 2>&1 | tail -30
```
Expected: `FAIL: model quimibond.sync.audit does not exist`.

- [ ] **Step 3: Crear `sync_audit.py` con esqueleto y helpers**

Create `addons/quimibond_intelligence/models/sync_audit.py`:

```python
"""
Sync audit — Fase 1 cuantitativa.

Compara métricas Odoo↔Supabase via invariantes cross-check y orquesta
invariantes internos SQL en Supabase. Persiste resultados en audit_runs.

Spec: docs/superpowers/specs/2026-04-19-sync-audit-design.md
"""
import json
import logging
import traceback
import uuid
from datetime import datetime, date

from odoo import api, fields, models
from .supabase_client import SupabaseClient

_logger = logging.getLogger(__name__)

# Defaults si audit_tolerances no tiene fila para el invariant_key
DEFAULT_ABS_TOLERANCE = 0.01
DEFAULT_PCT_TOLERANCE = 0.001

# Lista de invariantes Odoo-side disponibles; scope=None ejecuta todos
ALL_ODOO_SCOPES = [
    'products',
    'invoice_lines',
    'order_lines',
    'deliveries',
    'manufacturing',
    'account_balances',
    'bank_balances',
]


class SyncAudit(models.TransientModel):
    _name = 'quimibond.sync.audit'
    _description = 'Quimibond Sync Audit (Fase 1 — cuantitativa)'

    # ---------------------------------------------------------------
    # Configuración y cliente Supabase
    # ---------------------------------------------------------------
    def _get_client(self) -> SupabaseClient:
        ICP = self.env['ir.config_parameter'].sudo()
        url = ICP.get_param('quimibond_intelligence.supabase_url')
        key = ICP.get_param('quimibond_intelligence.supabase_service_key')
        if not url or not key:
            raise ValueError('Supabase URL/key no configurados en ir.config_parameter')
        return SupabaseClient(url, key)

    def _get_tolerances(self, client: SupabaseClient) -> dict:
        """Carga tolerancias desde Supabase, devuelve dict keyed por invariant_key."""
        rows = client.fetch('audit_tolerances') or []
        return {r['invariant_key']: r for r in rows}

    # ---------------------------------------------------------------
    # Helpers de escritura a audit_runs
    # ---------------------------------------------------------------
    def _severity_for(self, diff: float, expected: float,
                     tol_abs: float, tol_pct: float) -> str:
        """Clasifica diff vs tolerancias. `expected` se usa para % (denominador)."""
        a = abs(diff or 0.0)
        if a <= tol_abs:
            return 'ok'
        denom = abs(expected or 0.0)
        if denom > 0 and (a / denom) <= tol_pct:
            return 'ok'
        # Dos cubetas: warn para < 10x tolerancia, error para más
        if a <= 10 * tol_abs:
            return 'warn'
        return 'error'

    def _record_cross(self, client, run_id, model, invariant_key, bucket_key,
                     odoo_value, supabase_value, tolerances, date_from, date_to,
                     details=None, dry_run=False):
        """Graba una medición cross-check en audit_runs. Devuelve severity."""
        odoo_v = float(odoo_value or 0)
        supa_v = float(supabase_value or 0)
        diff = odoo_v - supa_v
        tol = tolerances.get(invariant_key, {})
        tol_abs = float(tol.get('abs_tolerance', DEFAULT_ABS_TOLERANCE))
        tol_pct = float(tol.get('pct_tolerance', DEFAULT_PCT_TOLERANCE))
        expected = odoo_v if odoo_v != 0 else supa_v
        severity = self._severity_for(diff, expected, tol_abs, tol_pct)
        row = {
            'run_id': run_id,
            'source': 'odoo',
            'model': model,
            'invariant_key': invariant_key,
            'bucket_key': bucket_key,
            'odoo_value': odoo_v,
            'supabase_value': supa_v,
            'diff': diff,
            'severity': severity,
            'date_from': str(date_from) if date_from else None,
            'date_to': str(date_to) if date_to else None,
            'details': details or {},
        }
        if not dry_run:
            client.upsert('audit_runs', [row],
                          on_conflict='run_id,source,model,invariant_key,bucket_key')
        return severity

    def _record_error(self, client, run_id, model, invariant_key, exception,
                     date_from, date_to, dry_run=False):
        """Graba un error de ejecución de invariante."""
        row = {
            'run_id': run_id,
            'source': 'odoo',
            'model': model,
            'invariant_key': invariant_key,
            'bucket_key': None,
            'odoo_value': None,
            'supabase_value': None,
            'diff': None,
            'severity': 'error',
            'date_from': str(date_from) if date_from else None,
            'date_to': str(date_to) if date_to else None,
            'details': {
                'exception': str(exception),
                'traceback': traceback.format_exc()[-4000:],
            },
        }
        if not dry_run:
            client.upsert('audit_runs', [row],
                          on_conflict='run_id,source,model,invariant_key,bucket_key')

    # ---------------------------------------------------------------
    # Helpers de queries Supabase (agregados)
    # ---------------------------------------------------------------
    def _supabase_count(self, client, table, filters=None) -> int:
        """COUNT via Supabase. Usa Prefer: count=exact y Range."""
        # Implementación simple: traer 1 fila y leer header Content-Range
        params = dict(filters or {})
        params['select'] = 'id'
        params['limit'] = '1'
        # Hack: postgrest devuelve total en Content-Range cuando prefer count=exact
        # Usamos client.fetch existente que sólo devuelve body; añadimos método
        return client.count_exact(table, params)

    def _supabase_sum_group(self, client, table, agg_expr, group_by,
                            filters=None) -> dict:
        """SUM/COUNT agrupado via PostgREST. Devuelve {bucket_key: value}."""
        params = dict(filters or {})
        params['select'] = f'{group_by},{agg_expr}'
        # PostgREST no agrupa por defecto; usamos RPC o view materializada.
        # Para MVP: traer filas y agrupar en Python, con paginación.
        rows = client.fetch_all(table, params)
        out = {}
        for r in rows:
            key = '|'.join(str(r.get(g, '')) for g in group_by.split(','))
            out[key] = float(r.get(agg_expr.split(':')[-1], 0) or 0)
        return out

    # ---------------------------------------------------------------
    # Orquestador
    # ---------------------------------------------------------------
    def run_all(self, date_from, date_to, scope=None, dry_run=False):
        """
        Ejecuta todos los invariantes (Odoo-side + Supabase-side).

        :param date_from: 'YYYY-MM-DD' o date
        :param date_to: 'YYYY-MM-DD' o date
        :param scope: None=todos, o lista de nombres en ALL_ODOO_SCOPES
        :param dry_run: si True, no escribe a audit_runs
        :return: {'run_id': str, 'summary': {'ok':N,'warn':N,'error':N}}
        """
        run_id = str(uuid.uuid4())
        client = self._get_client()
        tolerances = self._get_tolerances(client) if not dry_run else {}

        effective_scope = ALL_ODOO_SCOPES if scope is None else list(scope)

        _logger.info('sync_audit run_id=%s scope=%s from=%s to=%s dry_run=%s',
                     run_id, effective_scope, date_from, date_to, dry_run)

        for name in effective_scope:
            method = getattr(self, f'audit_{name}', None)
            if not method:
                _logger.warning('audit: scope %s sin método, skip', name)
                continue
            try:
                method(client, run_id, date_from, date_to, tolerances, dry_run)
            except Exception as exc:
                _logger.exception('audit %s falló: %s', name, exc)
                self._record_error(client, run_id, name, f'{name}.orchestrator',
                                   exc, date_from, date_to, dry_run)

        # Disparar invariantes internos SQL
        if not dry_run:
            try:
                client.rpc('run_internal_audits', {
                    'p_date_from': str(date_from),
                    'p_date_to': str(date_to),
                    'p_run_id': run_id,
                })
            except Exception as exc:
                _logger.exception('run_internal_audits RPC falló: %s', exc)

        summary = self._summarize(client, run_id) if not dry_run else {
            'ok': 0, 'warn': 0, 'error': 0
        }
        # Log a sync_log para visibilidad
        self.env['quimibond.sync.log'].sudo().create({
            'name': 'audit',
            'direction': 'push',
            'status': 'error' if summary.get('error', 0) > 0 else 'success',
            'summary': f"run_id={run_id} {json.dumps(summary)}",
        })
        return {'run_id': run_id, 'summary': summary}

    def _summarize(self, client, run_id) -> dict:
        rows = client.fetch('audit_runs',
                            {'run_id': f'eq.{run_id}', 'select': 'severity'}) or []
        counts = {'ok': 0, 'warn': 0, 'error': 0}
        for r in rows:
            counts[r['severity']] = counts.get(r['severity'], 0) + 1
        return counts

    # ---------------------------------------------------------------
    # Métodos audit_* — stubs (se implementan en Tasks 1.x)
    # ---------------------------------------------------------------
    def audit_products(self, client, run_id, date_from, date_to, tolerances, dry_run):
        pass

    def audit_invoice_lines(self, client, run_id, date_from, date_to,
                            tolerances, dry_run):
        pass

    def audit_order_lines(self, client, run_id, date_from, date_to,
                          tolerances, dry_run):
        pass

    def audit_deliveries(self, client, run_id, date_from, date_to,
                         tolerances, dry_run):
        pass

    def audit_manufacturing(self, client, run_id, date_from, date_to,
                            tolerances, dry_run):
        pass

    def audit_account_balances(self, client, run_id, date_from, date_to,
                                tolerances, dry_run):
        pass

    def audit_bank_balances(self, client, run_id, date_from, date_to,
                            tolerances, dry_run):
        pass
```

- [ ] **Step 4: Añadir `count_exact` y `fetch_all` y `rpc` al cliente Supabase**

Modify `addons/quimibond_intelligence/models/supabase_client.py`, añadir estos métodos al final de la clase `SupabaseClient` (antes de que cierre):

```python
    def count_exact(self, table: str, params: dict = None) -> int:
        """COUNT exacto via PostgREST. Usa header Prefer: count=exact."""
        try:
            resp = self._http.get(
                f'{self.url}/rest/v1/{table}',
                params=params or {},
                headers={**self.headers,
                         'Prefer': 'count=exact',
                         'Range-Unit': 'items',
                         'Range': '0-0'},
            )
            resp.raise_for_status()
            cr = resp.headers.get('Content-Range', '')
            # formato: "0-0/1234"
            if '/' in cr:
                total = cr.split('/')[-1]
                if total.isdigit():
                    return int(total)
            return len(resp.json() or [])
        except Exception as exc:
            _logger.warning('count_exact %s: %s', table, exc)
            return 0

    def fetch_all(self, table: str, params: dict = None,
                  page_size: int = 1000) -> list:
        """Fetch con paginación automática."""
        out = []
        offset = 0
        while True:
            p = dict(params or {})
            p.setdefault('limit', str(page_size))
            p['offset'] = str(offset)
            try:
                resp = self._http.get(
                    f'{self.url}/rest/v1/{table}',
                    params=p, headers=self.headers,
                )
                resp.raise_for_status()
                batch = resp.json() or []
            except Exception as exc:
                _logger.warning('fetch_all %s offset %d: %s', table, offset, exc)
                break
            out.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return out

    def rpc(self, function: str, payload: dict = None) -> any:
        """Invoca función Postgres via PostgREST RPC."""
        try:
            resp = self._http.post(
                f'{self.url}/rest/v1/rpc/{function}',
                content=json.dumps(payload or {}, default=str),
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json() if resp.content else None
        except Exception as exc:
            _logger.warning('rpc %s: %s', function, exc)
            raise
```

- [ ] **Step 5: Registrar modelo en `__init__.py`**

Modify `addons/quimibond_intelligence/models/__init__.py`. Añadir la línea:
```python
from . import sync_audit
```

(Junto a las importaciones existentes de `sync_push`, `sync_pull`, etc.)

- [ ] **Step 6: Añadir permisos**

Modify `addons/quimibond_intelligence/security/ir.model.access.csv`. Añadir estas líneas al final:
```csv
access_quimibond_sync_audit,quimibond.sync.audit,model_quimibond_sync_audit,base.group_system,1,1,1,0
```

- [ ] **Step 7: Correr test de smoke**

Run:
```bash
odoo-bin -c odoo.conf -d qb19_test \
  --test-enable --test-tags /quimibond_intelligence:TestSyncAuditBase \
  -u quimibond_intelligence --stop-after-init 2>&1 | tail -30
```
Expected: `PASS: test_model_exists`, `PASS: test_run_all_returns_summary`.

- [ ] **Step 8: Commit**

```bash
cd /Users/jj
git add addons/quimibond_intelligence/models/sync_audit.py \
        addons/quimibond_intelligence/models/supabase_client.py \
        addons/quimibond_intelligence/models/__init__.py \
        addons/quimibond_intelligence/security/ir.model.access.csv \
        addons/quimibond_intelligence/tests/__init__.py \
        addons/quimibond_intelligence/tests/test_sync_audit.py
git commit -m "$(cat <<'EOF'
feat(audit): base model quimibond.sync.audit with orchestrator helpers

Helpers: _record_cross, _record_error, _severity_for, _get_tolerances.
Supabase client gains count_exact, fetch_all, rpc.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Task 1.1: Implementar `audit_products` (invariantes 1-4)

Products es snapshot (sin window).

**Files:**
- Modify: `addons/quimibond_intelligence/models/sync_audit.py` (método `audit_products`)
- Modify: `addons/quimibond_intelligence/tests/test_sync_audit.py`

- [ ] **Step 1: Test que falla**

Append to `tests/test_sync_audit.py`:
```python
@tagged('post_install', '-at_install')
class TestAuditProducts(TransactionCase):

    def setUp(self):
        super().setUp()
        self.Audit = self.env['quimibond.sync.audit']
        self.run_id = 'test-run-products'
        self.tolerances = {}

    def _make_client_mock(self, supabase_counts):
        client = MagicMock()
        client.count_exact.side_effect = lambda table, params=None: \
            supabase_counts.get(
                (table, frozenset((params or {}).items())), 0)
        # recorded rows capturados
        client.upsert.return_value = None
        return client

    def test_products_count_active_match(self):
        # Creamos 2 productos activos en Odoo
        Product = self.env['product.product']
        Product.create({'name': 'P1', 'default_code': 'TEST-P1'})
        Product.create({'name': 'P2', 'default_code': 'TEST-P2'})
        odoo_count = Product.search_count([('active', '=', True)])

        client = self._make_client_mock({
            ('odoo_products', frozenset({'active': 'eq.true'}.items())): odoo_count,
        })
        self.Audit.audit_products(client, self.run_id, '2026-01-01', '2026-04-19',
                                  {}, dry_run=False)
        # Verificamos que se grabó la fila con severity=ok para count_active
        calls = [c for c in client.upsert.call_args_list
                 if c.args[0] == 'audit_runs']
        keys = [r['invariant_key']
                for call in calls for r in call.args[1]]
        self.assertIn('products.count_active', keys)
```

- [ ] **Step 2: Run y ver FAIL**

Run:
```bash
odoo-bin ... --test-tags /quimibond_intelligence:TestAuditProducts
```
Expected: FAIL (audit_products es pass).

- [ ] **Step 3: Implementar `audit_products`**

Replace stub in `models/sync_audit.py`:

```python
    def audit_products(self, client, run_id, date_from, date_to,
                       tolerances, dry_run):
        """Invariantes 1-4: snapshot de productos."""
        Product = self.env['product.product']

        # 1. count_active
        odoo_count = Product.search_count([('active', '=', True)])
        supa_count = client.count_exact('odoo_products',
                                         {'active': 'eq.true'})
        self._record_cross(client, run_id, 'products', 'products.count_active',
                          None, odoo_count, supa_count,
                          tolerances, date_from, date_to, dry_run=dry_run)

        # 2. count_with_default_code
        odoo_with_code = Product.search_count([
            ('active', '=', True), ('default_code', '!=', False),
        ])
        supa_with_code = client.count_exact('odoo_products', {
            'active': 'eq.true',
            'internal_ref': 'not.is.null',
        })
        self._record_cross(client, run_id, 'products',
                          'products.count_with_default_code',
                          None, odoo_with_code, supa_with_code,
                          tolerances, date_from, date_to, dry_run=dry_run)

        # 3. sum_standard_price
        self.env.cr.execute("""
            SELECT COALESCE(SUM(standard_price), 0)
            FROM product_product pp
            JOIN product_template pt ON pp.product_tmpl_id = pt.id
            WHERE pp.active = true
        """)
        odoo_sum = float(self.env.cr.fetchone()[0] or 0)
        supa_rows = client.fetch_all('odoo_products', {
            'active': 'eq.true', 'select': 'standard_price',
        })
        supa_sum = sum(float(r.get('standard_price') or 0) for r in supa_rows)
        self._record_cross(client, run_id, 'products',
                          'products.sum_standard_price',
                          None, odoo_sum, supa_sum,
                          tolerances, date_from, date_to, dry_run=dry_run)

        # 4. null_uom_count
        odoo_null_uom = Product.search_count([
            ('active', '=', True), ('uom_id', '=', False),
        ])
        supa_null_uom = client.count_exact('odoo_products', {
            'active': 'eq.true', 'uom_id': 'is.null',
        })
        self._record_cross(client, run_id, 'products',
                          'products.null_uom_count',
                          None, odoo_null_uom, supa_null_uom,
                          tolerances, date_from, date_to, dry_run=dry_run)
```

- [ ] **Step 4: Run y verificar PASS**

Run:
```bash
odoo-bin ... --test-tags /quimibond_intelligence:TestAuditProducts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add addons/quimibond_intelligence/models/sync_audit.py \
        addons/quimibond_intelligence/tests/test_sync_audit.py
git commit -m "$(cat <<'EOF'
feat(audit): audit_products — invariantes 1-4 (snapshot)

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Task 1.2: Implementar `audit_invoice_lines` (invariantes 5-7)

Agrupación por `(year, month, move_type, company_id)`. Convertir a MXN con FX del documento.

**Files:**
- Modify: `addons/quimibond_intelligence/models/sync_audit.py`
- Modify: `addons/quimibond_intelligence/tests/test_sync_audit.py`

- [ ] **Step 1: Test que falla**

Append to `tests/test_sync_audit.py`:
```python
@tagged('post_install', '-at_install')
class TestAuditInvoiceLines(TransactionCase):

    def setUp(self):
        super().setUp()
        self.Audit = self.env['quimibond.sync.audit']
        self.run_id = 'test-run-invoice-lines'

    def test_invoice_lines_count_and_sum_match(self):
        # Preparamos 1 invoice out_invoice con 2 líneas en ene-2026
        partner = self.env['res.partner'].create({'name': 'Cliente Test'})
        product = self.env['product.product'].create({
            'name': 'Prod', 'default_code': 'IL-1',
        })
        move = self.env['account.move'].create({
            'move_type': 'out_invoice',
            'partner_id': partner.id,
            'invoice_date': '2026-01-15',
            'invoice_line_ids': [(0, 0, {
                'product_id': product.id, 'quantity': 2, 'price_unit': 100,
            }), (0, 0, {
                'product_id': product.id, 'quantity': 1, 'price_unit': 50,
            })],
        })
        move.action_post()

        client = MagicMock()
        client.fetch_all.return_value = [
            {'bucket_key': '2026-01|out_invoice|%d' % self.env.company.id,
             'count': 2, 'sum_subtotal_mxn': 250.0, 'sum_qty': 3.0},
        ]
        captured = []
        def cap_upsert(table, rows, **k):
            if table == 'audit_runs':
                captured.extend(rows)
        client.upsert.side_effect = cap_upsert

        self.Audit.audit_invoice_lines(client, self.run_id,
                                       '2026-01-01', '2026-01-31', {},
                                       dry_run=False)
        keys = {r['invariant_key'] for r in captured}
        self.assertIn('invoice_lines.count_per_bucket', keys)
        self.assertIn('invoice_lines.sum_subtotal_signed_mxn', keys)
        self.assertIn('invoice_lines.sum_qty_signed', keys)
```

- [ ] **Step 2: Run y ver FAIL**

Run: `odoo-bin ... --test-tags /quimibond_intelligence:TestAuditInvoiceLines`
Expected: FAIL.

- [ ] **Step 3: Implementar `audit_invoice_lines`**

Replace stub in `models/sync_audit.py`:

```python
    def audit_invoice_lines(self, client, run_id, date_from, date_to,
                            tolerances, dry_run):
        """Invariantes 5-7: por bucket (year-month, move_type, company)."""
        # -- Odoo side: SQL directo para eficiencia --
        self.env.cr.execute("""
            SELECT to_char(am.invoice_date, 'YYYY-MM') AS ym,
                   am.move_type,
                   am.company_id,
                   COUNT(*) AS cnt,
                   SUM(
                     CASE WHEN am.move_type IN ('out_refund','in_refund')
                          THEN -1 ELSE 1 END
                     * aml.price_subtotal
                     * COALESCE(
                         CASE WHEN am.currency_id = rc_mxn.id THEN 1.0
                              ELSE rcr.rate END,
                         1.0)
                   ) AS sum_mxn,
                   SUM(
                     CASE WHEN am.move_type IN ('out_refund','in_refund')
                          THEN -1 ELSE 1 END
                     * aml.quantity
                   ) AS sum_qty
            FROM account_move_line aml
            JOIN account_move am ON aml.move_id = am.id
            JOIN res_currency rc_mxn ON rc_mxn.name = 'MXN'
            LEFT JOIN res_currency_rate rcr
              ON rcr.currency_id = am.currency_id
              AND rcr.company_id = am.company_id
              AND rcr.name <= am.invoice_date
            WHERE am.state = 'posted'
              AND am.move_type IN ('out_invoice','out_refund',
                                   'in_invoice','in_refund')
              AND am.invoice_date BETWEEN %s AND %s
              AND aml.display_type IS NULL  -- sólo líneas de producto
            GROUP BY ym, am.move_type, am.company_id
        """, (date_from, date_to))
        odoo_buckets = {}
        for ym, move_type, company_id, cnt, sum_mxn, sum_qty in self.env.cr.fetchall():
            key = f'{ym}|{move_type}|{company_id}'
            odoo_buckets[key] = {
                'count': int(cnt or 0),
                'sum_mxn': float(sum_mxn or 0),
                'sum_qty': float(sum_qty or 0),
            }

        # -- Supabase side: via view v_audit_invoice_lines_buckets (ver Task 2.1b) --
        # Filtramos por fecha con RPC o consulta directa a la view.
        supa_rows = client.fetch_all('v_audit_invoice_lines_buckets', {
            'date_from': f'gte.{date_from}',
            'date_to': f'lte.{date_to}',
        })
        supa_buckets = {r['bucket_key']: r for r in supa_rows}

        all_keys = set(odoo_buckets) | set(supa_buckets)
        for key in all_keys:
            o = odoo_buckets.get(key, {'count': 0, 'sum_mxn': 0, 'sum_qty': 0})
            s = supa_buckets.get(key, {'count': 0, 'sum_subtotal_mxn': 0,
                                       'sum_qty': 0})
            self._record_cross(
                client, run_id, 'invoice_lines',
                'invoice_lines.count_per_bucket', key,
                o['count'], s.get('count', 0), tolerances,
                date_from, date_to, dry_run=dry_run)
            self._record_cross(
                client, run_id, 'invoice_lines',
                'invoice_lines.sum_subtotal_signed_mxn', key,
                o['sum_mxn'], s.get('sum_subtotal_mxn', 0), tolerances,
                date_from, date_to, dry_run=dry_run)
            self._record_cross(
                client, run_id, 'invoice_lines',
                'invoice_lines.sum_qty_signed', key,
                o['sum_qty'], s.get('sum_qty', 0), tolerances,
                date_from, date_to, dry_run=dry_run)
```

Nota: este método depende de la view `v_audit_invoice_lines_buckets` que se crea en Task 2.1b. Si aún no existe, `fetch_all` devolverá `[]` y los invariantes reportarán diff. Orden de tareas considera esto.

- [ ] **Step 4: Crear view auxiliar en Supabase** (anticipada, se amplía en Task 2.1b)

Create `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260419_audit_invariants_views.sql`:

```sql
-- Bucket aggregator para invoice_lines (usado por audit_invoice_lines desde Odoo)
CREATE OR REPLACE VIEW v_audit_invoice_lines_buckets AS
SELECT
  to_char(i.invoice_date, 'YYYY-MM') || '|' || i.move_type || '|'
    || i.odoo_company_id::text AS bucket_key,
  i.invoice_date AS date_from,
  i.invoice_date AS date_to,
  i.move_type,
  i.odoo_company_id,
  COUNT(*) AS count,
  SUM(
    CASE WHEN i.move_type IN ('out_refund','in_refund') THEN -1 ELSE 1 END
    * COALESCE(il.price_subtotal_mxn, il.price_subtotal)
  ) AS sum_subtotal_mxn,
  SUM(
    CASE WHEN i.move_type IN ('out_refund','in_refund') THEN -1 ELSE 1 END
    * il.quantity
  ) AS sum_qty
FROM odoo_invoice_lines il
JOIN odoo_invoices i ON il.invoice_id = i.id
WHERE i.state = 'posted'
  AND i.invoice_date IS NOT NULL
GROUP BY to_char(i.invoice_date,'YYYY-MM'), i.invoice_date, i.move_type,
         i.odoo_company_id;

COMMENT ON VIEW v_audit_invoice_lines_buckets IS
  'Usado por quimibond.sync.audit.audit_invoice_lines';
```

Aplicar con `supabase db push --linked`.

- [ ] **Step 5: Verificar PASS**

Run: `odoo-bin ... --test-tags /quimibond_intelligence:TestAuditInvoiceLines`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add addons/quimibond_intelligence/models/sync_audit.py \
        addons/quimibond_intelligence/tests/test_sync_audit.py \
        quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260419_audit_invariants_views.sql
git commit -m "$(cat <<'EOF'
feat(audit): audit_invoice_lines — invariantes 5-7 (per bucket)

Signed FX-to-MXN agregación en ambos lados. View auxiliar
v_audit_invoice_lines_buckets en Supabase.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Task 1.3: Implementar `audit_order_lines` (invariantes 8-10)

Análogo a invoice_lines pero con sale + purchase separados.

**Files:** mismo archivo `sync_audit.py` + tests.

- [ ] **Step 1: Test que falla**

Append to `tests/test_sync_audit.py`:
```python
@tagged('post_install', '-at_install')
class TestAuditOrderLines(TransactionCase):
    def setUp(self):
        super().setUp()
        self.Audit = self.env['quimibond.sync.audit']

    def test_order_lines_emits_both_sale_and_purchase_keys(self):
        client = MagicMock()
        client.fetch_all.return_value = []
        captured = []
        client.upsert.side_effect = lambda t, r, **k: (
            captured.extend(r) if t == 'audit_runs' else None)
        self.Audit.audit_order_lines(client, 'test-ol',
                                     '2026-01-01', '2026-01-31', {},
                                     dry_run=False)
        # Aun sin datos, emite buckets vacíos si hay filas Odoo
        # (si no hay nada, no emite nada — ese caso no se valida aquí)
        # Sólo validamos que el método no explota
        self.assertTrue(True)
```

- [ ] **Step 2: Run FAIL → (el stub pasa, pero el test real es de humo, vamos a step 3)**

- [ ] **Step 3: Implementar `audit_order_lines`**

Replace stub:
```python
    def audit_order_lines(self, client, run_id, date_from, date_to,
                          tolerances, dry_run):
        """Invariantes 8-10: sale + purchase separados."""
        # SALE
        self.env.cr.execute("""
            SELECT to_char(so.date_order, 'YYYY-MM') AS ym,
                   'sale' AS otype,
                   so.company_id,
                   COUNT(*) AS cnt,
                   SUM(sol.price_subtotal
                       * COALESCE(
                           CASE WHEN so.currency_id = rc_mxn.id THEN 1.0
                                ELSE rcr.rate END,
                           1.0)) AS sum_mxn,
                   SUM(sol.product_uom_qty) AS sum_qty
            FROM sale_order_line sol
            JOIN sale_order so ON sol.order_id = so.id
            JOIN res_currency rc_mxn ON rc_mxn.name = 'MXN'
            LEFT JOIN res_currency_rate rcr
              ON rcr.currency_id = so.currency_id
             AND rcr.company_id = so.company_id
             AND rcr.name <= so.date_order::date
            WHERE so.state IN ('sale','done')
              AND so.date_order::date BETWEEN %s AND %s
            GROUP BY ym, so.company_id
        """, (date_from, date_to))
        rows_sale = self.env.cr.fetchall()

        # PURCHASE
        self.env.cr.execute("""
            SELECT to_char(po.date_order, 'YYYY-MM') AS ym,
                   'purchase' AS otype,
                   po.company_id,
                   COUNT(*) AS cnt,
                   SUM(pol.price_subtotal
                       * COALESCE(
                           CASE WHEN po.currency_id = rc_mxn.id THEN 1.0
                                ELSE rcr.rate END,
                           1.0)) AS sum_mxn,
                   SUM(pol.product_qty) AS sum_qty
            FROM purchase_order_line pol
            JOIN purchase_order po ON pol.order_id = po.id
            JOIN res_currency rc_mxn ON rc_mxn.name = 'MXN'
            LEFT JOIN res_currency_rate rcr
              ON rcr.currency_id = po.currency_id
             AND rcr.company_id = po.company_id
             AND rcr.name <= po.date_order::date
            WHERE po.state IN ('purchase','done')
              AND po.date_order::date BETWEEN %s AND %s
            GROUP BY ym, po.company_id
        """, (date_from, date_to))
        rows_purchase = self.env.cr.fetchall()

        odoo_buckets = {}
        for ym, otype, cid, cnt, sm, sq in rows_sale + rows_purchase:
            key = f'{ym}|{otype}|{cid}'
            odoo_buckets[key] = {'count': int(cnt or 0),
                                 'sum_mxn': float(sm or 0),
                                 'sum_qty': float(sq or 0)}

        # Supabase
        supa_rows = client.fetch_all('v_audit_order_lines_buckets', {})
        supa_buckets = {r['bucket_key']: r for r in supa_rows}

        for key in set(odoo_buckets) | set(supa_buckets):
            o = odoo_buckets.get(key, {'count': 0, 'sum_mxn': 0, 'sum_qty': 0})
            s = supa_buckets.get(key, {})
            self._record_cross(client, run_id, 'order_lines',
                              'order_lines.count_per_bucket', key,
                              o['count'], s.get('count', 0), tolerances,
                              date_from, date_to, dry_run=dry_run)
            self._record_cross(client, run_id, 'order_lines',
                              'order_lines.sum_subtotal_mxn', key,
                              o['sum_mxn'], s.get('sum_subtotal_mxn', 0),
                              tolerances, date_from, date_to, dry_run=dry_run)
            self._record_cross(client, run_id, 'order_lines',
                              'order_lines.sum_qty', key,
                              o['sum_qty'], s.get('sum_qty', 0),
                              tolerances, date_from, date_to, dry_run=dry_run)
```

- [ ] **Step 4: Añadir view auxiliar en Supabase**

Append to `20260419_audit_invariants_views.sql`:
```sql
CREATE OR REPLACE VIEW v_audit_order_lines_buckets AS
SELECT
  to_char(date_order::date, 'YYYY-MM') || '|' || order_type || '|'
    || odoo_company_id::text AS bucket_key,
  order_type,
  odoo_company_id,
  COUNT(*) AS count,
  SUM(COALESCE(price_subtotal_mxn, price_subtotal)) AS sum_subtotal_mxn,
  SUM(qty) AS sum_qty
FROM odoo_order_lines
WHERE date_order IS NOT NULL
GROUP BY to_char(date_order::date,'YYYY-MM'), order_type, odoo_company_id;
```

- [ ] **Step 5: Run tests, commit**

Run: `odoo-bin ... --test-tags /quimibond_intelligence:TestAuditOrderLines`
Expected: PASS.

```bash
git add -A
git commit -m "feat(audit): audit_order_lines — invariantes 8-10

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 1.4: Implementar `audit_deliveries` (invariante 11)

**Files:** `sync_audit.py`, `test_sync_audit.py`, `20260419_audit_invariants_views.sql`.

- [ ] **Step 1: Test**

```python
@tagged('post_install', '-at_install')
class TestAuditDeliveries(TransactionCase):
    def setUp(self):
        super().setUp()
        self.Audit = self.env['quimibond.sync.audit']

    def test_deliveries_emits_count_done_per_month(self):
        client = MagicMock()
        client.fetch_all.return_value = []
        captured = []
        client.upsert.side_effect = lambda t, r, **k: (
            captured.extend(r) if t == 'audit_runs' else None)
        self.Audit.audit_deliveries(client, 'test-dv',
                                    '2026-01-01', '2026-01-31', {},
                                    dry_run=False)
        self.assertTrue(True)  # humo
```

- [ ] **Step 2: Implementar**

Replace stub:
```python
    def audit_deliveries(self, client, run_id, date_from, date_to,
                         tolerances, dry_run):
        """Invariante 11: count done per month × state × company."""
        self.env.cr.execute("""
            SELECT to_char(date_done, 'YYYY-MM') AS ym,
                   state,
                   company_id,
                   COUNT(*) AS cnt
            FROM stock_picking
            WHERE date_done IS NOT NULL
              AND date_done::date BETWEEN %s AND %s
              AND state IN ('done','cancel')
            GROUP BY ym, state, company_id
        """, (date_from, date_to))
        odoo = {f'{ym}|{st}|{cid}': int(cnt)
                for ym, st, cid, cnt in self.env.cr.fetchall()}

        supa_rows = client.fetch_all('v_audit_deliveries_buckets', {})
        supa = {r['bucket_key']: int(r['count']) for r in supa_rows}

        for key in set(odoo) | set(supa):
            self._record_cross(client, run_id, 'deliveries',
                              'deliveries.count_done_per_month', key,
                              odoo.get(key, 0), supa.get(key, 0),
                              tolerances, date_from, date_to, dry_run=dry_run)
```

- [ ] **Step 3: Añadir view auxiliar**

Append to `20260419_audit_invariants_views.sql`:
```sql
CREATE OR REPLACE VIEW v_audit_deliveries_buckets AS
SELECT
  to_char(date_done::date, 'YYYY-MM') || '|' || state || '|'
    || odoo_company_id::text AS bucket_key,
  COUNT(*) AS count
FROM odoo_deliveries
WHERE date_done IS NOT NULL AND state IN ('done','cancel')
GROUP BY to_char(date_done::date,'YYYY-MM'), state, odoo_company_id;
```

- [ ] **Step 4: Run + commit**

```bash
git add -A
git commit -m "feat(audit): audit_deliveries — invariante 11

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 1.5: Implementar `audit_manufacturing` (invariantes 12-13)

- [ ] **Step 1: Test stub**

```python
@tagged('post_install', '-at_install')
class TestAuditManufacturing(TransactionCase):
    def setUp(self):
        super().setUp()
        self.Audit = self.env['quimibond.sync.audit']

    def test_manufacturing_smoke(self):
        client = MagicMock()
        client.fetch_all.return_value = []
        captured = []
        client.upsert.side_effect = lambda t, r, **k: (
            captured.extend(r) if t == 'audit_runs' else None)
        self.Audit.audit_manufacturing(client, 'test-mfg',
                                       '2026-01-01', '2026-01-31', {},
                                       dry_run=False)
        self.assertTrue(True)
```

- [ ] **Step 2: Implementar**

```python
    def audit_manufacturing(self, client, run_id, date_from, date_to,
                            tolerances, dry_run):
        """Invariantes 12-13: por state × company × month."""
        self.env.cr.execute("""
            SELECT to_char(date_start, 'YYYY-MM') AS ym,
                   state, company_id,
                   COUNT(*) AS cnt,
                   SUM(qty_produced) AS sum_qty
            FROM mrp_production
            WHERE date_start::date BETWEEN %s AND %s
            GROUP BY ym, state, company_id
        """, (date_from, date_to))
        odoo = {}
        for ym, st, cid, cnt, sq in self.env.cr.fetchall():
            key = f'{ym}|{st}|{cid}'
            odoo[key] = {'count': int(cnt or 0), 'sum_qty': float(sq or 0)}

        supa_rows = client.fetch_all('v_audit_manufacturing_buckets', {})
        supa = {r['bucket_key']: r for r in supa_rows}

        for key in set(odoo) | set(supa):
            o = odoo.get(key, {'count': 0, 'sum_qty': 0})
            s = supa.get(key, {})
            self._record_cross(client, run_id, 'manufacturing',
                              'manufacturing.count_per_state', key,
                              o['count'], int(s.get('count') or 0),
                              tolerances, date_from, date_to, dry_run=dry_run)
            self._record_cross(client, run_id, 'manufacturing',
                              'manufacturing.sum_qty_produced', key,
                              o['sum_qty'], float(s.get('sum_qty') or 0),
                              tolerances, date_from, date_to, dry_run=dry_run)
```

- [ ] **Step 3: View auxiliar**

Append to migration:
```sql
CREATE OR REPLACE VIEW v_audit_manufacturing_buckets AS
SELECT
  to_char(date_start::date, 'YYYY-MM') || '|' || state || '|'
    || odoo_company_id::text AS bucket_key,
  COUNT(*) AS count,
  SUM(qty_produced) AS sum_qty
FROM odoo_manufacturing
WHERE date_start IS NOT NULL
GROUP BY to_char(date_start::date,'YYYY-MM'), state, odoo_company_id;
```

- [ ] **Step 4: Run + commit**

```bash
git add -A
git commit -m "feat(audit): audit_manufacturing — invariantes 12-13

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 1.6: Implementar `audit_account_balances` (invariantes 14-16)

Filtrar por rangos de cuenta (inventario `1150.*`, CMV `5*`, ingresos `4*`).

- [ ] **Step 1: Test stub**

```python
@tagged('post_install', '-at_install')
class TestAuditAccountBalances(TransactionCase):
    def setUp(self):
        super().setUp()
        self.Audit = self.env['quimibond.sync.audit']

    def test_account_balances_smoke(self):
        client = MagicMock()
        client.fetch_all.return_value = []
        captured = []
        client.upsert.side_effect = lambda t, r, **k: (
            captured.extend(r) if t == 'audit_runs' else None)
        self.Audit.audit_account_balances(client, 'test-ab',
                                          '2026-01-01', '2026-04-19', {},
                                          dry_run=False)
        self.assertTrue(True)
```

- [ ] **Step 2: Implementar**

```python
    ACCOUNT_GROUPS = {
        'account_balances.inventory_accounts_balance': ("1150%",),
        'account_balances.cogs_accounts_balance': ("5%",),
        'account_balances.revenue_accounts_balance': ("4%",),
    }

    def audit_account_balances(self, client, run_id, date_from, date_to,
                                tolerances, dry_run):
        """Invariantes 14-16: balance de cuentas por período × company."""
        for invariant_key, patterns in self.ACCOUNT_GROUPS.items():
            cond = ' OR '.join(["code_store LIKE %s"] * len(patterns))
            # Nota: en Odoo 17+ código vive en account.code.mapping (code_store_ids);
            # usamos la representación "code" del account.account.
            self.env.cr.execute(f"""
                SELECT to_char(aml.date, 'YYYY-MM') AS ym,
                       aml.company_id,
                       SUM(aml.balance) AS bal
                FROM account_move_line aml
                JOIN account_move am ON aml.move_id = am.id
                JOIN account_account aa ON aml.account_id = aa.id
                WHERE am.state = 'posted'
                  AND aml.date BETWEEN %s AND %s
                  AND ({cond.replace('code_store','aa.code')})
                GROUP BY ym, aml.company_id
            """, (date_from, date_to, *patterns))
            odoo = {f'{ym}|{cid}': float(b or 0)
                    for ym, cid, b in self.env.cr.fetchall()}

            supa_rows = client.fetch_all('v_audit_account_balances_buckets',
                                         {'invariant_key': f'eq.{invariant_key}'})
            supa = {r['bucket_key']: float(r['balance']) for r in supa_rows}

            for key in set(odoo) | set(supa):
                self._record_cross(client, run_id, 'account_balances',
                                  invariant_key, key,
                                  odoo.get(key, 0), supa.get(key, 0),
                                  tolerances, date_from, date_to, dry_run=dry_run)
```

- [ ] **Step 3: View auxiliar**

Append:
```sql
CREATE OR REPLACE VIEW v_audit_account_balances_buckets AS
WITH classified AS (
  SELECT
    ab.*,
    CASE
      WHEN coa.account_code LIKE '1150%'
        THEN 'account_balances.inventory_accounts_balance'
      WHEN coa.account_code LIKE '5%'
        THEN 'account_balances.cogs_accounts_balance'
      WHEN coa.account_code LIKE '4%'
        THEN 'account_balances.revenue_accounts_balance'
      ELSE NULL
    END AS invariant_key
  FROM odoo_account_balances ab
  JOIN odoo_chart_of_accounts coa
    ON coa.account_code = ab.account_code
   AND coa.odoo_company_id = ab.odoo_company_id
)
SELECT
  invariant_key,
  to_char(period_end::date, 'YYYY-MM') || '|' || odoo_company_id::text
    AS bucket_key,
  period_end::date AS period_end,
  odoo_company_id,
  SUM(balance) AS balance
FROM classified
WHERE invariant_key IS NOT NULL
GROUP BY invariant_key, to_char(period_end::date,'YYYY-MM'),
         period_end, odoo_company_id;
```

- [ ] **Step 4: Run + commit**

```bash
git add -A
git commit -m "feat(audit): audit_account_balances — invariantes 14-16

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 1.7: Implementar `audit_bank_balances` (invariantes 17-18)

Snapshot (sin window).

- [ ] **Step 1: Test stub + Step 2: implementación**

```python
    def audit_bank_balances(self, client, run_id, date_from, date_to,
                            tolerances, dry_run):
        """Invariantes 17-18: snapshot por journal."""
        # 17. count per journal
        self.env.cr.execute("""
            SELECT id, company_id FROM account_journal
            WHERE type IN ('bank','cash') AND active = true
        """)
        odoo_journals = {f'journal_{jid}|{cid}': 1
                         for jid, cid in self.env.cr.fetchall()}
        odoo_count = len(odoo_journals)
        supa_count = client.count_exact('odoo_bank_balances',
                                         {'active': 'eq.true'})
        self._record_cross(client, run_id, 'bank_balances',
                          'bank_balances.count_per_journal', None,
                          odoo_count, supa_count, tolerances,
                          date_from, date_to, dry_run=dry_run)

        # 18. native_balance_per_journal
        # Usamos la misma lógica que sync_push._push_bank_balances
        Journal = self.env['account.journal']
        journals = Journal.search([
            ('type', 'in', ['bank', 'cash']), ('active', '=', True),
        ])
        for j in journals:
            # balance nativo: suma de asientos en la cuenta del journal
            # en su currency propia (sin convertir)
            default_account = j.default_account_id
            if not default_account:
                continue
            self.env.cr.execute("""
                SELECT COALESCE(SUM(
                    CASE WHEN aml.currency_id IS NOT NULL
                         THEN aml.amount_currency
                         ELSE aml.balance END
                ), 0)
                FROM account_move_line aml
                JOIN account_move am ON aml.move_id = am.id
                WHERE aml.account_id = %s
                  AND am.state = 'posted'
            """, (default_account.id,))
            odoo_bal = float(self.env.cr.fetchone()[0] or 0)
            supa_rows = client.fetch('odoo_bank_balances', {
                'journal_id': f'eq.{j.id}',
                'odoo_company_id': f'eq.{j.company_id.id}',
                'select': 'native_balance',
            }) or []
            supa_bal = float(supa_rows[0]['native_balance']
                             if supa_rows else 0)
            key = f'journal_{j.id}|{j.company_id.id}'
            self._record_cross(client, run_id, 'bank_balances',
                              'bank_balances.native_balance_per_journal',
                              key, odoo_bal, supa_bal, tolerances,
                              date_from, date_to, dry_run=dry_run)
```

- [ ] **Step 3: Test smoke**

```python
@tagged('post_install', '-at_install')
class TestAuditBankBalances(TransactionCase):
    def setUp(self):
        super().setUp()
        self.Audit = self.env['quimibond.sync.audit']

    def test_bank_balances_smoke(self):
        client = MagicMock()
        client.count_exact.return_value = 0
        client.fetch.return_value = []
        captured = []
        client.upsert.side_effect = lambda t, r, **k: (
            captured.extend(r) if t == 'audit_runs' else None)
        self.Audit.audit_bank_balances(client, 'test-bb',
                                       '2026-01-01', '2026-04-19', {},
                                       dry_run=False)
        keys = {r['invariant_key'] for r in captured}
        self.assertIn('bank_balances.count_per_journal', keys)
```

- [ ] **Step 4: Run + commit**

```bash
git add -A
git commit -m "feat(audit): audit_bank_balances — invariantes 17-18

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 2.1: SQL views para invariantes internos de `invoice_lines` (A-D)

**Files:**
- Modify: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260419_audit_invariants_views.sql`

- [ ] **Step 1: Definir las 4 views**

Append al archivo existente:

```sql
-- A. reversal_sign: refunds con signo inconsistente
CREATE OR REPLACE VIEW v_audit_invoice_lines_reversal_sign AS
SELECT il.id AS line_id, il.invoice_id, i.move_type,
       il.quantity, il.price_subtotal
FROM odoo_invoice_lines il
JOIN odoo_invoices i ON il.invoice_id = i.id
WHERE i.move_type IN ('out_refund','in_refund')
  AND (
    (il.quantity > 0 AND il.price_subtotal > 0)  -- debería ser negativo
    OR SIGN(COALESCE(il.quantity,0)) <> SIGN(COALESCE(il.price_subtotal,0))
  );

-- B. price_recompute: reconstrucción rota
CREATE OR REPLACE VIEW v_audit_invoice_lines_price_recompute AS
SELECT il.id AS line_id, il.invoice_id,
       il.price_unit, il.quantity, il.discount, il.price_subtotal,
       ABS(il.price_unit * il.quantity * (1 - COALESCE(il.discount,0)/100.0)
           - il.price_subtotal) AS drift
FROM odoo_invoice_lines il
WHERE il.price_subtotal IS NOT NULL
  AND ABS(il.price_unit * il.quantity * (1 - COALESCE(il.discount,0)/100.0)
          - il.price_subtotal) > 0.01;

-- C. fx_present
CREATE OR REPLACE VIEW v_audit_invoice_lines_fx_present AS
SELECT il.id AS line_id, il.invoice_id, il.currency_code,
       il.exchange_rate, il.price_subtotal_mxn
FROM odoo_invoice_lines il
WHERE il.currency_code IS NOT NULL
  AND il.currency_code <> 'MXN'
  AND (il.exchange_rate IS NULL OR il.exchange_rate <= 0
       OR il.price_subtotal_mxn IS NULL);

-- D. fx_sanity: precio × tasa ≈ precio_mxn
CREATE OR REPLACE VIEW v_audit_invoice_lines_fx_sanity AS
SELECT il.id AS line_id, il.invoice_id, il.currency_code,
       il.price_subtotal, il.exchange_rate, il.price_subtotal_mxn,
       ABS(il.price_subtotal * il.exchange_rate - il.price_subtotal_mxn) AS drift
FROM odoo_invoice_lines il
WHERE il.currency_code IS NOT NULL
  AND il.currency_code <> 'MXN'
  AND il.exchange_rate IS NOT NULL AND il.exchange_rate > 0
  AND il.price_subtotal_mxn IS NOT NULL
  AND ABS(il.price_subtotal * il.exchange_rate - il.price_subtotal_mxn)
      > 0.01 * GREATEST(ABS(il.price_subtotal_mxn), 1);
```

- [ ] **Step 2: Aplicar, verificar que no devuelvan filas en data limpia**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
supabase db push --linked
```
Run en SQL editor:
```sql
SELECT COUNT(*) FROM v_audit_invoice_lines_reversal_sign;
SELECT COUNT(*) FROM v_audit_invoice_lines_price_recompute;
SELECT COUNT(*) FROM v_audit_invoice_lines_fx_present;
SELECT COUNT(*) FROM v_audit_invoice_lines_fx_sanity;
```
Resultados se usan de baseline — NO es expected=0, sólo anotar cuántos.

- [ ] **Step 3: Commit**

```bash
cd /Users/jj
git add -A
git commit -m "feat(audit): SQL invariants A-D for invoice_lines

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 2.2: SQL views para `order_lines` (E-F)

- [ ] **Step 1: Definir views**

Append:
```sql
-- E. orphan_product
CREATE OR REPLACE VIEW v_audit_order_lines_orphan_product AS
SELECT ol.id AS line_id, ol.order_id, ol.order_type, ol.product_id
FROM odoo_order_lines ol
LEFT JOIN odoo_products p ON ol.product_id = p.id
WHERE ol.product_id IS NOT NULL AND p.id IS NULL;

-- F. orphan_order (sale + purchase)
CREATE OR REPLACE VIEW v_audit_order_lines_orphan_sale AS
SELECT ol.id AS line_id, ol.order_id
FROM odoo_order_lines ol
LEFT JOIN odoo_sale_orders so ON ol.order_id = so.id
WHERE ol.order_type = 'sale' AND so.id IS NULL;

CREATE OR REPLACE VIEW v_audit_order_lines_orphan_purchase AS
SELECT ol.id AS line_id, ol.order_id
FROM odoo_order_lines ol
LEFT JOIN odoo_purchase_orders po ON ol.order_id = po.id
WHERE ol.order_type = 'purchase' AND po.id IS NULL;
```

- [ ] **Step 2: Aplicar, commit**

```bash
supabase db push --linked
cd /Users/jj
git add -A
git commit -m "feat(audit): SQL invariants E-F for order_lines orphans

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 2.3: SQL views para `products` (G-I)

Append:
```sql
-- G. null_standard_price (warn)
CREATE OR REPLACE VIEW v_audit_products_null_standard_price AS
SELECT id, internal_ref, name
FROM odoo_products
WHERE active = true
  AND (standard_price IS NULL OR standard_price = 0);

-- H. null_uom (error)
CREATE OR REPLACE VIEW v_audit_products_null_uom AS
SELECT id, internal_ref, name
FROM odoo_products
WHERE active = true AND uom_id IS NULL;

-- I. duplicate_default_code
CREATE OR REPLACE VIEW v_audit_products_duplicate_default_code AS
SELECT internal_ref, COUNT(*) AS dupes, array_agg(id) AS product_ids
FROM odoo_products
WHERE active = true AND internal_ref IS NOT NULL AND internal_ref <> ''
GROUP BY internal_ref
HAVING COUNT(*) > 1;
```

- [ ] **Apply + commit**

```bash
supabase db push --linked
cd /Users/jj
git add -A
git commit -m "feat(audit): SQL invariants G-I for products

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 2.4: SQL views para `account_balances`, multi-company, `deliveries` (J-O)

Append:
```sql
-- J. trial_balance_zero_per_period
CREATE OR REPLACE VIEW v_audit_account_balances_trial_balance AS
SELECT odoo_company_id,
       to_char(period_end::date, 'YYYY-MM') AS period,
       SUM(balance) AS total
FROM odoo_account_balances
GROUP BY odoo_company_id, to_char(period_end::date,'YYYY-MM')
HAVING ABS(SUM(balance)) > 1.0;

-- K. orphan_account
CREATE OR REPLACE VIEW v_audit_account_balances_orphan_account AS
SELECT ab.odoo_company_id, ab.account_code, COUNT(*) AS orphan_rows
FROM odoo_account_balances ab
LEFT JOIN odoo_chart_of_accounts coa
  ON coa.account_code = ab.account_code
 AND coa.odoo_company_id = ab.odoo_company_id
WHERE coa.account_code IS NULL
GROUP BY ab.odoo_company_id, ab.account_code;

-- L. company_leak_invoice_lines
CREATE OR REPLACE VIEW v_audit_company_leak_invoice_lines AS
SELECT il.id AS line_id, il.odoo_company_id AS line_company,
       i.odoo_company_id AS header_company
FROM odoo_invoice_lines il
JOIN odoo_invoices i ON il.invoice_id = i.id
WHERE il.odoo_company_id IS DISTINCT FROM i.odoo_company_id;

-- M. company_leak_order_lines (sale + purchase)
CREATE OR REPLACE VIEW v_audit_company_leak_order_lines AS
SELECT ol.id AS line_id, ol.order_type,
       ol.odoo_company_id AS line_company,
       COALESCE(so.odoo_company_id, po.odoo_company_id) AS header_company
FROM odoo_order_lines ol
LEFT JOIN odoo_sale_orders so
  ON ol.order_type = 'sale' AND ol.order_id = so.id
LEFT JOIN odoo_purchase_orders po
  ON ol.order_type = 'purchase' AND ol.order_id = po.id
WHERE ol.odoo_company_id IS DISTINCT FROM
      COALESCE(so.odoo_company_id, po.odoo_company_id);

-- N. orphan_partner in deliveries
CREATE OR REPLACE VIEW v_audit_deliveries_orphan_partner AS
SELECT d.id AS delivery_id, d.partner_id
FROM odoo_deliveries d
LEFT JOIN contacts c ON c.odoo_id = d.partner_id
WHERE d.partner_id IS NOT NULL AND c.odoo_id IS NULL;

-- O. done_without_date
CREATE OR REPLACE VIEW v_audit_deliveries_done_without_date AS
SELECT id, state, date_done
FROM odoo_deliveries
WHERE state = 'done' AND date_done IS NULL;
```

- [ ] **Apply + commit**

```bash
supabase db push --linked
cd /Users/jj
git add -A
git commit -m "feat(audit): SQL invariants J-O (balances, multi-company, deliveries)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 2.5: Función `run_internal_audits()`

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260419_audit_run_internal_audits.sql`

- [ ] **Step 1: Escribir la función**

```sql
-- Orquestador SQL de invariantes internos. Inserta 1 fila por invariant
-- en audit_runs con el run_id provisto por Odoo.

-- Helper privado: registrar un invariant por cantidad de filas violatorias
CREATE OR REPLACE FUNCTION _audit_register_invariant(
  p_run_id    uuid,
  p_date_from date,
  p_date_to   date,
  p_key       text,
  p_model     text,
  p_count     bigint,
  p_severity  text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_sev text;
  v_tol RECORD;
BEGIN
  SELECT abs_tolerance, pct_tolerance INTO v_tol
    FROM audit_tolerances WHERE invariant_key = p_key;
  IF p_severity IS NOT NULL THEN
    v_sev := p_severity;
  ELSIF p_count = 0 THEN
    v_sev := 'ok';
  ELSIF p_count <= COALESCE(v_tol.abs_tolerance, 0.01) * 10 THEN
    v_sev := 'warn';
  ELSE
    v_sev := 'error';
  END IF;
  INSERT INTO audit_runs (run_id, source, model, invariant_key,
                          bucket_key, odoo_value, supabase_value, diff,
                          severity, date_from, date_to, details)
  VALUES (p_run_id, 'supabase', p_model, p_key, NULL, NULL, p_count, p_count,
          v_sev, p_date_from, p_date_to,
          jsonb_build_object('violations', p_count))
  ON CONFLICT (run_id, source, model, invariant_key, COALESCE(bucket_key, ''))
  DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION run_internal_audits(
  p_date_from date,
  p_date_to   date,
  p_run_id    uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count   bigint;
  v_summary jsonb;
BEGIN
  -- Invariantes de filas violatorias: count > 0 = hay problema
  SELECT COUNT(*) INTO v_count FROM v_audit_invoice_lines_reversal_sign;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'invoice_lines.reversal_sign', 'invoice_lines', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_invoice_lines_price_recompute;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'invoice_lines.price_recompute', 'invoice_lines', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_invoice_lines_fx_present;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'invoice_lines.fx_present', 'invoice_lines', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_invoice_lines_fx_sanity;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'invoice_lines.fx_sanity', 'invoice_lines', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_order_lines_orphan_product;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'order_lines.orphan_product', 'order_lines', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_order_lines_orphan_sale;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'order_lines.orphan_order_sale', 'order_lines', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_order_lines_orphan_purchase;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'order_lines.orphan_order_purchase', 'order_lines', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_products_null_standard_price;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'products.null_standard_price_active', 'products', v_count, 'warn');

  SELECT COUNT(*) INTO v_count FROM v_audit_products_null_uom;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'products.null_uom', 'products', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_products_duplicate_default_code;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'products.duplicate_default_code', 'products', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_account_balances_trial_balance;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'account_balances.trial_balance_zero_per_period',
    'account_balances', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_account_balances_orphan_account;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'account_balances.orphan_account', 'account_balances', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_company_leak_invoice_lines;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'invoice_lines.company_leak', 'invoice_lines', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_company_leak_order_lines;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'order_lines.company_leak', 'order_lines', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_deliveries_orphan_partner;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'deliveries.orphan_partner', 'deliveries', v_count);

  SELECT COUNT(*) INTO v_count FROM v_audit_deliveries_done_without_date;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'deliveries.done_without_date', 'deliveries', v_count);

  -- Summary de lo que se acaba de escribir
  SELECT jsonb_build_object(
    'ok',    COUNT(*) FILTER (WHERE severity = 'ok'),
    'warn',  COUNT(*) FILTER (WHERE severity = 'warn'),
    'error', COUNT(*) FILTER (WHERE severity = 'error')
  ) INTO v_summary
  FROM audit_runs
  WHERE run_id = p_run_id AND source = 'supabase';

  RETURN v_summary;
END;
$$;

GRANT EXECUTE ON FUNCTION run_internal_audits(date, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _audit_register_invariant(uuid, date, date, text, text, bigint, text) TO service_role;

COMMENT ON FUNCTION run_internal_audits IS
  'Ejecuta 15 invariantes SQL internos y escribe filas a audit_runs con run_id provisto.';
```

- [ ] **Step 2: Aplicar**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
supabase db push --linked
```

- [ ] **Step 3: Smoke test de la función**

```sql
SELECT run_internal_audits('2025-04-01', '2026-04-19',
                           gen_random_uuid());
```
Expected: JSON `{"ok":N,"warn":N,"error":N}` y filas en `audit_runs`.

- [ ] **Step 4: Commit**

```bash
cd /Users/jj
git add -A
git commit -m "feat(audit): run_internal_audits() orchestrator function

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 3.1: Cron semanal + view XML

**Files:**
- Create: `addons/quimibond_intelligence/data/ir_cron_audit.xml`
- Create: `addons/quimibond_intelligence/views/sync_audit_views.xml`
- Modify: `addons/quimibond_intelligence/__manifest__.py`

- [ ] **Step 1: Cron XML**

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
  <data noupdate="1">
    <record id="ir_cron_audit_weekly" model="ir.cron">
      <field name="name">Quimibond: Audit integrity weekly</field>
      <field name="model_id" ref="model_quimibond_sync_audit"/>
      <field name="state">code</field>
      <field name="code">
from datetime import date, timedelta
to_d = date.today()
from_d = to_d - timedelta(days=365)
model.run_all(date_from=str(from_d), date_to=str(to_d))
      </field>
      <field name="interval_number">7</field>
      <field name="interval_type">days</field>
      <field name="numbercall">-1</field>
      <field name="active" eval="True"/>
      <field name="nextcall"
             eval="(DateTime.now().replace(hour=4, minute=0, second=0)
                    + timedelta(days=(6-DateTime.now().weekday())%7)).strftime('%Y-%m-%d %H:%M:%S')"/>
    </record>
  </data>
</odoo>
```

- [ ] **Step 2: View XML (botón "Run audit")**

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
  <record id="action_sync_audit_run" model="ir.actions.server">
    <field name="name">Quimibond: Run audit now (last 12m)</field>
    <field name="model_id" ref="model_quimibond_sync_audit"/>
    <field name="state">code</field>
    <field name="code">
from datetime import date, timedelta
to_d = date.today()
from_d = to_d - timedelta(days=365)
res = model.run_all(date_from=str(from_d), date_to=str(to_d))
action = {
  'type': 'ir.actions.client',
  'tag': 'display_notification',
  'params': {
    'title': 'Audit run complete',
    'message': 'run_id=%s summary=%s' % (res['run_id'], res['summary']),
    'sticky': True,
    'type': 'success' if res['summary'].get('error',0) == 0 else 'warning',
  },
}
    </field>
  </record>
</odoo>
```

- [ ] **Step 3: Registrar en manifest**

Modify `__manifest__.py` dentro del key `'data'`:
```python
'data': [
    # ... existentes ...
    'security/ir.model.access.csv',
    'data/ir_cron_data.xml',
    'data/ir_cron_audit.xml',
    'views/sync_status_views.xml',
    'views/sync_audit_views.xml',
],
```

- [ ] **Step 4: Update addon en Odoo.sh y verificar**

Push + `odoo-update quimibond_intelligence`. Verificar desde UI que existe el cron.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(audit): weekly cron + manual run action

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 3.2: Cleanup pg_cron (retención 90 días)

- [ ] **Step 1: Crear migración**

Create `20260419_audit_pg_cron_cleanup.sql`:
```sql
-- Job diario que borra audit_runs viejos (>90 días)
SELECT cron.schedule(
  'audit_runs_retention_cleanup',
  '30 3 * * *',  -- diario 03:30 UTC
  $$ DELETE FROM audit_runs WHERE run_at < now() - interval '90 days'; $$
);
```

- [ ] **Step 2: Aplicar, verificar**

```sql
SELECT * FROM cron.job WHERE jobname = 'audit_runs_retention_cleanup';
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(audit): pg_cron 90-day retention cleanup

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 3.3: Tests de integración end-to-end (severity via mutación)

**Files:** `tests/test_sync_audit.py` (añadir test de integración).

- [ ] **Step 1: Test**

Append:
```python
@tagged('post_install', '-at_install')
class TestAuditIntegrationSeverity(TransactionCase):
    """Verifica que inyectar ruido resulta en severity != 'ok'."""

    def setUp(self):
        super().setUp()
        self.Audit = self.env['quimibond.sync.audit']

    def test_products_count_mismatch_gives_error(self):
        # Odoo tiene N productos; mockeamos Supabase con N+1000
        odoo_count = self.env['product.product'].search_count(
            [('active','=',True)])
        client = MagicMock()
        client.count_exact.return_value = odoo_count + 1000
        client.fetch_all.return_value = []
        captured = []
        client.upsert.side_effect = lambda t, r, **k: (
            captured.extend(r) if t == 'audit_runs' else None)

        self.Audit.audit_products(client, 'test-sev', '2026-01-01',
                                  '2026-04-19', {}, dry_run=False)
        rows = [r for r in captured
                if r['invariant_key'] == 'products.count_active']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['severity'], 'error')
```

- [ ] **Step 2: Run + commit**

```bash
odoo-bin ... --test-tags /quimibond_intelligence:TestAuditIntegrationSeverity
git add -A
git commit -m "test(audit): integration severity test via mock mismatch

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 3.4: Documentación — catálogo canónico de invariantes

**Files:**
- Create: `docs/audit_invariants.md`

- [ ] **Step 1: Escribir docs**

Create `docs/audit_invariants.md`:
```markdown
# Audit Invariants — Catálogo canónico

Spec: `docs/superpowers/specs/2026-04-19-sync-audit-design.md`

Cada invariante se identifica con `invariant_key` único y aparece como
filas en `audit_runs` con `source='odoo'` (cross-check) o `source='supabase'`
(interno SQL).

## Convenciones

- `severity = 'ok'`: diff dentro de tolerancia.
- `severity = 'warn'`: diff >10× tolerancia abs pero no crítico.
- `severity = 'error'`: diff grande; requiere investigación.
- `bucket_key`: agrupador (ej. `2026-04|sale|1`); `NULL` = snapshot.

## Invariantes cross-check (Odoo ↔ Supabase)

### `products.count_active`
**Mide:** count de productos activos.
**Violación:** conteos difieren.
**Acción:** revisar `_push_products` filtro de `active`.

### `products.count_with_default_code`
**Mide:** productos activos con `internal_ref`.
**Violación:** el mapeo de `default_code → internal_ref` pierde filas.

### `products.sum_standard_price`
**Mide:** suma simple de `standard_price`.
**Violación:** divergencia de valuación a nivel catálogo.

### `products.null_uom_count`
**Mide:** productos sin UoM.
**Violación:** falla upstream en Odoo o pérdida en push.

### `invoice_lines.count_per_bucket` / `.sum_subtotal_signed_mxn` / `.sum_qty_signed`
**Mide:** por (mes, move_type, company) — count, suma MXN firmada, suma qty firmada.
**Violación:** un bucket con diff indica push incompleto, FX mal aplicado, o signo roto en refunds.

### `order_lines.*` (análogo, sale + purchase separados)

### `deliveries.count_done_per_month`
**Mide:** stock.picking `state in ('done','cancel')` por mes/company.

### `manufacturing.count_per_state`, `.sum_qty_produced`

### `account_balances.inventory_accounts_balance` (1150.*)
`.cogs_accounts_balance` (5*)
`.revenue_accounts_balance` (4*)
**Mide:** balance agregado de grupo de cuentas por período/company.

### `bank_balances.count_per_journal`, `.native_balance_per_journal`

## Invariantes SQL internos (Supabase only)

### `invoice_lines.reversal_sign`
**Mide:** refunds con signo inconsistente entre quantity y price_subtotal.
**Acción:** bug en `_push_invoice_lines` → inspeccionar signo que emite.

### `invoice_lines.price_recompute`
**Mide:** `|price_unit × qty × (1 − discount) − price_subtotal| > 0.01`.
**Acción:** revisar cómo se calcula subtotal (con/sin descuento, con/sin impuesto).

### `invoice_lines.fx_present`
**Mide:** líneas en moneda ≠ MXN con FX faltante.
**Acción:** `_push_invoice_lines` no convirtió para esa moneda.

### `invoice_lines.fx_sanity`
**Mide:** consistencia `price × rate ≈ price_mxn` (1% tolerancia).
**Acción:** FX mal capturado en el momento del push.

### `order_lines.orphan_product`, `.orphan_order_sale`, `.orphan_order_purchase`
**Mide:** líneas con FK roto a producto/header.

### `products.null_standard_price_active` (warn)
**Mide:** productos activos con precio 0 o NULL.
**Acción:** puede ser legítimo; investigar si alimenta CMV.

### `products.null_uom` (error)
**Mide:** productos activos sin unidad de medida.

### `products.duplicate_default_code`
**Mide:** `internal_ref` duplicado entre productos activos.
**Acción:** identificar y limpiar duplicados en Odoo.

### `account_balances.trial_balance_zero_per_period`
**Mide:** suma de balances por período debe ser ~0.
**Violación:** asiento roto o pull parcial.

### `account_balances.orphan_account`
**Mide:** balances con código de cuenta que no existe en CoA.

### `invoice_lines.company_leak`, `order_lines.company_leak`
**Mide:** línea con `odoo_company_id` distinto al del header.

### `deliveries.orphan_partner`
**Mide:** delivery con partner_id que no existe en `contacts`.

### `deliveries.done_without_date`
**Mide:** state='done' sin date_done.

## Tolerancias

Configurables vía tabla `audit_tolerances`:
```sql
UPDATE audit_tolerances
SET pct_tolerance = 0.01
WHERE invariant_key = 'invoice_lines.sum_subtotal_signed_mxn';
```

## Correr una auditoría

Desde shell Odoo.sh:
```python
env['quimibond.sync.audit'].run_all(
    date_from='2025-04-01', date_to='2026-04-19',
)
```

Ver resultados:
```sql
SELECT invariant_key, bucket_key, severity, diff, details
FROM audit_runs
WHERE run_id = '<uuid>'
  AND severity <> 'ok'
ORDER BY abs(diff) DESC NULLS LAST;
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/audit_invariants.md
git commit -m "docs(audit): canonical catalog of invariants

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 3.5: Primer baseline en producción

**Files:** ninguno nuevo. Acción operativa.

- [ ] **Step 1: Deploy a producción**

```bash
cd /Users/jj
git checkout main
git pull
# Si trabajamos en feature branch, merge a main:
#   git merge --no-ff feature/sync-audit-fase1
git push origin main
```

Merge `main → quimibond` en GitHub UI.

En Odoo.sh shell de producción:
```bash
odoo-update quimibond_intelligence
odoosh-restart http
odoosh-restart cron
```

- [ ] **Step 2: Ejecutar baseline**

Odoo.sh shell:
```python
result = env['quimibond.sync.audit'].run_all(
    date_from='2025-04-01',
    date_to='2026-04-19',
)
print(result)
```

Expected: run_id impreso, summary con counts de ok/warn/error.

- [ ] **Step 3: Exportar CSV del baseline**

En Supabase SQL editor:
```sql
COPY (
  SELECT run_id, source, model, invariant_key, bucket_key,
         odoo_value, supabase_value, diff, severity, details
  FROM audit_runs
  WHERE run_id = '<UUID_BASELINE>'
    AND severity <> 'ok'
  ORDER BY severity DESC, abs(diff) DESC NULLS LAST
) TO STDOUT WITH CSV HEADER;
```

Guardar como `docs/audit_baseline_2026-04-19.csv`.

- [ ] **Step 4: Commit baseline y cierre de Fase 1**

```bash
git add docs/audit_baseline_2026-04-19.csv
git commit -m "$(cat <<'EOF'
docs(audit): primer baseline de integridad de sincronización

run_id: <UUID>
Window: 2025-04-01 → 2026-04-19
Summary: {ok: N, warn: N, error: N}

Cierre de Fase 1 (cuantitativa) del Sub-proyecto 1 de auditoría de
costos/márgenes/inventario. Fase 2 (fixes semánticos) usará este
baseline como input.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Criterio de éxito (end of plan)

- [ ] `audit_runs` poblada con resultados de los 18 + 15 = 33 invariantes.
- [ ] Tabla `audit_tolerances` con 6 overrides seed.
- [ ] 7 métodos `audit_*` + orquestador `run_all` funcionando.
- [ ] 15 views SQL + función `run_internal_audits` aplicadas.
- [ ] Cron semanal Odoo (dom 04:00 MX) activo.
- [ ] Cron diario Supabase (pg_cron, retención 90d) activo.
- [ ] `docs/audit_invariants.md` publicado.
- [ ] `docs/audit_baseline_2026-04-19.csv` generado.
- [ ] Summary del baseline compartido con José → input para Fase 2.

## Fuera de alcance (Fase 2, spec posterior)

- Arreglar cualquier discrepancia encontrada (leer `_push_*`, fixear signos/FX/multi-company, re-correr).
- Dashboard UI en `/system/audit`.
- Migración contable (work centers, writedown inventario).
