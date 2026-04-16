import { Suspense } from "react";
import {
  ExternalLink,
  Github,
  Info,
  LifeBuoy,
  LogOut,
  Moon,
  Palette,
  Rows2,
  Sparkles,
  Sun,
} from "lucide-react";

import { PageHeader } from "@/components/shared/v2";
import { TableDensityToggle } from "@/components/shared/v2/table-density-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import { ThemePreference } from "./_components/theme-preference";
import { getSystemKpis } from "@/lib/queries/system";

export const dynamic = "force-dynamic";
export const metadata = { title: "Perfil" };

export default function ProfilePage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Perfil"
        subtitle="Preferencias, tema, información del sistema y cerrar sesión"
      />

      {/* Usuario */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cuenta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-4">
          <div className="flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
              JM
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">Jose Mizrahi</div>
              <div className="text-xs text-muted-foreground">
                CEO · Quimibond
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge variant="info" className="text-[10px]">
                  Admin
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  Dirección
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tema */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="size-4" />
            Apariencia
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Elige entre claro, oscuro o sincronizar con el sistema operativo.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <ThemePreference />
        </CardContent>
      </Card>

      {/* Densidad de tablas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rows2 className="size-4" />
            Densidad de tablas
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Compacta las filas para ver más datos sin scroll. Aplica a todas las
            tablas del sistema.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <TableDensityToggle />
        </CardContent>
      </Card>

      {/* Sistema */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="size-4" />
            Sistema
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <Suspense fallback={<Skeleton className="h-28 rounded-lg" />}>
            <SystemInfo />
          </Suspense>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/system">
                <Sparkles className="size-3.5" />
                Abrir panel del sistema
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://github.com/quimibond/quimibond-intelligence"
                target="_blank"
                rel="noreferrer"
              >
                <Github className="size-3.5" />
                Repositorio
                <ExternalLink className="size-3" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Ayuda */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LifeBuoy className="size-4" />
            Ayuda rápida
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pb-4 text-sm">
          <HelpLine
            title="¿Cómo funciona el chat con IA?"
            description="Habla con el CFO IA en /chat. Menciona @finanzas, @ventas, @compras, etc. para consultar a directores específicos."
          />
          <Separator />
          <HelpLine
            title="¿Qué son los insights?"
            description="Los agentes corren cada 15 min y generan alertas accionables con confianza ≥ 80%. Revísalos en el inbox."
          />
          <Separator />
          <HelpLine
            title="¿Cómo exporto una tabla?"
            description="Cada tabla tiene un botón de Exportar CSV en su header. El archivo incluye todas las columnas visibles."
          />
          <Separator />
          <HelpLine
            title="¿Cómo oculto columnas?"
            description="En cualquier tabla, usa el botón Columnas para mostrar/ocultar campos. La preferencia se guarda en el URL."
          />
        </CardContent>
      </Card>

      {/* Cerrar sesión */}
      <Card className="border-danger/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-danger">
            <LogOut className="size-4" />
            Cerrar sesión
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Cierra tu sesión en este dispositivo. Tendrás que volver a ingresar
            la contraseña.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <form action="/api/auth/logout" method="GET">
            <Button type="submit" variant="destructive" className="gap-2">
              <LogOut className="size-4" />
              Cerrar sesión
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function HelpLine({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <div className="font-medium">{title}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

async function SystemInfo() {
  try {
    const k = await getSystemKpis();
    return (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <InfoItem
          label="Tablas sincronizadas"
          value={
            <span className={k.syncStaleCount > 0 ? "text-warning" : "text-success"}>
              {k.syncTablesTotal - k.syncStaleCount}/{k.syncTablesTotal}
            </span>
          }
        />
        <InfoItem
          label="Sync stale"
          value={
            <span className={k.syncStaleCount > 0 ? "text-warning" : "text-success"}>
              {k.syncStaleCount}
            </span>
          }
        />
        <InfoItem
          label="Costo Claude 30d"
          value={new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2,
          }).format(k.cost30dUsd)}
        />
        <InfoItem label="Llamadas Claude" value={k.callsTotal.toLocaleString("es-MX")} />
        <InfoItem label="Agent runs 24h" value={k.agentRunsLast24h} />
        <InfoItem
          label="Problemas críticos"
          value={
            <span className={k.qualityIssuesCritical > 0 ? "text-danger" : "text-success"}>
              {k.qualityIssuesCritical}
            </span>
          }
        />
      </dl>
    );
  } catch {
    return (
      <p className="text-xs text-muted-foreground">
        No se pudo cargar la información del sistema.
      </p>
    );
  }
}

function InfoItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

// Suppress unused import warning — these icons are documented for future use
void Moon;
void Sun;
