#!/usr/bin/env python3
"""
DLV Plataforma · Oficios — Agente de firma local
------------------------------------------------
Corre en la computadora del firmante. Su certificado .p12 de Security Data y
su contraseña NUNCA salen de esta máquina.

Flujo por cada oficio pendiente de su firma:
  1. Descarga la plantilla Word de la obra y la llena con los datos del oficio.
  2. (Opcional --revisar) abre el .docx en Word para ajustes finales.
  3. Convierte a PDF (Word o LibreOffice).
  4. Firma con pyHanko (PAdES) e inserta el sello visible con código QR de verificación.
  5. Sube PDF y Word a la carpeta de la obra (R2) y registra la firma en la plataforma.

Uso:
  python agente_firma.py                 # lista pendientes y pregunta cuáles firmar
  python agente_firma.py --todos         # firma todos los pendientes
  python agente_firma.py --revisar       # abre cada oficio en Word antes de firmar
  python agente_firma.py --vista-previa  # genera el PDF sin firmar ni subir (prueba de plantilla)
"""
from __future__ import annotations

import argparse
import datetime as dt
import getpass
import hashlib
import io
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import requests
    from docxtpl import DocxTemplate
except ImportError:
    sys.exit("Faltan librerías. Ejecute:  pip install -r requirements.txt")

AQUI = Path(__file__).resolve().parent
MARCADOR_FIRMA = "FIRMA_AQUI"
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


# ----------------------------------------------------------------------------
# Configuración y sesión
# ----------------------------------------------------------------------------
def cargar_config(ruta: Path) -> dict:
    if not ruta.exists():
        sys.exit(f"No existe {ruta}. Copie config.ejemplo.json como config.json y complételo.")
    cfg = json.loads(ruta.read_text(encoding="utf-8"))
    for k in ("supabase_url", "supabase_anon_key", "app_url", "email", "certificado_p12"):
        if not cfg.get(k) or "SU-" in str(cfg.get(k)):
            sys.exit(f"Complete '{k}' en {ruta}")
    cfg["supabase_url"] = cfg["supabase_url"].rstrip("/")
    cfg["app_url"] = cfg["app_url"].rstrip("/")
    cfg.setdefault("carpeta_local", str(Path.home() / "DLV_Oficios"))
    cfg.setdefault("conversor", "auto")
    return cfg


class Sesion:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.http = requests.Session()
        self.token = None
        self.refresh = None
        self.uid = None

    def _auth(self, grant: str, payload: dict):
        r = self.http.post(f"{self.cfg['supabase_url']}/auth/v1/token?grant_type={grant}",
                           headers={"apikey": self.cfg["supabase_anon_key"]}, json=payload, timeout=30)
        if r.status_code != 200:
            raise RuntimeError("No se pudo iniciar sesión: " + r.json().get("error_description", r.text))
        d = r.json()
        self.token, self.refresh, self.uid = d["access_token"], d["refresh_token"], d["user"]["id"]

    def login(self, password: str):
        self._auth("password", {"email": self.cfg["email"], "password": password})

    def _headers(self):
        return {"apikey": self.cfg["supabase_anon_key"], "Authorization": f"Bearer {self.token}"}

    def _req(self, metodo: str, url: str, **kw):
        r = self.http.request(metodo, url, headers=self._headers(), timeout=120, **kw)
        if r.status_code == 401 and self.refresh:          # token vencido → renovar una vez
            self._auth("refresh_token", {"refresh_token": self.refresh})
            r = self.http.request(metodo, url, headers=self._headers(), timeout=120, **kw)
        return r

    def rest(self, path: str):
        r = self._req("GET", f"{self.cfg['supabase_url']}/rest/v1/{path}")
        r.raise_for_status()
        return r.json()

    def app(self, metodo: str, path: str, **kw):
        r = self._req(metodo, f"{self.cfg['app_url']}{path}", **kw)
        if r.status_code >= 400:
            try:
                msg = r.json().get("error", r.text)
            except ValueError:
                msg = r.text
            raise RuntimeError(f"{path}: {msg}")
        return r


