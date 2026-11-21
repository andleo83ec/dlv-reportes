"""Genera plantilla_oficio_dlv.docx (formato base DLV para docxtpl).
Puede abrirla y modificar el diseño en Word: mantenga las etiquetas {{ }} y {%p %}
intactas y el texto FIRMA_AQUI donde debe ir la firma.
"""
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

NAVY = RGBColor(0x1D, 0x2A, 0x3A)
ORO = RGBColor(0xC8, 0xA2, 0x4A)
GRIS = RGBColor(0x6B, 0x72, 0x80)
FUENTE = "Arial"

doc = Document()
sec = doc.sections[0]
sec.page_height, sec.page_width = Cm(29.7), Cm(21.0)
sec.top_margin, sec.bottom_margin = Cm(3.2), Cm(2.4)
sec.left_margin, sec.right_margin = Cm(2.5), Cm(2.5)
sec.header_distance, sec.footer_distance = Cm(1.0), Cm(1.0)

st = doc.styles["Normal"]
st.font.name = FUENTE
st.font.size = Pt(11)
st.element.rPr.rFonts.set(qn("w:eastAsia"), FUENTE)
st.paragraph_format.space_after = Pt(0)
st.paragraph_format.line_spacing = 1.15


def linea_inferior(p, color="1D2A3A", grosor=12):
    pPr = p._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    b = OxmlElement("w:bottom")
    b.set(qn("w:val"), "single"); b.set(qn("w:sz"), str(grosor)); b.set(qn("w:space"), "4"); b.set(qn("w:color"), color)
    bdr.append(b); pPr.append(bdr)


def linea_superior(p, color="C8A24A", grosor=6):
    pPr = p._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    t = OxmlElement("w:top")
    t.set(qn("w:val"), "single"); t.set(qn("w:sz"), str(grosor)); t.set(qn("w:space"), "4"); t.set(qn("w:color"), color)
    bdr.append(t); pPr.append(bdr)


def par(texto="", negrita=False, tam=None, color=None, alin=None, antes=0, despues=0, juntar=False, mayus=False):
    p = doc.add_paragraph()
    if texto:
        r = p.add_run(texto)
        r.bold = negrita
        r.font.all_caps = mayus
        if tam: r.font.size = Pt(tam)
        if color: r.font.color.rgb = color
    if alin is not None: p.alignment = alin
    p.paragraph_format.space_before = Pt(antes)
    p.paragraph_format.space_after = Pt(despues)
    p.paragraph_format.keep_with_next = juntar
    return p


# ---- Encabezado ----
h = sec.header
hp = h.paragraphs[0]
r = hp.add_run("DLV CONSTRUCCIONES"); r.bold = True; r.font.size = Pt(16); r.font.color.rgb = NAVY; r.font.name = FUENTE
r = hp.add_run("  CÍA. LTDA."); r.font.size = Pt(9); r.font.color.rgb = ORO; r.bold = True; r.font.name = FUENTE
hp2 = h.add_paragraph()
r = hp2.add_run("Ingeniería · Construcción · Gerencia de proyectos"); r.font.size = Pt(8.5); r.font.color.rgb = GRIS; r.font.name = FUENTE
linea_inferior(hp2)
hp3 = h.add_paragraph()
hp3.alignment = WD_ALIGN_PARAGRAPH.RIGHT
r = hp3.add_run("Proyecto: {{ proyecto_nombre }}"); r.font.size = Pt(8); r.font.color.rgb = GRIS; r.font.name = FUENTE

# ---- Pie ----
f = sec.footer
fp = f.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
linea_superior(fp)
r = fp.add_run("Av. Primero de Mayo y Av. de las Américas · Cuenca, Ecuador · Cel. 0999501112")
r.font.size = Pt(8); r.font.color.rgb = GRIS; r.font.name = FUENTE
fp2 = f.add_paragraph(); fp2.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = fp2.add_run("Documento firmado electrónicamente. Verifique su autenticidad escaneando el código QR.")
r.font.size = Pt(7.5); r.font.color.rgb = GRIS; r.italic = True; r.font.name = FUENTE

# ---- Cuerpo ----
par("{{ ciudad_fecha }}", alin=WD_ALIGN_PARAGRAPH.RIGHT, despues=4)
p = par(alin=WD_ALIGN_PARAGRAPH.RIGHT, despues=18)
r = p.add_run("Oficio N.º "); r.bold = True; r.font.color.rgb = NAVY
r = p.add_run("{{ codigo }}"); r.bold = True; r.font.color.rgb = NAVY

par("{{ destinatario_titulo }} {{ destinatario_nombre }}", negrita=True)
par("{%p if destinatario_cargo %}")
par("{{ destinatario_cargo }}")
par("{%p endif %}")
par("{%p if destinatario_institucion %}")
par("{{ destinatario_institucion }}")
par("{%p endif %}")
par("Presente.-", despues=14)

p = par(despues=2)
r = p.add_run("Asunto: "); r.bold = True
p.add_run("{{ asunto }}")
par("{%p if referencia %}")
p = par()
r = p.add_run("Ref.: "); r.bold = True
p.add_run("{{ referencia }}")
par("{%p endif %}")

par("De mi consideración:", antes=14, despues=10)
par("{%p for p in parrafos %}")
p = par("{{ p }}", alin=WD_ALIGN_PARAGRAPH.JUSTIFY, despues=10)
par("{%p endfor %}")

par("Atentamente,", antes=8, despues=4, juntar=True)
# Marcador invisible donde el agente coloca la firma con QR (no borrar)
p = par(MARCADOR := "FIRMA_AQUI", tam=6, color=RGBColor(0xFF, 0xFF, 0xFF), juntar=True)
p.paragraph_format.space_after = Pt(62)   # espacio reservado para el sello de firma
par("{{ firmante_nombre }}", negrita=True, juntar=True)
par("{{ firmante_cargo }}", juntar=True)
par("DLV CONSTRUCCIONES CÍA. LTDA.", tam=9, color=GRIS, despues=16)

par("{%p if anexos %}")
p = par(tam=9)
r = p.add_run("Anexos: "); r.bold = True; r.font.size = Pt(9)
r = p.add_run("{{ anexos }}"); r.font.size = Pt(9)
par("{%p endif %}")
par("{%p if con_copia %}")
p = par(tam=9)
r = p.add_run("c.c.: "); r.bold = True; r.font.size = Pt(9)
r = p.add_run("{{ con_copia }}"); r.font.size = Pt(9)
par("{%p endif %}")

if __name__ == "__main__":
    import sys
    salida = sys.argv[1] if len(sys.argv) > 1 else "plantilla_oficio_dlv.docx"
    doc.save(salida)
    print("Plantilla guardada en", salida)
