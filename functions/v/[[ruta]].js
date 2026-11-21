// Página pública de verificación de oficios (destino del código QR).
//   GET /v/<token>       datos del oficio, estado y huella SHA-256 (sin iniciar sesión)
//   GET /v/<token>/pdf   PDF firmado (se desactiva con la variable VERIFICACION_PDF_PUBLICO = "no")
// Lee con la función pública verificar_oficio() de Supabase: no expone nada más del sistema.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function buscar(env, token) {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/verificar_oficio`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token }),
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows && rows[0] ? rows[0] : null;
}

export async function onRequestGet({ env, params }) {
  const partes = Array.isArray(params.ruta) ? params.ruta : String(params.ruta || "").split("/").filter(Boolean);
  const token = String(partes[0] || "").toLowerCase();
  const o = await buscar(env, token);
  const pdfPublico = env.VERIFICACION_PDF_PUBLICO !== "no";

  if (partes[1] === "pdf") {
    if (!o || !o.pdf_key || !pdfPublico || !env.FOTOS) return new Response("No disponible", { status: 404 });
    const obj = await env.FOTOS.get(o.pdf_key);
    if (!obj) return new Response("No disponible", { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${o.codigo}.pdf"`, "Cache-Control": "private, max-age=600" } });
  }
  if (!o) return pagina("Oficio no encontrado", `<div class="estado anul">NO ENCONTRADO</div><p>Este código no corresponde a un oficio emitido por DLV Construcciones.</p>`, 404);

  const EST = { firmado: ["VÁLIDO · FIRMADO ELECTRÓNICAMENTE", "ok"], pendiente_firma: ["EMITIDO · PENDIENTE DE FIRMA", "pend"], anulado: ["ANULADO", "anul"] };
  const [txt, cls] = EST[o.estado] || [o.estado, "pend"];
  const fecha = (d) => d ? new Date(d).toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "long", timeStyle: "short" }) : "—";
  const fila = (k, v, c = "") => v ? `<dt>${k}</dt><dd${c ? ` class="${c}"` : ""}>${esc(v)}</dd>` : "";
  return pagina(o.codigo, `
    <div class="estado ${cls}">${txt}</div>
    <h1>${esc(o.codigo)}</h1>
    <dl>
      ${fila("Obra", o.obra)}${fila("Asunto", o.asunto)}${fila("Dirigido a", o.destinatario)}
      ${fila("Fecha de emisión", o.fecha_emision ? new Date(o.fecha_emision + "T12:00:00").toLocaleDateString("es-EC", { dateStyle: "long" }) : "")}
      ${fila("Firmado por", [o.firmante, o.firmante_cargo].filter(Boolean).join(" — "))}
      ${o.firmado_en ? `<dt>Fecha de firma</dt><dd>${fecha(o.firmado_en)}</dd>` : ""}
      ${fila("Certificado", o.certificado)}${fila("Motivo de anulación", o.motivo_anulacion)}${fila("Huella SHA-256", o.hash_sha256, "hash")}
    </dl>
    ${o.pdf_key && pdfPublico ? `<a class="btn" href="/v/${token}/pdf">Ver el PDF firmado</a>` : ""}
    ${o.hash_sha256 ? `<div class="comp"><h2>Comprobar una copia</h2>
      <p>Elija el PDF que recibió. Se compara en su dispositivo con la huella registrada; el archivo no se envía.</p>
      <input type="file" id="f" accept="application/pdf"><p id="res"></p></div>
      <script>document.getElementById('f').onchange=async(e)=>{const f=e.target.files[0];if(!f)return;
      const h=await crypto.subtle.digest('SHA-256',await f.arrayBuffer());const x=[...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');
      const ok=x==='${o.hash_sha256}',r=document.getElementById('res');r.className=ok?'ok-t':'anul-t';
      r.textContent=ok?'✓ El archivo es idéntico al oficio registrado.':'✗ El archivo no coincide: fue modificado o es otro documento.';};</script>` : ""}
    <p class="nota">La firma electrónica también se puede validar en FirmaEC o en Adobe Acrobat.</p>`);
}

function pagina(titulo, cuerpo, status = 200) {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · Verificación DLV</title><link rel="icon" type="image/png" href="/icon-192.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>
:root{--ink:#18181b;--muted:#6b6b72;--line:#e4e4e7;--bg:#f4f4f5;--card:#fff;--navy:#3a3d40}
@media (prefers-color-scheme:dark){:root{--ink:#ececef;--muted:#a1a1aa;--line:#2e2e33;--bg:#111113;--card:#19191c;--navy:#26292c}}
body{margin:0;font-family:Inter,Arial,sans-serif;background:var(--bg);color:var(--ink)}
header{background:var(--navy);color:#fff;padding:14px 20px;font-weight:600;letter-spacing:.02em}
header b{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:8px;background:#fff;color:#3a3d40;margin-right:10px;font-size:.8rem}
main{max-width:640px;margin:20px auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}
h1{font-size:1.5rem;margin:10px 0 14px;letter-spacing:-.02em}h2{font-size:1rem;margin:0 0 6px}
dl{display:grid;grid-template-columns:150px 1fr;gap:8px 12px;font-size:.95rem}dt{color:var(--muted)}dd{margin:0}
.hash{font-family:ui-monospace,Menlo,monospace;font-size:.78rem;word-break:break-all}
.estado{display:inline-block;padding:5px 10px;border-radius:99px;font-size:.78rem;font-weight:700;letter-spacing:.03em}
.ok{background:#e3f1e6;color:#1e6b34}.pend{background:#fff4d6;color:#8a6100}.anul{background:#fbe3e3;color:#9b1c1c}
.ok-t{color:#1e6b34;font-weight:600}.anul-t{color:#b42323;font-weight:600}
.btn{display:inline-block;margin-top:16px;background:var(--ink);color:var(--card);padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:500}
.comp{margin-top:22px;padding-top:16px;border-top:1px solid var(--line);font-size:.9rem}
.nota{color:var(--muted);font-size:.82rem;margin-top:20px}
@media(max-width:520px){dl{grid-template-columns:1fr}dt{margin-top:6px}main{margin:12px;padding:16px}}
</style></head><body><header><b>DLV</b>Verificación de oficios · DLV Construcciones</header><main>${cuerpo}</main></body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
