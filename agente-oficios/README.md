# Agente de firma de oficios · Plataforma DLV

Programa para la computadora de cada **firmante**. Toma los oficios emitidos en `/oficios` que esperan su firma,
los arma con la plantilla Word de la obra, los convierte a PDF, los firma con su certificado de **Security Data**
(PAdES, con pyHanko) poniendo el sello con **código QR**, y los sube a la plataforma.
Su archivo `.p12` y su contraseña **no salen de su computadora**.

## Instalación (una vez)

1. Instale **Python 3.11+** (en Windows marque *Add Python to PATH*).
2. Copie esta carpeta a su computadora y, dentro de ella, ejecute:
   ```
   pip install -r requirements.txt
   ```
3. Copie `config.ejemplo.json` como `config.json` y complete:
   - `supabase_anon_key`: la `SUPABASE_ANON_KEY` que está en `wrangler.toml` (es pública).
   - `app_url`: la dirección de la plataforma DLV.
   - `email`: su correo de la plataforma.
   - `certificado_p12`: la ruta de su firma electrónica `.p12`.
4. Para pasar a PDF usa **Microsoft Word** si está instalado (mejor fidelidad); si no, **LibreOffice**.

`config.json` y los `.p12` están excluidos de Git: **no los suba nunca al repositorio**.

## Uso

Doble clic en `firmar.bat` (Windows) o:
```
python agente_firma.py                 # lista sus pendientes y pregunta cuáles firmar
python agente_firma.py --todos         # firma todos
python agente_firma.py --revisar       # abre cada oficio en Word antes de firmar
python agente_firma.py --vista-previa  # solo genera el PDF, sin firmar (para probar la plantilla)
```
Le pide la contraseña de la plataforma y la del certificado. Al terminar, el oficio aparece como **Firmado** en `/oficios`
con su PDF, su Word y el QR, y queda una copia en `carpeta_local`.

## Plantilla Word

`plantilla_oficio_dlv.docx` se sube en **Oficios → Configuración** (general o por obra). Se puede rediseñar en Word manteniendo
los campos `{{ codigo }}`, `{{ ciudad_fecha }}`, `{{ destinatario_nombre }}`, `{{ asunto }}`, el bloque
`{%p for p in parrafos %}{{ p }}{%p endfor %}`, `{{ firmante_nombre }}`, `{{ firmante_cargo }}`… y el texto blanco **FIRMA_AQUI**,
donde se pone el sello de firma con el QR (deje unos 2,5 cm libres debajo). `generar_plantilla.py` regenera la plantilla base.

## Problemas frecuentes

- **El certificado no abre con la contraseña correcta:** algunos `.p12` usan cifrado antiguo. Conviértalo una vez:
  `openssl pkcs12 -in firma.p12 -legacy -nodes -out temp.pem` y `openssl pkcs12 -export -in temp.pem -out firma_nueva.p12`;
  use `firma_nueva.p12` y **borre `temp.pem` enseguida** (tiene la clave sin protección).
- **Sello de tiempo:** si Security Data le da una URL de sellado de tiempo (TSA), póngala en `tsa_url`.
- **Validar la firma:** el PDF se valida en FirmaEC o en Adobe Acrobat; la página del QR compara además la huella SHA‑256.
