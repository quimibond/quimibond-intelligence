"""Extractor de adjuntos grandes de la memoria de correo (GitHub Actions).

La Edge Function `attachments-extract` tiene 2 s de CPU por invocación y por
eso salta a propósito lo grande: más de 3 MB ni se baja (`too_large`), PDF y
Excel de más de 2 MB se bajan pero no se leen (`pdf_too_large`,
`sheet_too_large`) y lo que reventó la CPU tres veces queda `failed` /
`cpu_limit`. Este programa corre fuera de Supabase, sin ese tope, y deja esas
filas igual que si la Edge Function las hubiera leído: `extract_status =
'done'`, `extracted_text` y `sha256`.

El archivo **no** se sube a Storage: son unos 10 GB de PDF y Excel grandes que
ya viven en Gmail y solo hacían falta para sacarles el texto. Lo que ya estaba
en el bucket (`pdf_too_large`, `sheet_too_large`) se baja de ahí; lo demás, de
Gmail.

Reglas:

- Solo correos de 2026 (decisión 2026-09-18, la misma que la Edge Function).
- Un archivo se baja y se lee una sola vez: el mismo adjunto llega a varios
  buzones (mismo Message-ID, nombre y tamaño) y el resultado se escribe en
  todas las copias.
- Nada se reintenta para siempre: si un archivo falla queda `failed` /
  `grande_error` con el error en `last_error` y sale de la cola.
- Lo que no es PDF, Excel, CSV, Word o texto queda `skipped` / `no_extractor`
  sin bajarlo.
- Secuencial (un archivo a la vez) y con presupuesto de tiempo: no carga la
  base con decenas de conexiones (regla de 2026-09-16).

Variables de entorno:
  SUPABASE_SERVICE_ROLE_KEY  (secreto del repo; obligatoria)
  SUPABASE_URL               (default https://tozqezmivpblmcubmnpi.supabase.co)
  MAX_MINUTES                presupuesto de tiempo por corrida (default 25)
  GMAIL_MESSAGE_IDS          ids de Gmail separados por coma: solo esos correos
  DRY_RUN=1                  lista lo que haría sin escribir nada

La cuenta de servicio de Google se lee de Vault (RPC `edge_secret`), la misma
que usan las Edge Functions: no hay que copiarla a GitHub.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import time
import urllib.parse

import requests

from texto import KINDS_EXTRAIBLES, extraer, kind_of

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://tozqezmivpblmcubmnpi.supabase.co").rstrip("/")
BUCKET = "email-attachments"
MOTIVOS = ("too_large", "pdf_too_large", "sheet_too_large", "cpu_limit")
DESDE = "2026-01-01"
PAGINA = 100
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
MAX_BYTES = 25 * 1024 * 1024   # lo mismo que acepta el registro de adjuntos


class Supabase:
    def __init__(self, key: str):
        self.s = requests.Session()
        self.s.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})

    def get(self, tabla: str, params: dict) -> list:
        r = self.s.get(f"{SUPABASE_URL}/rest/v1/{tabla}", params=params, timeout=60)
        r.raise_for_status()
        return r.json()

    def patch(self, ids: list[int], valores: dict) -> None:
        if not ids:
            return
        r = self.s.patch(
            f"{SUPABASE_URL}/rest/v1/email_attachments",
            params={"id": f"in.({','.join(str(i) for i in ids)})"},
            json=valores,
            headers={"Prefer": "return=minimal"},
            timeout=120,
        )
        r.raise_for_status()

    def rpc(self, fn: str, args: dict):
        r = self.s.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}", json=args, timeout=60)
        r.raise_for_status()
        return r.json()

    def bajar(self, path: str) -> bytes:
        r = self.s.get(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}", timeout=300)
        r.raise_for_status()
        return r.content

    def log(self, level: str, message: str, details: dict) -> None:
        try:
            self.s.post(
                f"{SUPABASE_URL}/rest/v1/pipeline_logs",
                json={"level": level, "phase": "attachments_extract_grandes", "message": message,
                      "details": {**details, "runtime": "github"}},
                headers={"Prefer": "return=minimal"},
                timeout=30,
            ).raise_for_status()
        except Exception as err:  # noqa: BLE001 - el log no debe tumbar la corrida
            print(f"[log] {err}", file=sys.stderr)


class Gmail:
    """Un cliente por buzón, con delegación de dominio (subject = buzón)."""

    def __init__(self, info: dict):
        from google.oauth2 import service_account

        self.base = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
        self.creds: dict = {}

    def _token(self, buzon: str) -> str:
        from google.auth.transport.requests import Request

        c = self.creds.get(buzon)
        if c is None:
            c = self.creds[buzon] = self.base.with_subject(buzon)
        if not c.valid:
            c.refresh(Request())
        return c.token

    def _get(self, buzon: str, url: str, params: dict | None = None) -> requests.Response:
        return requests.get(url, params=params, headers={"Authorization": f"Bearer {self._token(buzon)}"}, timeout=300)

    def adjunto(self, buzon: str, mensaje: str, adjunto_id: str | None, filename: str, size: int) -> tuple[bytes, str] | None:
        def bajar(aid: str) -> bytes | None:
            r = self._get(buzon, f"{GMAIL}/messages/{mensaje}/attachments/{aid}")
            if r.status_code in (400, 404):
                return None
            r.raise_for_status()
            data = r.json().get("data")
            return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)) if data else None

        if adjunto_id:
            data = bajar(adjunto_id)
            if data is not None:
                return data, adjunto_id
        # attachmentId caducado: re-localizar por nombre y tamaño, como la Edge Function.
        r = self._get(buzon, f"{GMAIL}/messages/{mensaje}", {"format": "full"})
        if r.status_code == 404:
            return None
        r.raise_for_status()
        pila = list(r.json().get("payload", {}).get("parts", []) or [])
        while pila:
            parte = pila.pop()
            pila.extend(parte.get("parts", []) or [])
            body = parte.get("body", {}) or {}
            if parte.get("filename") == filename and int(body.get("size") or 0) == size and body.get("attachmentId"):
                data = bajar(body["attachmentId"])
                if data is not None:
                    return data, body["attachmentId"]
        return None


def clave(fila: dict) -> tuple:
    """Copias del mismo adjunto en varios buzones: mismo Message-ID, nombre y tamaño."""
    em = fila["emails"]
    return (em.get("message_id_hdr") or em["gmail_message_id"], fila["filename"], fila["size_bytes"])


def candidatos(sb: Supabase, despues_de: int | None, ids_gmail: list[str] | None) -> list[dict]:
    params = {
        "select": "id,filename,mime_type,size_bytes,sha256,storage_path,gmail_attachment_id,skip_reason,"
                  "emails!inner(account,gmail_message_id,message_id_hdr,email_date)",
        "skip_reason": f"in.({','.join(MOTIVOS)})",
        "extract_status": "in.(skipped,failed)",
        "emails.email_date": f"gte.{DESDE}",
        "size_bytes": f"lte.{MAX_BYTES}",
        "order": "id.desc",
        "limit": str(PAGINA),
    }
    if despues_de is not None:
        params["id"] = f"lt.{despues_de}"
    if ids_gmail:
        params["emails.gmail_message_id"] = f"in.({','.join(ids_gmail)})"
    return sb.get("email_attachments", params)


def copias(sb: Supabase, fila: dict) -> list[int]:
    """Ids de todas las copias pendientes del mismo adjunto (incluida esta)."""
    em = fila["emails"]
    params = {
        "select": "id,emails!inner(message_id_hdr,gmail_message_id)",
        "filename": f"eq.{fila['filename']}",
        "size_bytes": f"eq.{fila['size_bytes']}",
        "skip_reason": f"in.({','.join(MOTIVOS)})",
    }
    if em.get("message_id_hdr"):
        params["emails.message_id_hdr"] = f"eq.{em['message_id_hdr']}"
    else:
        params["emails.gmail_message_id"] = f"eq.{em['gmail_message_id']}"
    ids = {r["id"] for r in sb.get("email_attachments", params)}
    ids.add(fila["id"])
    return sorted(ids)


def ahora() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def procesar(sb: Supabase, gmail: Gmail, fila: dict, dry: bool) -> str:
    """Lee una fila y escribe el resultado en ella y en sus copias. Devuelve
    el resultado: done, no_extractor, pdf_sin_texto, no_encontrado o error."""
    kind = kind_of(fila["filename"], fila["mime_type"] or "")
    ids = copias(sb, fila)
    if kind not in KINDS_EXTRAIBLES:
        if not dry:
            sb.patch(ids, {"extract_status": "skipped", "skip_reason": "no_extractor", "updated_at": ahora()})
        return "no_extractor"
    if dry:
        return "done"
    em = fila["emails"]
    try:
        attachment_id = fila.get("gmail_attachment_id")
        if fila.get("storage_path"):
            data = sb.bajar(fila["storage_path"])
        else:
            res = gmail.adjunto(em["account"], em["gmail_message_id"], attachment_id, fila["filename"], fila["size_bytes"])
            if res is None:
                sb.patch(ids, {"extract_status": "failed", "skip_reason": "grande_error",
                               "last_error": "adjunto no encontrado en Gmail", "updated_at": ahora()})
                return "no_encontrado"
            data, attachment_id = res
        sha = hashlib.sha256(data).hexdigest()
        texto, motivo = extraer(data, fila["filename"], fila["mime_type"] or "")
        valores = {
            "sha256": sha,
            "gmail_attachment_id": attachment_id,
            "extracted_text": texto,
            "extract_status": "done" if texto is not None else "skipped",
            "skip_reason": motivo,
            "last_error": None,
            "updated_at": ahora(),
        }
        sb.patch(ids, valores)
        return "done" if texto is not None else motivo
    except Exception as err:  # noqa: BLE001 - un archivo malo no detiene la corrida
        msg = f"{type(err).__name__}: {err}"[:500]
        print(f"[error] {fila['id']} {fila['filename']}: {msg}", file=sys.stderr)
        sb.patch(ids, {"extract_status": "failed", "skip_reason": "grande_error", "last_error": msg, "updated_at": ahora()})
        return "error"


def main() -> int:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        print("Falta SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2
    dry = os.environ.get("DRY_RUN") == "1"
    limite = time.monotonic() + 60 * float(os.environ.get("MAX_MINUTES", "25"))
    ids_gmail = [x.strip() for x in os.environ.get("GMAIL_MESSAGE_IDS", "").split(",") if x.strip()] or None

    sb = Supabase(key)
    sa = sb.rpc("edge_secret", {"p_name": "google_service_account_json"})
    gmail = Gmail(json.loads(sa) if isinstance(sa, str) else sa)

    stats: dict[str, int] = {}
    vistos: set[tuple] = set()
    despues_de = None
    while time.monotonic() < limite:
        filas = candidatos(sb, despues_de, ids_gmail)
        if not filas:
            break
        for fila in filas:
            despues_de = fila["id"]
            k = clave(fila)
            if k in vistos:
                continue  # copia de un archivo ya leído en esta corrida
            vistos.add(k)
            res = procesar(sb, gmail, fila, dry)
            stats[res] = stats.get(res, 0) + 1
            print(f"{res:14} {fila['id']:>8} {fila['size_bytes']:>10} {fila['filename']}")
            if time.monotonic() >= limite:
                break

    resumen = ", ".join(f"{v} {k}" for k, v in sorted(stats.items())) or "sin pendientes"
    print(f"Adjuntos grandes: {resumen}")
    if not dry and stats:
        level = "warning" if stats.get("error") or stats.get("no_encontrado") else "info"
        sb.log(level, f"Adjuntos grandes: {resumen}", stats)
    return 0


if __name__ == "__main__":
    sys.exit(main())
