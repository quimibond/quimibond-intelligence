import { Suspense } from "react";
import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/patterns";
import {
  getSyntageFilesSummary,
  getSyntageFilesRecent,
} from "@/lib/queries/fiscal/syntage-files";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function Summary() {
  const s = await getSyntageFilesSummary();
  if (s.total === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Sin archivos registrados"
        description="syntage_files está vacío."
        compact
      />
    );
  }
  const storagePct =
    s.total > 0 ? Math.round((s.with_storage / s.total) * 100) : 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Total archivos
          </div>
          <div className="text-xl font-semibold">
            {s.total.toLocaleString("es-MX")}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Descargados
          </div>
          <div className="text-xl font-semibold">
            {s.with_storage.toLocaleString("es-MX")}
          </div>
          <div className="text-xs text-muted-foreground">
            {storagePct}% del total
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Sin descargar
          </div>
          <div className="text-xl font-semibold">
            {s.without_storage.toLocaleString("es-MX")}
          </div>
          <div className="text-xs text-muted-foreground">
            Metadata registrada, binario pendiente
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Tipos distintos
          </div>
          <div className="text-xl font-semibold">{s.by_type.length}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {s.by_type.slice(0, 3).map((t) => (
              <Badge key={t.file_type} variant="secondary" className="text-[10px]">
                {t.file_type.split(".").pop()}: {t.count.toLocaleString("es-MX")}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

async function TypesBreakdown() {
  const s = await getSyntageFilesSummary();
  if (s.by_type.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
        Distribución por tipo
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo</TableHead>
            <TableHead className="text-right">Archivos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {s.by_type.map((t) => (
            <TableRow key={t.file_type}>
              <TableCell className="font-mono text-xs">{t.file_type}</TableCell>
              <TableCell className="text-right">
                {t.count.toLocaleString("es-MX")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

async function RecentFiles() {
  const rows = await getSyntageFilesRecent(20);
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
        Últimos 20 archivos
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>RFC</TableHead>
            <TableHead>Archivo</TableHead>
            <TableHead>Tamaño</TableHead>
            <TableHead>Storage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs text-muted-foreground">
                {r.created_at
                  ? new Date(r.created_at).toLocaleDateString("es-MX")
                  : "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {r.file_type ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {r.taxpayer_rfc ?? "—"}
              </TableCell>
              <TableCell className="max-w-[200px] truncate font-mono text-xs text-muted-foreground">
                {r.filename ?? "—"}
              </TableCell>
              <TableCell className="text-xs">{formatBytes(r.size_bytes)}</TableCell>
              <TableCell className="text-xs">
                {r.storage_path ? (
                  <Badge variant="default" className="text-[10px]">
                    descargado
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    pendiente
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SyntageFilesPanel() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">
          Metadata de XMLs/PDFs registrados por Syntage (source:{" "}
          <span className="font-mono">syntage_files</span>). El download a
          Supabase Storage es parte de Fase 4 — si un archivo muestra
          &ldquo;pendiente&rdquo;, el binario no se ha bajado aún.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[120px]" />}>
        <Summary />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-[300px]" />}>
        <TypesBreakdown />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-[300px]" />}>
        <RecentFiles />
      </Suspense>
    </div>
  );
}
