"""Texto de un adjunto (Excel, CSV, PDF, Word, texto) sin límite de CPU.

Funciones puras: reciben bytes y devuelven el texto en el mismo formato que
`supabase/functions/attachments-extract` (hojas como `--- Hoja: <nombre> ---`
seguidas de CSV), para que la memoria no distinga quién lo extrajo.

Diferencias a propósito con la Edge Function, que solo aguanta archivos chicos:

- **Hojas chicas primero.** Un libro con una hoja de miles de renglones y una
  tabla dinámica de cien no debe perder la tabla porque el texto se corta a
  600k caracteres. Se arma cada hoja por separado y se concatenan de la más
  corta a la más larga; la que no cabe entra recortada con una nota.
- **Más hojas y páginas** (30 hojas, 300 páginas).
- **PDF sin texto** (escaneado): devuelve `None` y el llamador lo marca
  `pdf_sin_texto`, en vez de guardar un texto vacío como `done`.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import re

MAX_TEXT_CHARS = 600_000      # el mismo tope que la Edge Function
MAX_SHEETS = 30
MAX_PDF_PAGES = 300
PDF_MIN_CHARS = 40            # menos que esto en todo el PDF = escaneado

KINDS_EXTRAIBLES = ("pdf", "sheet", "docx", "text")


def ext_of(filename: str, mime: str) -> str:
    m = re.search(r"\.([a-z0-9]{1,6})$", (filename or "").lower())
    if m:
        return m.group(1)
    mime = mime or ""
    if mime == "application/pdf":
        return "pdf"
    if "spreadsheetml" in mime:
        return "xlsx"
    if "ms-excel" in mime:
        return "xls"
    if "wordprocessingml" in mime:
        return "docx"
    if mime == "text/csv":
        return "csv"
    if mime in ("text/xml", "application/xml"):
        return "xml"
    if mime == "text/plain":
        return "txt"
    return "bin"


def kind_of(filename: str, mime: str) -> str:
    """Mismas clases que `kindOf` de la Edge Function; el XML grande se trata
    como texto (el resumen de CFDI vive en TypeScript y un CFDI nunca pasa de
    unos cientos de KB)."""
    ext = ext_of(filename, mime)
    mime = mime or ""
    if ext == "pdf" or mime == "application/pdf":
        return "pdf"
    if ext in ("xlsx", "xlsm", "xls", "csv", "tsv") or re.search(r"spreadsheetml|ms-excel|text/csv", mime):
        return "sheet"
    if ext == "docx" or "wordprocessingml" in mime:
        return "docx"
    if ext in ("txt", "md", "json", "log", "xml") or mime.startswith("text/") or mime in ("application/xml",):
        return "text"
    return "other"


# ----------------------------------------------------------------------
# Hojas de cálculo
# ----------------------------------------------------------------------
def _celda(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        if v.is_integer():
            return str(int(v))
        return f"{v:.6f}".rstrip("0").rstrip(".")
    if isinstance(v, dt.datetime):
        return v.date().isoformat() if v.time() == dt.time() else v.isoformat(sep=" ")
    if isinstance(v, (dt.date, dt.time)):
        return v.isoformat()
    return str(v)


def _csv_hoja(filas, tope: int) -> tuple[str, int, bool]:
    """CSV de una hoja sin renglones vacíos ni celdas vacías al final.
    Devuelve (texto, renglones escritos, recortada)."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    n = 0
    for fila in filas:
        celdas = [_celda(v) for v in fila]
        while celdas and celdas[-1] == "":
            celdas.pop()
        if not celdas:
            continue
        w.writerow(celdas)
        n += 1
        if buf.tell() > tope:
            return buf.getvalue(), n, True
    return buf.getvalue(), n, False


def _hojas_xlsx(data: bytes):
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        for ws in wb.worksheets[:MAX_SHEETS]:
            yield ws.title, ws.iter_rows(values_only=True)
    finally:
        wb.close()


