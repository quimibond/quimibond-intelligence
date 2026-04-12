"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select-native";
import { BookOpen, Plus, Save, X, AlertTriangle, CheckCircle2, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface BudgetRow {
  id?: number;
  account_code: string;
  account_name: string | null;
  period: string;
  budget_amount: number;
  notes?: string | null;
}

interface BudgetVsActualRow {
  period: string;
  account_code: string;
  account_name: string | null;
  account_type: string;
  presupuesto: number;
  real: number;
  desviacion: number;
  desviacion_pct: number | null;
  status: string;
  notes: string | null;
}

interface ChartOfAccount {
  odoo_account_id: number;
  code: string;
  name: string;
  account_type: string;
}

function getCurrentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getPeriodOptions(): string[] {
  const now = new Date();
  const options: string[] = [];
  for (let i = -6; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return options;
}

export default function BudgetsPage() {
  const [rows, setRows] = useState<BudgetVsActualRow[]>([]);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [period, setPeriod] = useState(getCurrentPeriod());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BudgetRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bvaRes, chartRes] = await Promise.all([
        supabase
          .from("budget_vs_actual")
          .select("*")
          .eq("period", period)
          .order("desviacion", { ascending: false }),
        supabase
          .from("odoo_chart_of_accounts")
          .select("odoo_account_id, code, name, account_type")
          .in("account_type", ["expense", "income", "cost_of_revenue"])
          .order("code"),
      ]);
      setRows((bvaRes.data ?? []) as BudgetVsActualRow[]);
      setAccounts((chartRes.data ?? []) as ChartOfAccount[]);
    } catch (err) {
      console.error("[budgets]", err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (b: BudgetRow) => {
    setSaving(true);
    try {
      if (b.id) {
        await supabase.from("budgets")
          .update({ budget_amount: b.budget_amount, notes: b.notes, updated_at: new Date().toISOString() })
          .eq("id", b.id);
      } else {
        await supabase.from("budgets").insert({
          account_code: b.account_code,
          account_name: b.account_name,
          period: b.period,
          budget_amount: b.budget_amount,
          notes: b.notes,
        });
      }
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (err) {
      console.error("[budgets] save", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Eliminar este presupuesto?")) return;
    await supabase.from("budgets").delete().eq("id", id);
    await load();
  };

  // Summary stats
  const summary = useMemo(() => {
    const total_budget = rows.reduce((s, r) => s + Number(r.presupuesto || 0), 0);
    const total_real = rows.reduce((s, r) => s + Number(r.real || 0), 0);
    const exceso = rows.filter(r => r.status === "EXCESO >10%").length;
    const subejercido = rows.filter(r => r.status === "SUBEJERCIDO <50%").length;
    return { total_budget, total_real, exceso, subejercido };
  }, [rows]);

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Presupuestos" description="Budget vs actual por cuenta contable" />
        <LoadingGrid rows={5} rowHeight="h-16" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Presupuestos" description="Budget vs actual por cuenta contable" />

      {/* Period + action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="w-auto"
        >
          {getPeriodOptions().map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Select>
        <Button size="sm" onClick={() => { setEditing({ account_code: "", account_name: "", period, budget_amount: 0 }); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-1" />
          Nuevo presupuesto
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Presupuesto</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{formatCurrency(summary.total_budget)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Real</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{formatCurrency(summary.total_real)}</p>
          </CardContent>
        </Card>
        <Card className={cn(summary.exceso > 0 && "border-danger/40")}>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-danger" />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Exceso &gt;10%</p>
            </div>
            <p className={cn("mt-1 text-xl font-bold tabular-nums", summary.exceso > 0 && "text-danger")}>
              {summary.exceso}
            </p>
          </CardContent>
        </Card>
        <Card className={cn(summary.subejercido > 0 && "border-warning/40")}>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5">
              <TrendingDown className="h-3.5 w-3.5 text-warning" />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Subejercido</p>
            </div>
            <p className={cn("mt-1 text-xl font-bold tabular-nums", summary.subejercido > 0 && "text-warning")}>
              {summary.subejercido}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Edit form */}
      {showForm && editing && (
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {editing.id ? "Editar presupuesto" : "Nuevo presupuesto"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Cuenta contable</label>
                <Select
                  value={editing.account_code}
                  onChange={(e) => {
                    const acct = accounts.find(a => a.code === e.target.value);
                    setEditing({ ...editing, account_code: e.target.value, account_name: acct?.name ?? "" });
                  }}
                  disabled={!!editing.id}
                >
                  <option value="">Seleccionar cuenta...</option>
                  {accounts.map(a => (
                    <option key={a.odoo_account_id} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Monto presupuestado (MXN)</label>
                <input
                  type="number"
                  value={editing.budget_amount}
                  onChange={(e) => setEditing({ ...editing, budget_amount: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm tabular-nums"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Notas (opcional)</label>
              <textarea
                value={editing.notes ?? ""}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                rows={2}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setEditing(null); }}>
                <X className="h-4 w-4 mr-1" /> Cancelar
              </Button>
              <Button size="sm" onClick={() => handleSave(editing)} disabled={saving || !editing.account_code || editing.budget_amount <= 0}>
                <Save className="h-4 w-4 mr-1" /> Guardar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Budget vs Actual table */}
      {rows.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Sin presupuestos"
          description={`No hay presupuestos cargados para ${period}. Crea uno con el boton de arriba.`}
        />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Detalle por cuenta</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-1.5">
              {rows.map((row) => {
                const pct = row.desviacion_pct ?? 0;
                const statusColor = row.status === "EXCESO >10%" ? "text-danger bg-danger/10"
                  : row.status === "SUBEJERCIDO <50%" ? "text-warning bg-warning/10"
                  : "text-success bg-success/10";
                const statusIcon = row.status === "EXCESO >10%" ? AlertTriangle
                  : row.status === "SUBEJERCIDO <50%" ? TrendingDown
                  : CheckCircle2;
                const StatusIcon = statusIcon;

                return (
                  <div key={`${row.account_code}-${row.period}`}
                    className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
                    <div className={cn("rounded-md p-1.5", statusColor)}>
                      <StatusIcon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{row.account_code}</span>
                        <span className="truncate text-xs text-muted-foreground">{row.account_name}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                        <span>Pres: {formatCurrency(row.presupuesto)}</span>
                        <span>Real: {formatCurrency(row.real)}</span>
                        {row.notes && <span className="italic truncate">{row.notes}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn("text-sm font-bold tabular-nums",
                        Math.abs(pct) > 10 ? "text-danger" : "text-muted-foreground"
                      )}>
                        {pct > 0 ? "+" : ""}{pct?.toFixed(1)}%
                      </p>
                      <p className="text-[10px] tabular-nums text-muted-foreground">
                        {formatCurrency(row.desviacion)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
