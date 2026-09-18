/**
 * attachments-extract (Edge Function) — baja adjuntos pendientes de Gmail,
 * los deduplica por sha256 en el bucket `email-attachments` y extrae texto
 * (Excel/CSV con xlsx, Word con mammoth, PDF con unpdf, texto plano).
 *
 * Límite de 2 s de CPU por invocación: se parsea hasta BYTE_BUDGET bytes por
 * corrida (un xlsx de 1 MB ya consume ~1 s de CPU). Los adjuntos se reclaman
 * por lotes chicos con el RPC memoria_adjuntos_reclamar (attempts++ y
 * claimed_at ANTES de procesar, FOR UPDATE SKIP LOCKED), así:
 *   - pg_cron puede lanzar dos invocaciones por minuto sin que se pisen;
 *   - un archivo que agota la CPU no se reintenta para siempre: al tercer
 *     intento la fila queda `failed` (skip_reason cpu_limit).
 * Antes de reclamar, memoria_adjuntos_reusar_hermanos() copia sha/archivo/
 * texto a las copias del mismo correo en otros buzones (mismo Message-ID):
 * el mismo PDF llega a 3 buzones y solo se baja y parsea una vez.
 * Solo correos de 2026 (decisión CEO 2026-09-18; el filtro vive en el RPC).
 *
 * Modo prioritario: body { email_ids: [..] } o { gmail_message_ids: [..] }
 * reclama solo los adjuntos de esos correos (p.ej. la nómina de la semana
 * para la verificación). Se invoca las veces que haga falta hasta que
 * responda queued 0.
 */
import { Buffer } from "node:buffer";
import { serviceClient, authorizeCron, json, pipelineLog, readBody } from "../_shared/env.ts";
import { GmailClient, GmailApiError, loadServiceAccount, decodeBase64Url } from "../_shared/gmail.ts";

const BUCKET = "email-attachments";
const CLAIM = 8; // filas por reclamo: si la CPU nos mata, solo estas cargan un intento de más
const BYTE_BUDGET = 700_000; // bytes parseados por invocación antes de parar
const WALL_BUDGET_MS = 45_000; // el cron lanza otra corrida al minuto; no encimarse de más
const MAX_DOWNLOAD_BYTES = 3_000_000; // más grande ni se baja: decodificar 12 MB de base64 ya revienta la CPU
const MAX_TEXT_CHARS = 200_000;
const MAX_ATTEMPTS = 3;
const PDF_MAX_BYTES = 2 * 1024 * 1024;
const PDF_MAX_PAGES = 20;
const SHEET_MAX_BYTES = 2 * 1024 * 1024;

interface PendingRow {
  id: number;
  email_id: number;
  gmail_attachment_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  attempts: number;
  account: string;
  gmail_message_id: string;
}

type Kind = "pdf" | "sheet" | "docx" | "text" | "other";

function extOf(filename: string, mime: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]{1,6})$/);
  if (m) return m[1];
  if (mime === "application/pdf") return "pdf";
  if (/spreadsheetml/.test(mime)) return "xlsx";
  if (/ms-excel/.test(mime)) return "xls";
  if (/wordprocessingml/.test(mime)) return "docx";
  if (mime === "text/csv") return "csv";
  if (mime === "text/plain") return "txt";
  return "bin";
}

function kindOf(filename: string, mime: string): Kind {
  const ext = extOf(filename, mime);
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (["xlsx", "xls", "xlsm", "csv", "tsv"].includes(ext) || /spreadsheetml|ms-excel|text\/csv/.test(mime)) return "sheet";
  if (ext === "docx" || /wordprocessingml/.test(mime)) return "docx";
  if (["txt", "md", "json", "log"].includes(ext) || mime.startsWith("text/")) return "text";
  return "other";
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function extractText(kind: Kind, bytes: Uint8Array): Promise<string | null> {
  switch (kind) {
    case "pdf": {
      if (bytes.length > PDF_MAX_BYTES) return null;
      const { extractText: pdfText, getDocumentProxy } = await import("npm:unpdf@0.12.1");
      const pdf = await getDocumentProxy(bytes);
      const { text } = await pdfText(pdf, { mergePages: false });
      return (text as string[]).slice(0, PDF_MAX_PAGES).join("\n");
    }
    case "sheet": {
      if (bytes.length > SHEET_MAX_BYTES) return null;
      const XLSX = await import("npm:xlsx@0.18.5");
      const wb = XLSX.read(bytes, { type: "array" });
      const parts: string[] = [];
      for (const name of wb.SheetNames.slice(0, 10)) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
        if (csv.trim()) parts.push(`--- Hoja: ${name} ---\n${csv}`);
      }
      return parts.join("\n\n");
    }
    case "docx": {
      // Con `npm:` Deno carga la build de Node de mammoth, que espera `buffer`
      // (Buffer de Node), no `arrayBuffer` (build de navegador). Con
      // arrayBuffer fallaba el 100 % de los .docx: "Could not find file in options".
      const mammoth = await import("npm:mammoth@1.8.0");
      const r = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return r.value ?? "";
    }
    case "text":
      return new TextDecoder("utf-8").decode(bytes);
    default:
      return null;
  }
}

