"use client";

import { useEffect, useState } from "react";
import {
  Mail,
  Users,
  Bell,
  Brain,
  RefreshCw,
  Server,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDateTime, timeAgo } from "@/lib/utils";
import type { SyncState } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SystemStats {
  totalEmails: number;
  totalContacts: number;
  activeAlerts: number;
  totalEntities: number;
}

export default function SystemPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [syncStates, setSyncStates] = useState<SyncState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const [emailsRes, contactsRes, alertsRes, entitiesRes, syncRes] =
        await Promise.all([
          supabase.from("emails").select("id", { count: "exact", head: true }),
          supabase
            .from("contacts")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("alerts")
            .select("id", { count: "exact", head: true })
            .eq("state", "new"),
          supabase
            .from("entities")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("sync_state")
            .select("*")
            .order("last_sync_at", { ascending: false }),
        ]);

      setStats({
        totalEmails: emailsRes.count ?? 0,
        totalContacts: contactsRes.count ?? 0,
        activeAlerts: alertsRes.count ?? 0,
        totalEntities: entitiesRes.count ?? 0,
      });

      setSyncStates((syncRes.data ?? []) as SyncState[]);
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Sistema"
          description="Estado del sistema y sincronizacion"
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] w-full" />
          ))}
        </div>
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sistema"
        description="Estado del sistema y sincronizacion"
      />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total emails"
          value={stats?.totalEmails.toLocaleString() ?? "0"}
          icon={Mail}
          description="Emails sincronizados"
        />
        <StatCard
          title="Total contactos"
          value={stats?.totalContacts.toLocaleString() ?? "0"}
          icon={Users}
          description="Contactos identificados"
        />
        <StatCard
          title="Alertas activas"
          value={stats?.activeAlerts.toLocaleString() ?? "0"}
          icon={Bell}
          description="Estado: new"
        />
        <StatCard
          title="Entidades"
          value={stats?.totalEntities.toLocaleString() ?? "0"}
          icon={Brain}
          description="Knowledge graph"
        />
      </div>

      {/* Sync status */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <RefreshCw className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Estado de sincronizacion</CardTitle>
        </CardHeader>
        <CardContent>
          {syncStates.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Server className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No hay cuentas sincronizadas.
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cuenta</TableHead>
                    <TableHead>Emails sincronizados</TableHead>
                    <TableHead>History ID</TableHead>
                    <TableHead>Ultima actualizacion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncStates.map((sync) => (
                    <TableRow key={sync.account}>
                      <TableCell className="font-medium">
                        {sync.account}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {sync.emails_synced.toLocaleString()}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {sync.last_history_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span title={formatDateTime(sync.last_sync_at ?? sync.updated_at)}>
                          {timeAgo(sync.last_sync_at ?? sync.updated_at)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
