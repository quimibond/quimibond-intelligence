"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Activity,
  ArrowUpFromLine,
  RefreshCw,
  Server,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function OdooSyncTrigger({ onComplete }: { onComplete: () => void }) {
  const [sending, setSending] = useState<string | null>(null);

  async function sendCommand(command: string, label: string) {
    setSending(command);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(label, { description: data.message });
        onComplete();
      } else {
        toast.error(label, { description: data.error });
      }
    } catch {
      toast.error(`${label}: Error de conexion`);
    } finally {
      setSending(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Server className="h-5 w-5 text-warning" />
        <CardTitle className="text-base">Sync Odoo ↔ Supabase</CardTitle>
        <span className="text-xs text-muted-foreground ml-2">
          Odoo ejecuta cada 5min (pull) y 1h (push)
        </span>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => sendCommand("force_push", "Push Odoo → Supabase")}
            disabled={sending !== null}
            className="gap-2"
          >
            {sending === "force_push" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowUpFromLine className="h-4 w-4" />}
            Push Odoo → Supabase
          </Button>
          <Button
            variant="outline"
            onClick={() => sendCommand("sync_contacts", "Sync Contactos")}
            disabled={sending !== null}
            className="gap-2"
          >
            {sending === "sync_contacts" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            Sync Contactos
          </Button>
          <Link href="/system/sync">
            <Button variant="ghost" className="gap-2">
              <Activity className="h-4 w-4" />
              Ver historial completo
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