# ----------------------------------------------------------------------------
# 1. Plantilla → Word
# ----------------------------------------------------------------------------
def fecha_larga(ciudad: str, fecha_iso: str) -> str:
    d = dt.date.fromisoformat(fecha_iso)
    return f"{ciudad}, {d.day} de {MESES[d.month - 1]} de {d.year}"


def parrafos(texto: str) -> list[str]:
    bloques = re.split(r"\n\s*\n", (texto or "").replace("\r\n", "\n").strip())
    return [re.sub(r"\s*\n\s*", " ", b).strip() for b in bloques if b.strip()]


def generar_docx(plantilla: bytes, oficio: dict, firmante: dict, destino: Path):
    p = oficio["obras"]
    ctx = {
        "codigo": oficio["codigo"],
        "numero": oficio["numero"],
        "ciudad_fecha": fecha_larga(p.get("ciudad") or "Cuenca", oficio["fecha_emision"]),
        "fecha": oficio["fecha_emision"],
        "proyecto_nombre": p.get("nombre", ""),
        "proyecto_codigo": p.get("codigo") or "",
        "cliente": p.get("cliente", ""),
        "destinatario_titulo": oficio.get("destinatario_titulo", ""),
        "destinatario_nombre": oficio.get("destinatario_nombre", ""),
        "destinatario_cargo": oficio.get("destinatario_cargo", ""),
        "destinatario_institucion": oficio.get("destinatario_institucion", ""),
        "asunto": oficio.get("asunto", ""),
        "referencia": oficio.get("referencia", ""),
        "parrafos": parrafos(oficio.get("cuerpo", "")),
        "anexos": oficio.get("anexos", ""),
        "con_copia": oficio.get("con_copia", ""),
        "firmante_nombre": oficio.get("firmante_nombre") or " ".join(x for x in (firmante.get("titulo"), firmante.get("nombre")) if x),
        "firmante_cargo": oficio.get("firmante_cargo") or firmante.get("cargo") or "",
    }
    tpl = DocxTemplate(io.BytesIO(plantilla))
    tpl.render(ctx, autoescape=True)   # autoescape: textos con & < > no rompen el Word
    tpl.save(destino)


def abrir_en_word(ruta: Path):
    if platform.system() == "Windows":
        os.startfile(str(ruta))  # type: ignore[attr-defined]
    elif platform.system() == "Darwin":
        subprocess.run(["open", str(ruta)])
    else:
        subprocess.run(["xdg-open", str(ruta)])


# ----------------------------------------------------------------------------
# 2. Word → PDF
# ----------------------------------------------------------------------------
def buscar_soffice(cfg: dict) -> str | None:
    if cfg.get("soffice"):
        return cfg["soffice"]
    for c in ("soffice", "libreoffice"):
        if shutil.which(c):
            return shutil.which(c)
    for c in (r"C:\Program Files\LibreOffice\program\soffice.exe",
              r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
              "/Applications/LibreOffice.app/Contents/MacOS/soffice"):
        if Path(c).exists():
            return c
    return None


def convertir_pdf(cfg: dict, docx: Path) -> Path:
    pdf = docx.with_suffix(".pdf")
    modo = cfg.get("conversor", "auto")
    if modo in ("auto", "word") and platform.system() in ("Windows", "Darwin"):
        try:
            from docx2pdf import convert          # usa Microsoft Word instalado (máxima fidelidad)
            convert(str(docx), str(pdf))
            if pdf.exists():
                return pdf
        except Exception as e:                    # noqa: BLE001
            if modo == "word":
                raise RuntimeError(f"No se pudo convertir con Word: {e}")
    soffice = buscar_soffice(cfg)
    if not soffice:
        raise RuntimeError("No encontré Word (docx2pdf) ni LibreOffice para convertir a PDF.")
    subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", str(docx.parent), str(docx)],
                   check=True, capture_output=True, timeout=180)
    if not pdf.exists():
        raise RuntimeError("LibreOffice no generó el PDF")
    return pdf


