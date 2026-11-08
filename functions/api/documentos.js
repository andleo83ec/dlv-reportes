// Archivos del control de documentos (procedimientos, formatos, manuales) en Cloudflare R2, mismo vínculo "FOTOS".
// Leer: cualquier usuario con sesión. Subir: solo administradores (lo responde la función es_admin() de Supabase).
//
//   POST /api/documentos?doc=<id>&nombre=<archivo.pdf>    cuerpo: el archivo           -> { key, size }
//   GET  /api/documentos?key=<key>[&descargar=1]                                        -> el archivo
//
// Las dos llamadas llevan el encabezado  Authorization: Bearer <token de Supabase>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 95 * 1024 * 1024;
const err = (status, error) => Response.json({ error }, { status });
const token = (request) => (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

async function sesionValida(env, tok) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}` } });
  return r.ok;
}
async function esAdmin(env, tok) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/es_admin`, {
    method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: "{}",
  });
  return r.ok && (await r.json()) === true;
}
const limpio = (n) => String(n || "archivo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-90) || "archivo";

export async function onRequestPost({ request, env }) {
  if (!env.FOTOS) return err(500, "Falta el vínculo FOTOS al bucket R2");
  const url = new URL(request.url), doc = url.searchParams.get("doc") || "";
  if (!UUID.test(doc)) return err(400, "Documento inválido");
  const tok = token(request); if (!tok) return err(401, "Inicia sesión");
  if (!(await esAdmin(env, tok))) return err(403, "Solo un administrador puede subir documentos");
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BYTES) return err(413, "El archivo pesa más de 95 MB");
  const tipo = (request.headers.get("Content-Type") || "application/octet-stream").split(";")[0].trim();
  const key = `documentos/${doc}/${crypto.randomUUID()}-${limpio(url.searchParams.get("nombre"))}`;
  const obj = await env.FOTOS.put(key, request.body, { httpMetadata: { contentType: tipo } });
  if (!obj || obj.size > MAX_BYTES) { if (obj) await env.FOTOS.delete(key); return err(413, "El archivo pesa más de 95 MB"); }
  return Response.json({ key, size: obj.size });
}

export async function onRequestGet({ request, env }) {
  if (!env.FOTOS) return err(500, "Falta el vínculo FOTOS al bucket R2");
  const url = new URL(request.url), key = url.searchParams.get("key") || "";
  if (!/^documentos\/[0-9a-f-]{36}\/[\w.\- -]+$/i.test(key) || key.includes("..")) return err(400, "Archivo inválido");
  const tok = token(request);
  if (!tok || !(await sesionValida(env, tok))) return err(401, "Inicia sesión");
  const obj = await env.FOTOS.get(key);
  if (!obj) return err(404, "Archivo no encontrado");
  const nombre = key.split("/").pop().replace(/^[0-9a-f-]{36}-/i, "");
  return new Response(obj.body, {
    headers: {
      "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream",
      "Content-Disposition": `${url.searchParams.get("descargar") ? "attachment" : "inline"}; filename="${nombre}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
