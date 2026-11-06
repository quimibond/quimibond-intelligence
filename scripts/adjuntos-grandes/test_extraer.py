"""Pruebas de extraer.procesar con Supabase y Gmail de mentira (sin red)."""
import io

import openpyxl

import extraer


def _xlsx() -> bytes:
    wb = openpyxl.Workbook()
    wb.active.append(["Clave", "Neto"])
    wb.active.append([1, 5224.13])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class FakeSB:
    def __init__(self, copias=(), storage=None):
        self.patches = []
        self._copias = list(copias)
        self.storage = storage or {}

    def get(self, tabla, params):
        return [{"id": i} for i in self._copias]

    def patch(self, ids, valores):
        self.patches.append((ids, valores))

    def bajar(self, path):
        return self.storage[path]


class FakeGmail:
    def __init__(self, data=None, falla=False):
        self.data, self.falla, self.llamadas = data, falla, 0

    def adjunto(self, buzon, mensaje, aid, filename, size):
        self.llamadas += 1
        if self.falla:
            raise RuntimeError("503 backend")
        return (self.data, "nuevo-aid") if self.data is not None else None


def _fila(filename="ACUMULADO.xlsx", storage_path=None, mime=""):
    return {"id": 10, "filename": filename, "mime_type": mime, "size_bytes": 4_640_821, "sha256": None,
            "storage_path": storage_path, "gmail_attachment_id": "aid", "skip_reason": "sheet_too_large",
            "emails": {"account": "jose.mizrahi@quimibond.com", "gmail_message_id": "1a1b",
                       "message_id_hdr": "<x@mail.gmail.com>", "email_date": "2026-11-06"}}


def test_lee_de_gmail_y_escribe_en_todas_las_copias():
    sb, gm = FakeSB(copias=[11, 12]), FakeGmail(_xlsx())
    assert extraer.procesar(sb, gm, _fila(), dry=False) == "done"
    ids, v = sb.patches[-1]
    assert ids == [10, 11, 12]
    assert v["extract_status"] == "done" and v["skip_reason"] is None
    assert v["extracted_text"].startswith("--- Hoja: Sheet ---\nClave,Neto\n1,5224.13")
    assert v["gmail_attachment_id"] == "nuevo-aid" and len(v["sha256"]) == 64
    assert "storage_path" not in v  # no se sube nada a Storage


def test_lo_que_ya_esta_en_storage_no_toca_gmail():
    sb, gm = FakeSB(storage={"abc.xlsx": _xlsx()}), FakeGmail()
    assert extraer.procesar(sb, gm, _fila(storage_path="abc.xlsx"), dry=False) == "done"
    assert gm.llamadas == 0


def test_tipo_sin_extractor_no_se_baja():
    sb, gm = FakeSB(), FakeGmail(b"x")
    assert extraer.procesar(sb, gm, _fila("fotos.zip", mime="application/zip"), dry=False) == "no_extractor"
    assert gm.llamadas == 0
    assert sb.patches[-1][1]["skip_reason"] == "no_extractor"


def test_error_sale_de_la_cola_y_no_se_reintenta():
    sb = FakeSB()
    assert extraer.procesar(sb, FakeGmail(falla=True), _fila(), dry=False) == "error"
    v = sb.patches[-1][1]
    assert (v["extract_status"], v["skip_reason"]) == ("failed", "grande_error")
    assert "503" in v["last_error"]


def test_no_encontrado_en_gmail():
    sb = FakeSB()
    assert extraer.procesar(sb, FakeGmail(None), _fila(), dry=False) == "no_encontrado"
    assert sb.patches[-1][1]["skip_reason"] == "grande_error"


def test_dry_run_no_escribe():
    sb = FakeSB()
    extraer.procesar(sb, FakeGmail(_xlsx()), _fila(), dry=True)
    assert sb.patches == []