def _hojas_xls(data: bytes):
    import xlrd

    book = xlrd.open_workbook(file_contents=data)
    for sh in book.sheets()[:MAX_SHEETS]:
        def filas(sh=sh):
            for r in range(sh.nrows):
                fila = []
                for c in range(sh.ncols):
                    cell = sh.cell(r, c)
                    if cell.ctype == xlrd.XL_CELL_DATE:
                        try:
                            fila.append(xlrd.xldate.xldate_as_datetime(cell.value, book.datemode))
                        except Exception:  # noqa: BLE001 - fecha inválida en el archivo
                            fila.append(cell.value)
                    elif cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                        fila.append(None)
                    else:
                        fila.append(cell.value)
                yield fila
        yield sh.name, filas()


def _decodificar(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def texto_hojas(hojas, tope: int = MAX_TEXT_CHARS) -> str:
    """Une las hojas `(nombre, filas)` de la más corta a la más larga hasta
    `tope` caracteres. La que no cabe completa entra recortada con nota."""
    partes = []
    for nombre, filas in hojas:
        cuerpo, n, recortada = _csv_hoja(filas, tope)
        if cuerpo.strip():
            partes.append((nombre, cuerpo, n, recortada))
    partes.sort(key=lambda p: len(p[1]))
    salida: list[str] = []
    usado = 0
    for nombre, cuerpo, n, recortada in partes:
        encabezado = f"--- Hoja: {nombre} ---\n"
        libre = tope - usado - len(encabezado) - 2
        if libre <= 200:
            salida.append(f"--- Hoja: {nombre} --- (omitida: el texto llegó al tope)")
            continue
        if len(cuerpo) > libre or recortada:
            corte = cuerpo[:libre].rsplit("\n", 1)[0]
            renglones = corte.count("\n") + 1
            cuerpo = f"{corte}\n… (hoja recortada: {renglones} renglones de {n}{' o más' if recortada else ''})"
        bloque = encabezado + cuerpo
        salida.append(bloque)
        usado += len(bloque) + 2
    return "\n\n".join(salida)


def texto_hoja_calculo(data: bytes, filename: str, mime: str) -> str | None:
    ext = ext_of(filename, mime)
    if ext in ("csv", "tsv") or (mime or "").startswith("text/"):
        delim = "\t" if ext == "tsv" else ","
        filas = csv.reader(io.StringIO(_decodificar(data)), delimiter=delim)
        return texto_hojas([(filename, filas)])
    if ext == "xls":
        return texto_hojas(_hojas_xls(data))
    if ext in ("xlsx", "xlsm") or data[:2] == b"PK":
        return texto_hojas(_hojas_xlsx(data))
    return None


# ----------------------------------------------------------------------
# PDF, Word y texto
# ----------------------------------------------------------------------
def texto_pdf(data: bytes) -> str | None:
    """Texto de las primeras 300 páginas; `None` si no trae capa de texto."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:  # noqa: BLE001 - PDF con contraseña real
            return None
    paginas = []
    for page in reader.pages[:MAX_PDF_PAGES]:
        try:
            paginas.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001 - una página rota no tumba el resto
            paginas.append("")
    texto = "\n".join(paginas)
    if len(re.sub(r"\s+", "", texto)) < PDF_MIN_CHARS:
        return None
    return texto


def texto_docx(data: bytes) -> str:
    import docx

    d = docx.Document(io.BytesIO(data))
    partes = [p.text for p in d.paragraphs if p.text.strip()]
    for t in d.tables:
        for row in t.rows:
            celdas = [c.text.strip() for c in row.cells]
            if any(celdas):
                partes.append(" | ".join(celdas))
    return "\n".join(partes)


def extraer(data: bytes, filename: str, mime: str) -> tuple[str | None, str | None]:
    """`(texto, motivo)`: el texto (recortado a MAX_TEXT_CHARS) o `None` con el
    motivo para `skip_reason` (`pdf_sin_texto`, `no_extractor`)."""
    kind = kind_of(filename, mime)
    if kind == "pdf":
        texto = texto_pdf(data)
        if texto is None:
            return None, "pdf_sin_texto"
    elif kind == "sheet":
        texto = texto_hoja_calculo(data, filename, mime)
        if texto is None:
            return None, "no_extractor"
    elif kind == "docx":
        texto = texto_docx(data)
    elif kind == "text":
        texto = _decodificar(data)
    else:
        return None, "no_extractor"
    return texto[:MAX_TEXT_CHARS], None
