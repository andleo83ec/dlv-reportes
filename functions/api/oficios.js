// Oficios: redacción con Claude, plantilla Word, archivos firmados en R2 (vínculo "FOTOS").
// Todas las llamadas llevan  Authorization: Bearer <token de Supabase>  y se validan con las reglas RLS
// del propio usuario (no se usa la clave de servicio).
//
//   POST /api/oficios?accion=redactar                     JSON {obra, modo, idea, cuerpo, destinatario, cargo, institucion, asunto, referencia, elementos, tono}
//   GET  /api/oficios?accion=plantilla&obra=<id>          → plantilla .docx de la obra (o la general)
//   POST /api/oficios?accion=plantilla&obra=<id>|general=1   cuerpo: el .docx  (solo administradores)
//   GET  /api/oficios?accion=archivo&id=<oficio>&tipo=pdf|docx
//   POST /api/oficios?accion=subir                        multipart: oficio_id, pdf, docx, hash, certificado  (agente de firma)
//
// Variables: SUPABASE_URL, SUPABASE_ANON_KEY; secreto ANTHROPIC_API_KEY; opcional ANTHROPIC_MODEL (por defecto claude-sonnet-5-5)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PLANTILLA_GENERAL = "plantillas/plantilla_oficio_dlv.docx";
const plantillaObra = (obra) => `obras/${obra}/oficios/plantilla.docx`;
const err = (status, error) => Response.json({ error }, { status });
const token = (request) => (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

async function rest(env, tok, path, init = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (_) { data = txt; }
  if (!r.ok) throw Object.assign(new Error((data && data.message) || `Supabase ${r.status}`), { status: r.status });
  return data;
}
async function usuario(env, tok) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}` } });
  return r.ok ? r.json() : null;
}
const esAdmin = async (env, tok) => (await rest(env, tok, "rpc/es_admin", { method: "POST", body: "{}" }).catch(() => false)) === true;
// La obra solo se devuelve si el usuario es administrador o miembro (regla RLS de obras)
async function obraVisible(env, tok, id) {
  if (!UUID.test(id || "")) return null;
  const rows = await rest(env, tok, `obras?select=id,nombre,cliente,ubicacion,codigo,ciudad&id=eq.${id}`);
  return rows && rows[0] ? rows[0] : null;
}
async function oficioVisible(env, tok, id) {
  if (!UUID.test(id || "")) return null;
  const rows = await rest(env, tok, `oficios?select=*&id=eq.${id}`);
  return rows && rows[0] ? rows[0] : null;
}
async function sha256(buf) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SISTEMA = `Eres el asistente de redacción de oficios de DLV Construcciones Cía. Ltda., constructora de Cuenca, Ecuador.
Redactas oficios formales de obra para clientes, fiscalizadores, municipio (GAD), proveedores, subcontratistas y consultores.
Reglas:
- Español formal de Ecuador, tratamiento de "usted", claro y técnico, sin adornos.
- Devuelve SOLO los párrafos del cuerpo. NO incluyas lugar ni fecha, número, destinatario, asunto, saludo ("De mi consideración"), despedida ("Atentamente") ni firma: la plantilla ya los tiene.
- Primer párrafo: saludo breve y el motivo. Luego el detalle (antecedentes, solicitud, plazos, cantidades, planos, planillas o contrato si se mencionan). Último párrafo: cierre cordial pidiendo atención o respuesta.
- No inventes cifras, fechas, nombres, números de contrato ni normas. Si falta un dato esencial, deja un marcador entre corchetes, por ejemplo [fecha de entrega].
- Separa los párrafos con una línea en blanco. Sin viñetas salvo que se pida una lista. Sin markdown. Entre 2 y 5 párrafos.`;

async function redactar(request, env, tok) {
  if (!env.ANTHROPIC_API_KEY) return err(500, "Falta configurar ANTHROPIC_API_KEY en Cloudflare");
  let d; try { d = await request.json(); } catch (_) { return err(400, "Datos inválidos"); }
  const ob = await obraVisible(env, tok, d.obra);
  if (!ob) return err(403, "Sin acceso a esta obra");
  const c = (s, n = 400) => String(s || "").slice(0, n);
  const datos = [
    `Obra: ${ob.nombre} — Cliente: ${ob.cliente || ""} — Ubicación: ${ob.ubicacion || ""}`,
    `Destinatario: ${c(d.destinatario)} — Cargo: ${c(d.cargo)} — Institución: ${c(d.institucion)}`,
    `Asunto: ${c(d.asunto)}`, d.referencia ? `Referencia: ${c(d.referencia)}` : "",
    d.elementos ? `Elementos del modelo 3D (IFC) a los que se refiere: ${c(d.elementos, 600)}` : "",
    `Tono: ${["firme", "cordial", "urgente"].includes(d.tono) ? d.tono : "formal estándar"}`,
  ].filter(Boolean).join("\n");
  const pedido = d.modo === "mejorar"
    ? `${datos}\n\nMejora la redacción de este cuerpo de oficio sin cambiar datos ni sentido. Corrige ortografía y estilo:\n\n${c(d.cuerpo, 8000)}`
    : `${datos}\n\nIdea o instrucciones del usuario:\n${c(d.idea, 4000)}\n\nRedacta el cuerpo del oficio.`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 1500, system: SISTEMA, messages: [{ role: "user", content: pedido }] }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return err(502, (out.error && out.error.message) || "Claude no respondió");
  return Response.json({ cuerpo: (out.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n").trim() });
}

async function bajarPlantilla(url, env, tok) {
  const obra = url.searchParams.get("obra") || "";
  if (!(await obraVisible(env, tok, obra))) return err(403, "Sin acceso a esta obra");
  const obj = (await env.FOTOS.get(plantillaObra(obra))) || (await env.FOTOS.get(PLANTILLA_GENERAL));
  if (!obj) return err(404, "No hay plantilla cargada. Un administrador debe subirla en Oficios → Configuración.");
  return new Response(obj.body, { headers: { "Content-Type": DOCX, "Content-Disposition": 'attachment; filename="plantilla_oficio.docx"' } });
}

async function subirPlantilla(request, url, env, tok) {
  if (!(await esAdmin(env, tok))) return err(403, "Solo un administrador puede cambiar la plantilla");
  const general = url.searchParams.get("general") === "1", obra = url.searchParams.get("obra") || "";
  if (!general && !UUID.test(obra)) return err(400, "Obra inválida");
  const buf = await request.arrayBuffer();
  const u8 = new Uint8Array(buf.slice(0, 2));
  if (u8[0] !== 0x50 || u8[1] !== 0x4b) return err(400, "La plantilla debe ser un archivo Word .docx");
  if (buf.byteLength > 10 * 1024 * 1024) return err(413, "La plantilla pesa más de 10 MB");
  const key = general ? PLANTILLA_GENERAL : plantillaObra(obra);
  await env.FOTOS.put(key, buf, { httpMetadata: { contentType: DOCX } });
  return Response.json({ ok: true, key });
}

async function archivo(url, env, tok) {
  const o = await oficioVisible(env, tok, url.searchParams.get("id"));
  if (!o) return err(404, "Oficio no encontrado");
  const tipo = url.searchParams.get("tipo") === "docx" ? "docx" : "pdf";
  const key = tipo === "pdf" ? o.pdf_key : o.docx_key;
  if (!key) return err(404, "El archivo aún no existe");
  const obj = await env.FOTOS.get(key);
  if (!obj) return err(404, "Archivo no encontrado");
  return new Response(obj.body, {
    headers: {
      "Content-Type": tipo === "pdf" ? "application/pdf" : DOCX,
      "Content-Disposition": `${url.searchParams.get("descargar") ? "attachment" : "inline"}; filename="${o.codigo}.${tipo}"`,
      "Cache-Control": "private, max-age=600",
    },
  });
}

async function subir(request, env, tok) {
  const u = await usuario(env, tok);
  if (!u) return err(401, "Inicia sesión");
  const form = await request.formData();
  const o = await oficioVisible(env, tok, String(form.get("oficio_id") || ""));
  if (!o) return err(404, "Oficio no encontrado");
  if (o.estado !== "pendiente_firma") return err(409, `El oficio está "${o.estado}"`);
  if (o.firmante_id !== u.id) return err(403, "Usted no es el firmante asignado de este oficio");
  const pdf = form.get("pdf"), docx = form.get("docx");
  if (!pdf || typeof pdf === "string") return err(400, "Falta el PDF firmado");
  const buf = await pdf.arrayBuffer();
  if (new TextDecoder().decode(buf.slice(0, 5)) !== "%PDF-") return err(400, "El archivo no es un PDF");
  if (buf.byteLength > 25 * 1024 * 1024) return err(413, "El PDF pesa más de 25 MB");
  const hash = await sha256(buf), hashCliente = String(form.get("hash") || "").toLowerCase();
  if (hashCliente && hashCliente !== hash) return err(422, "El archivo se alteró en el envío: vuelva a intentarlo");

  const base = `obras/${o.obra_id}/oficios/${o.codigo}`, pdfKey = base + ".pdf";
  if (await env.FOTOS.head(pdfKey)) return err(409, "Ya existe un PDF firmado con este código");
  await env.FOTOS.put(pdfKey, buf, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { sha256: hash, oficio: o.id, firmante: u.id } });
  let docxKey = "";
  if (docx && typeof docx !== "string") { docxKey = base + ".docx"; await env.FOTOS.put(docxKey, await docx.arrayBuffer(), { httpMetadata: { contentType: DOCX } }); }
  try {
    await rest(env, tok, "rpc/registrar_firma_oficio", { method: "POST",
      body: JSON.stringify({ p_oficio: o.id, p_pdf_key: pdfKey, p_docx_key: docxKey, p_hash: hash, p_cert: String(form.get("certificado") || "").slice(0, 300) }) });
  } catch (e) {
    await env.FOTOS.delete(pdfKey); if (docxKey) await env.FOTOS.delete(docxKey);
    return err(500, "No se pudo registrar la firma: " + e.message);
  }
  const origen = new URL(request.url).origin;
  return Response.json({ ok: true, codigo: o.codigo, hash, verificacion: `${origen}/v/${o.token_verificacion}` });
}

async function atender(request, env) {
  if (!env.FOTOS) return err(500, "Falta el vínculo FOTOS al bucket R2");
  const tok = token(request); if (!tok) return err(401, "Inicia sesión");
  const url = new URL(request.url), accion = url.searchParams.get("accion");
  try {
    if (request.method === "POST" && accion === "redactar") return await redactar(request, env, tok);
    if (request.method === "GET" && accion === "plantilla") return await bajarPlantilla(url, env, tok);
    if (request.method === "POST" && accion === "plantilla") return await subirPlantilla(request, url, env, tok);
    if (request.method === "GET" && accion === "archivo") return await archivo(url, env, tok);
    if (request.method === "POST" && accion === "subir") return await subir(request, env, tok);
    return err(400, "Acción no válida");
  } catch (e) {
    return err(e.status === 401 ? 401 : 500, e.status === 401 ? "La sesión venció: vuelva a iniciar sesión" : String(e.message || e));
  }
}
export const onRequestGet = ({ request, env }) => atender(request, env);
export const onRequestPost = ({ request, env }) => atender(request, env);