async function download(gmail: GmailClient, messageId: string, row: PendingRow): Promise<{ bytes: Uint8Array; attachmentId: string } | null> {
  const tryGet = async (id: string) => {
    const r = await gmail.attachmentGet(messageId, id);
    return r.data ? decodeBase64Url(r.data) : null;
  };
  if (row.gmail_attachment_id) {
    try {
      const bytes = await tryGet(row.gmail_attachment_id);
      if (bytes) return { bytes, attachmentId: row.gmail_attachment_id };
    } catch (err) {
      if (!(err instanceof GmailApiError) || (err.status !== 400 && err.status !== 404)) throw err;
    }
  }
  // attachmentId caducado: re-localizar por nombre + tamaño
  const msg = await gmail.messageGet(messageId);
  // deno-lint-ignore no-explicit-any
  const stack: any[] = [...(msg.payload?.parts ?? [])];
  while (stack.length) {
    const part = stack.pop();
    if (part.parts) stack.push(...part.parts);
    if (part.filename === row.filename && Number(part.body?.size ?? 0) === row.size_bytes && part.body?.attachmentId) {
      const bytes = await tryGet(part.body.attachmentId);
      if (bytes) return { bytes, attachmentId: part.body.attachmentId };
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const denied = await authorizeCron(req, supabase);
  if (denied) return denied;

  const sa = await loadServiceAccount(supabase);
  if (!sa) return json({ error: "GOOGLE_SERVICE_ACCOUNT_JSON no configurado" }, 503);

  // Modo prioritario: correos concretos en vez de la cola general.
  const body = await readBody(req);
  let emailIds: number[] | null = null;
  if (Array.isArray(body.email_ids) && body.email_ids.length) {
    emailIds = body.email_ids.map(Number).filter((n) => Number.isFinite(n));
  } else if (Array.isArray(body.gmail_message_ids) && body.gmail_message_ids.length) {
    const { data: ems } = await supabase.from("emails").select("id").in("gmail_message_id", body.gmail_message_ids.map(String));
    emailIds = ((ems ?? []) as { id: number }[]).map((e) => e.id);
    if (!emailIds.length) return json({ error: "ningún correo con esos gmail_message_ids" }, 404);
  }

  const started = Date.now();
  const stats = { done: 0, failed: 0, skipped: 0, reused: 0, hermanos: 0, bytes: 0, queued: 0, lotes: 0 };

  // Hermanos: lo que otro buzón ya bajó se hereda sin tocar Gmail.
  const { data: hermanos, error: hermErr } = await supabase.rpc("memoria_adjuntos_reusar_hermanos", { p_desde: "30 minutes" });
  if (hermErr) console.error("[attachments-extract] memoria_adjuntos_reusar_hermanos:", hermErr.message);
  stats.hermanos = Number(hermanos ?? 0);

  // Filas que agotaron intentos (la CPU mató la invocación a medio archivo): cerrarlas.
  const { data: exhaustedRows } = await supabase
    .from("email_attachments")
    .update({ extract_status: "failed", skip_reason: "cpu_limit", last_error: "agotó intentos (límite de CPU)", updated_at: new Date().toISOString() })
    .eq("extract_status", "pending")
    .gte("attempts", MAX_ATTEMPTS)
    .select("id");
  stats.failed += exhaustedRows?.length ?? 0;

  // Archivos enormes: se saltan sin bajarlos (el tamaño viene de Gmail al registrar el adjunto).
  await supabase
    .from("email_attachments")
    .update({ extract_status: "skipped", skip_reason: "too_large", updated_at: new Date().toISOString() })
    .eq("extract_status", "pending")
    .gt("size_bytes", MAX_DOWNLOAD_BYTES);

  const bucket = supabase.storage.from(BUCKET);
  const clients = new Map<string, GmailClient>();

  // Lotes chicos hasta agotar el presupuesto de bytes parseados o de tiempo.
  while (stats.bytes < BYTE_BUDGET && Date.now() - started < WALL_BUDGET_MS) {
    const { data: claimed, error } = await supabase.rpc("memoria_adjuntos_reclamar", { p_batch: CLAIM, p_max_bytes: MAX_DOWNLOAD_BYTES, p_max_attempts: MAX_ATTEMPTS, p_email_ids: emailIds });
    if (error) {
      if (!stats.lotes) return json({ error: error.message }, 500);
      console.error("[attachments-extract] memoria_adjuntos_reclamar:", error.message);
      break;
    }
    const rows = (claimed ?? []) as PendingRow[];
    if (!rows.length) break;
    stats.lotes++;
    stats.queued += rows.length;

    for (const row of rows) {
      const now = new Date().toISOString();
      const exhausted = row.attempts >= MAX_ATTEMPTS; // attempts ya viene incrementado por el reclamo
      try {
        let gmail = clients.get(row.account);
        if (!gmail) {
          gmail = new GmailClient(sa, row.account);
          clients.set(row.account, gmail);
        }
        const dl = await download(gmail, row.gmail_message_id, row);
        if (!dl) {
          await supabase
            .from("email_attachments")
            .update({ extract_status: "failed", last_error: "adjunto no encontrado en Gmail", updated_at: now })
            .eq("id", row.id);
          stats.failed++;
          continue;
        }
        const sha = await sha256Hex(dl.bytes);
        const path = `${sha}.${extOf(row.filename, row.mime_type)}`;
        const { data: twin } = await supabase
          .from("email_attachments")
          .select("storage_path, extracted_text, extract_status")
          .eq("sha256", sha)
          .not("storage_path", "is", null)
          .neq("id", row.id)
          .limit(1)
          .maybeSingle();

        let storagePath: string | undefined = twin?.storage_path ?? undefined;
        let text: string | null | undefined = twin?.extract_status === "done" ? (twin.extracted_text as string | null) : undefined;
        if (!storagePath) {
          // Gmail a veces reporta un tipo sin "/" (p.ej. "pdf"); Storage lo rechaza como Content-Type.
          const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(row.mime_type ?? "") ? row.mime_type : "application/octet-stream";
          const { error: upErr } = await bucket.upload(path, dl.bytes, { contentType, upsert: true });
          if (upErr) throw new Error(`storage: ${upErr.message}`);
          storagePath = path;
        } else {
          stats.reused++;
        }
        const kind = kindOf(row.filename, row.mime_type);
        if (text === undefined) {
          stats.bytes += dl.bytes.length; // solo el parseo cuesta CPU; el texto reutilizado no
          text = await extractText(kind, dl.bytes);
        }
        const tooLarge = (kind === "pdf" || kind === "sheet") && text === null;
        const noExtractor = kind === "other" || tooLarge;
        await supabase
          .from("email_attachments")
          .update({
            gmail_attachment_id: dl.attachmentId,
            sha256: sha,
            storage_path: storagePath,
            extracted_text: text ? text.slice(0, MAX_TEXT_CHARS) : null,
            extract_status: noExtractor ? "skipped" : "done",
            skip_reason: noExtractor ? (tooLarge ? `${kind}_too_large` : "no_extractor") : null,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (noExtractor) stats.skipped++;
        else stats.done++;
      } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        console.error(`[attachments-extract] ${row.filename} (email ${row.email_id}):`, message);
        await supabase
          .from("email_attachments")
          .update({ extract_status: exhausted ? "failed" : "pending", last_error: message, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        if (exhausted) stats.failed++;
      }
      if (stats.bytes >= BYTE_BUDGET || Date.now() - started >= WALL_BUDGET_MS) break;
    }
  }

  // Lo reclamado y no procesado (presupuesto agotado a mitad del lote) vuelve a
  // ser elegible a los 3 minutos por claimed_at; no hace falta tocarlo aquí.
  const elapsed = Math.round((Date.now() - started) / 1000);
  if (!stats.queued && !stats.hermanos) return json({ ok: true, queued: 0, message: "Sin adjuntos pendientes" });
  await pipelineLog(
    supabase,
    "attachments_extract",
    stats.failed > 0 ? "warning" : "info",
    `Adjuntos${emailIds ? ` (prioridad: ${emailIds.length} correos)` : ""}: ${stats.done} extraídos, ${stats.reused} reutilizados, ${stats.hermanos} hermanos, ${stats.skipped} sin extractor, ${stats.failed} fallidos (${stats.queued} en ${stats.lotes} lotes, ${Math.round(stats.bytes / 1024)} KB, ${elapsed}s)`,
    { ...stats, elapsed_s: elapsed, email_ids: emailIds ?? undefined },
  );
  return json({ ok: true, ...stats, elapsed_s: elapsed });
});
