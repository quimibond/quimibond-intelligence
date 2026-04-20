import { getServiceClient } from "@/lib/supabase-server";

export interface SyntageFileRow {
  id: number;
  syntage_id: string | null;
  taxpayer_rfc: string | null;
  file_type: string | null;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  created_at: string | null;
}

export interface SyntageFilesSummary {
  total: number;
  with_storage: number;
  without_storage: number;
  by_type: Array<{ file_type: string; count: number }>;
  most_recent: string | null;
}

export async function getSyntageFilesSummary(): Promise<SyntageFilesSummary> {
  const sb = getServiceClient();

  const [totalQ, storageQ, recentQ, typesQ] = await Promise.all([
    sb.from("syntage_files").select("*", { count: "exact", head: true }),
    sb
      .from("syntage_files")
      .select("*", { count: "exact", head: true })
      .not("storage_path", "is", null),
    sb
      .from("syntage_files")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1), // intentional: most recent file timestamp
    sb.from("syntage_files").select("file_type").limit(5000), // intentional: enumerate all types for distinct count
  ]);

  if (totalQ.error)
    throw new Error(`syntage_files total failed: ${totalQ.error.message}`);
  if (storageQ.error)
    throw new Error(`syntage_files storage failed: ${storageQ.error.message}`);

  const total = totalQ.count ?? 0;
  const with_storage = storageQ.count ?? 0;

  const typeMap = new Map<string, number>();
  for (const r of (typesQ.data ?? []) as Array<{ file_type: string | null }>) {
    const t = r.file_type ?? "(null)";
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
  }

  return {
    total,
    with_storage,
    without_storage: total - with_storage,
    by_type: Array.from(typeMap.entries())
      .map(([file_type, count]) => ({ file_type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    most_recent: (recentQ.data ?? [])[0]?.created_at ?? null,
  };
}

export async function getSyntageFilesRecent(
  limit = 30
): Promise<SyntageFileRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("syntage_files")
    .select(
      "id, syntage_id, taxpayer_rfc, file_type, filename, mime_type, size_bytes, storage_path, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error)
    throw new Error(`syntage_files recent failed: ${error.message}`);
  return (data ?? []) as unknown as SyntageFileRow[];
}
