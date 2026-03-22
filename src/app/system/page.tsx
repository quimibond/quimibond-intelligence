"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import { Activity, Database, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SyncState {
  account: string;
  last_history_id: string;
  emails_synced: number;
  updated_at: string;
}

interface TableCount {
  name: string;
  count: number;
}

const TABLE_NAMES = [
  "emails", "threads", "contacts", "alerts", "action_items",
  "briefings", "facts", "entities", "entity_relationships",
  "topics", "person_profiles", "communication_patterns", "system_learning",
];

async function loadSystemData() {
  const countPromises = TABLE_NAMES.map((name) =>
    supabase.from(name).select("id", { count: "exact", head: true })
  );
  const [syncRes, ...countResults] = await Promise.all([
    supabase.from("sync_state").select("*").order("account"),
    ...countPromises,
  ]);
  return {
    syncStates: (syncRes.data || []) as SyncState[],
    counts: TABLE_NAMES.map((name, i) => ({
      name,
      count: countResults[i].count ?? 0,
    })),
  };
}

export default function SystemPage() {
  const [syncStates, setSyncStates] = useState<SyncState[]>([]);
  const [counts, setCounts] = useState<TableCount[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const data = await loadSystemData();
    setSyncStates(data.syncStates);
    setCounts(data.counts);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    loadSystemData().then((data) => {
      if (!cancelled) {
        setSyncStates(data.syncStates);
        setCounts(data.counts);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sistema</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Estado de sincronizacion y estadisticas de la base de datos</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-2 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Sync State */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" /> Sincronizacion
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="animate-pulse text-sm text-[var(--muted-foreground)]">Cargando...</div>
          ) : syncStates.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No hay cuentas sincronizadas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                    <th className="pb-2 pr-4">Cuenta</th>
                    <th className="pb-2 pr-4">Emails sincronizados</th>
                    <th className="pb-2 pr-4">Last History ID</th>
                    <th className="pb-2">Ultima actualizacion</th>
                  </tr>
                </thead>
                <tbody>
                  {syncStates.map((ss) => (
                    <tr key={ss.account} className="border-b border-[var(--border)]/50">
                      <td className="py-2 pr-4 font-medium">{ss.account}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="info">{ss.emails_synced.toLocaleString()}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-[var(--muted-foreground)] font-mono text-xs">
                        {ss.last_history_id || "—"}
                      </td>
                      <td className="py-2 text-[var(--muted-foreground)]">
                        {ss.updated_at ? timeAgo(ss.updated_at) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DB Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" /> Base de datos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="animate-pulse text-sm text-[var(--muted-foreground)]">Cargando...</div>
          ) : (
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-5 lg:grid-cols-7">
              {counts.map((t) => (
                <div key={t.name} className="text-center">
                  <p className="text-lg font-bold">{t.count.toLocaleString()}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{t.name}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Config */}
      <Card>
        <CardHeader>
          <CardTitle>Configuracion</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted-foreground)]">Supabase URL</dt>
              <dd className="truncate">{process.env.NEXT_PUBLIC_SUPABASE_URL || "No configurado"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Supabase Key</dt>
              <dd>{process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "Configurado" : "No configurado"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