# ----------------------------------------------------------------------------
# 3. Ubicar la firma y comprobar el PDF
# ----------------------------------------------------------------------------
def analizar_pdf(pdf: Path, codigo: str, cfg: dict):
    """Devuelve (pagina, caja) donde va la firma. Caja en puntos PDF (origen abajo-izquierda)."""
    resp = cfg.get("caja_firma_respaldo", {"pagina": -1, "x": 72, "y": 100, "ancho": 300, "alto": 66})
    caja_resp = (resp["pagina"], (resp["x"], resp["y"], resp["x"] + resp["ancho"], resp["y"] + resp["alto"]))
    try:
        import fitz  # PyMuPDF
    except ImportError:
        print("   (PyMuPDF no instalado: uso la posición de respaldo de la firma)")
        return caja_resp
    doc = fitz.open(str(pdf))
    texto = "".join(pg.get_text() for pg in doc)
    if codigo not in texto:
        raise RuntimeError(f"El PDF no contiene el código {codigo}. ¿Se borró al editar en Word?")
    ancho, alto = resp.get("ancho", 300), resp.get("alto", 66)
    for i in range(len(doc) - 1, -1, -1):
        hits = doc[i].search_for(MARCADOR_FIRMA)
        if hits:
            r = hits[0]
            h = doc[i].rect.height
            x0 = r.x0
            y_sup = h - r.y0                     # convertir a coordenadas PDF
            return i, (x0, y_sup - alto, x0 + ancho, y_sup)
    print("   (No encontré el marcador FIRMA_AQUI: uso la posición de respaldo)")
    return caja_resp


# ----------------------------------------------------------------------------
# 4. Firma con pyHanko
# ----------------------------------------------------------------------------
def cargar_firmante(ruta_p12: str, clave: str):
    from pyhanko.sign import signers
    s = signers.SimpleSigner.load_pkcs12(pfx_file=ruta_p12, passphrase=clave.encode("utf-8"))
    if s is None:
        raise RuntimeError(
            "No se pudo abrir el certificado. Revise la contraseña. Si es correcta y el archivo es antiguo, "
            "vea 'Certificado no abre' en el README (conversión con openssl).")
    return s


def firmar_pdf(cfg: dict, signer, pdf_in: Path, pdf_out: Path, oficio: dict, url: str, pagina: int, caja):
    from pyhanko import stamp
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import fields, signers, timestamps

    ciudad = oficio["obras"].get("ciudad") or "Cuenca"
    meta = signers.PdfSignatureMetadata(
        field_name="FirmaDLV",
        reason=f"Oficio {oficio['codigo']}",
        location=f"{ciudad}, Ecuador",
        md_algorithm="sha256",
        subfilter=fields.SigSeedSubFilter.PADES,
    )
    estilo = stamp.QRStampStyle(
        stamp_text="Firmado electrónicamente por:\n%(signer)s\nFecha: %(ts)s\n%(codigo)s",
        timestamp_format="%d/%m/%Y %H:%M",
        border_width=0,
    )
    tsa = timestamps.HTTPTimeStamper(cfg["tsa_url"]) if cfg.get("tsa_url") else None
    campo = fields.SigFieldSpec(sig_field_name="FirmaDLV", on_page=pagina, box=tuple(round(v, 1) for v in caja))
    pdf_signer = signers.PdfSigner(meta, signer=signer, timestamper=tsa, stamp_style=estilo, new_field_spec=campo)
    with open(pdf_in, "rb") as inf:
        w = IncrementalPdfFileWriter(inf, strict=False)
        with open(pdf_out, "wb") as outf:
            pdf_signer.sign_pdf(w, output=outf, appearance_text_params={"url": url, "codigo": oficio["codigo"]})


def nombre_certificado(signer) -> str:
    try:
        return signer.signing_cert.subject.human_friendly
    except Exception:  # noqa: BLE001
        return ""


