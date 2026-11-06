"""Pruebas de texto.py (sin red): `python -m pytest scripts/adjuntos-grandes`."""
import io

import openpyxl
import pytest
from pypdf import PdfWriter

import texto


def _xlsx(hojas: dict[str, list[list]]) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for nombre, filas in hojas.items():
        ws = wb.create_sheet(nombre)
        for fila in filas:
            ws.append(fila)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_kind_of_como_la_edge_function():
    assert texto.kind_of("Nomina 46.xlsx", "") == "sheet"
    assert texto.kind_of("datos.csv", "text/csv") == "sheet"
    assert texto.kind_of("x", "application/pdf") == "pdf"
    assert texto.kind_of("carta.docx", "") == "docx"
    assert texto.kind_of("cfdi.xml", "text/xml") == "text"
    assert texto.kind_of("fotos.zip", "application/zip") == "other"


def test_hoja_chica_va_primero_y_la_grande_se_recorta():
    """El acumulado de Lorena: una hoja de miles de renglones y una tabla por
    trabajador. La tabla debe quedar completa aunque el texto llegue al tope."""
    grande = [["Enero", i, "GENARO GERONIMO BARTOLO", 1970.0, 183.92] for i in range(20_000)]
    tabla = [["Clave", "Nombre", "Total Gravable", "ISR"], [1, "GENARO", 98_500.5, 9_210.0]]
    data = _xlsx({"SMTOL": grande, "TABLA ISR": tabla})
    out = texto.extraer(data, "ACUMULADO.xlsx", "")[0]
    assert len(out) <= texto.MAX_TEXT_CHARS
    assert out.startswith("--- Hoja: TABLA ISR ---\nClave,Nombre,Total Gravable,ISR\n1,GENARO,98500.5,9210\n")
    assert "--- Hoja: SMTOL ---" in out
    assert "(hoja recortada:" in out


def test_csv_sin_renglones_ni_celdas_vacias():
    data = _xlsx({"H": [["a", None, None], [None, None], [1.0, 2.5, None]]})
    assert texto.extraer(data, "x.xlsx", "")[0] == "--- Hoja: H ---\na\n1,2.5\n"


def test_csv_texto_plano():
    out, motivo = texto.extraer("Clave,Neto\n1,5224.13\n".encode("cp1252"), "n.csv", "text/csv")
    assert motivo is None
    assert out == "--- Hoja: n.csv ---\nClave,Neto\n1,5224.13\n"


def test_pdf_escaneado_no_se_guarda_como_hecho():
    w = PdfWriter()
    w.add_blank_page(width=612, height=792)
    buf = io.BytesIO()
    w.write(buf)
    assert texto.extraer(buf.getvalue(), "Prestamo.pdf", "application/pdf") == (None, "pdf_sin_texto")


def test_otro_tipo_sin_extractor():
    assert texto.extraer(b"PK\x03\x04", "fotos.zip", "application/zip") == (None, "no_extractor")


@pytest.mark.parametrize("valor,esperado", [(5.0, "5"), (2845.57, "2845.57"), (None, ""), (True, "TRUE")])
def test_celda(valor, esperado):
    assert texto._celda(valor) == esperado
