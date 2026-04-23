import { FileText, FileSpreadsheet, FileImage, File } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { cn } from "@/lib/utils";

type Attachment = Database["public"]["Tables"]["attachments"]["Row"];

function iconFor(mime?: string | null) {
  if (!mime) return File;
  if (mime.startsWith("image/")) return FileImage;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.endsWith("csv")) return FileSpreadsheet;
  if (mime.includes("pdf") || mime.startsWith("text/")) return FileText;
  return File;
}

function formatSize(bytes?: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentsSectionProps {
  items: Attachment[];
  className?: string;
}

export function AttachmentsSection({ items, className }: AttachmentsSectionProps) {
  if (items.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        Sin archivos adjuntos.
      </div>
    );
  }

  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((a) => {
        const Icon = iconFor(a.mime_type);
        return (
          <li
            key={a.id}
            data-testid="attachment-item"
            className="flex items-center gap-3 rounded-md border bg-card p-3"
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {a.filename ?? "(archivo sin nombre)"}
              </div>
              <div className="text-xs text-muted-foreground">
                {a.mime_type ?? "unknown"} · {formatSize(a.size_bytes)}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