# ----------------------------------------------------------------------------
# Programa principal
# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Agente de firma de oficios · Plataforma DLV")
    ap.add_argument("--config", default=str(AQUI / "config.json"))
    ap.add_argument("--todos", action="store_true", help="firmar todos los pendientes sin preguntar")
    ap.add_argument("--revisar", action="store_true", help="abrir cada oficio en Word antes de firmar")
    ap.add_argument("--vista-previa", action="store_true", help="solo generar PDF sin firmar ni subir")
    args = ap.parse_args()

    cfg = cargar_config(Path(args.config))
    print("Plataforma DLV · Oficios · Agente de firma\n")
    s = Sesion(cfg)
    s.login(getpass.getpass(f"Contraseña de la plataforma DLV ({cfg['email']}): "))

    yo = s.rest(f"perfiles?select=nombre,titulo,cargo&id=eq.{s.uid}")[0]
    pend = s.rest("oficios?select=*,obras(codigo,nombre,ciudad,cliente)"
                  f"&firmante_id=eq.{s.uid}&estado=eq.pendiente_firma&order=emitido_en.asc")
    if not pend:
        print("No tiene oficios pendientes de firma. ✔")
        return

    print(f"\nPendientes de firma de {yo['nombre']}:")
    for i, o in enumerate(pend, 1):
        print(f"  {i:>2}. {o['codigo']:<24} {o['asunto'][:60]}")
    if args.todos:
        elegidos = pend
    else:
        sel = input("\nNúmeros a firmar (ej. 1,3) o 't' para todos [t]: ").strip().lower() or "t"
        elegidos = pend if sel == "t" else [pend[int(x) - 1] for x in re.findall(r"\d+", sel) if 0 < int(x) <= len(pend)]
    if not elegidos:
        return

    signer = None
    if not args.vista_previa:
        signer = cargar_firmante(cfg["certificado_p12"], getpass.getpass("Contraseña del certificado de firma (.p12): "))
        cert = nombre_certificado(signer)
        print(f"Certificado: {cert}")
        apellido = (yo.get("nombre") or "").split()[-1:] or [""]
        if apellido[0] and apellido[0].upper() not in cert.upper():
            if input("⚠ El certificado no parece ser del firmante registrado. ¿Continuar? [s/N]: ").lower() != "s":
                return

    plantillas: dict[str, bytes] = {}
    for o in elegidos:
        cod = o["codigo"]
        print(f"\n▶ {cod}")
        try:
            pid = o["obra_id"]
            if pid not in plantillas:
                plantillas[pid] = s.app("GET", f"/api/oficios?accion=plantilla&obra={pid}").content
            carpeta = Path(cfg["carpeta_local"]) / (o["obras"].get("codigo") or o["obra_id"][:8]) / "oficios"
            carpeta.mkdir(parents=True, exist_ok=True)
            trabajo = Path(tempfile.mkdtemp(prefix="dlv_"))
            docx = trabajo / f"{cod}.docx"
            generar_docx(plantillas[pid], o, yo, docx)
            print("   Word generado desde la plantilla")

            if args.revisar:
                abrir_en_word(docx)
                input("   Revise en Word, GUARDE (mismo nombre), cierre el archivo y presione Enter… ")

            pdf = convertir_pdf(cfg, docx)
            pagina, caja = analizar_pdf(pdf, cod, cfg)
            url = f"{cfg['app_url']}/v/{o['token_verificacion']}"

            if args.vista_previa:
                shutil.copy(docx, carpeta / f"{cod}_VISTA_PREVIA.docx")
                shutil.copy(pdf, carpeta / f"{cod}_VISTA_PREVIA.pdf")
                print(f"   Vista previa en {carpeta}")
                continue

            firmado = trabajo / f"{cod}_firmado.pdf"
            firmar_pdf(cfg, signer, pdf, firmado, o, url, pagina, caja)
            datos = firmado.read_bytes()
            h = hashlib.sha256(datos).hexdigest()
            print(f"   Firmado · SHA-256 {h[:16]}…")

            files = {"pdf": (f"{cod}.pdf", datos, "application/pdf"),
                     "docx": (f"{cod}.docx", docx.read_bytes(),
                              "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
            r = s.app("POST", "/api/oficios?accion=subir",
                      data={"oficio_id": o["id"], "hash": h, "certificado": nombre_certificado(signer)}, files=files).json()
            shutil.copy(firmado, carpeta / f"{cod}.pdf")
            shutil.copy(docx, carpeta / f"{cod}.docx")
            print(f"   ✔ Registrado. Copia local: {carpeta / (cod + '.pdf')}")
            print(f"   QR / verificación: {r.get('verificacion', url)}")
            shutil.rmtree(trabajo, ignore_errors=True)
        except Exception as e:  # noqa: BLE001
            print(f"   ✘ No se firmó {cod}: {e}")

    print("\nListo.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelado.")
    except RuntimeError as e:
        sys.exit(f"Error: {e}")
