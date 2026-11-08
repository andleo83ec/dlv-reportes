// Modelos IFC de obra guardados en Cloudflare R2 (mismo vínculo "FOTOS" al bucket dlv-fotos).
// Solo responde a usuarios con sesión en Supabase y con acceso a la obra (lo decide RLS).
//
//   POST /api/modelos?obra=<id>             cuerpo: IFC (texto) o IFC comprimido (gzip)  -> { key, size }
//   GET  /api/modelos?obra=<id>&key=<key>                                                 -> el archivo
//
// Las dos llamadas llevan el encabezado  Authorization: Bearer <token de Supabase>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 95 * 1024 * 1024; // límite de subida de Cloudflare Pages: 100 MB

const err = (status, error) => Response.json({ error }, { status });

async function puedeVerObra(env, token, obraId) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/obras?select=id&id=eq.${obraId}`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return false;
  const filas = await r.json();
  return Array.isArray(filas) && filas.length === 1;
}

async function validar(request, env) {
  if (!env.FOTOS) return { res: err(500, "Falta el vínculo FOTOS al bucket R2 (paso 4 de la guía)") };
  const url = new URL(request.url);
  const obraId = url.searchParams.get("obra") || "";
  if (!UUID.test(obraId)) return { res: err(400, "Obra inválida") };
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { res: err(401, "Inicia sesión") };
  if (!(await puedeVerObra(env, token, obraId))) return { res: err(403, "No tienes acceso a esta obra o tu sesión venció") };
  return { url, obraId };
}

export async function onRequestPost({ request, env }) {
  const v = await validar(request, env);
  if (v.res) return v.res;
  const tipo = (request.headers.get("Content-Type") || "").split(";")[0].trim();
  const gz = tipo === "application/gzip";
  if (!gz && tipo !== "application/octet-stream" && tipo !== "text/plain") return err(415, "Envía el IFC como texto o comprimido (gzip)");
  const largo = Number(request.headers.get("Content-Length") || 0);
  if (largo > MAX_BYTES) return err(413, "El modelo pesa más de 95 MB");

  const key = `obras/${v.obraId}/modelos/${crypto.randomUUID()}.ifc${gz ? ".gz" : ""}`;
  const obj = await env.FOTOS.put(key, request.body, { httpMetadata: { contentType: gz ? "application/gzip" : "application/octet-stream" } });
  if (!obj || obj.size > MAX_BYTES) {
    if (obj) await env.FOTOS.delete(key);
    return err(413, "El modelo pesa más de 95 MB");
  }
  return Response.json({ key, size: obj.size });
}

export async function onRequestGet({ request, env }) {
  const v = await validar(request, env);
  if (v.res) return v.res;
  const key = v.url.searchParams.get("key") || "";
  if (!key.startsWith(`obras/${v.obraId}/modelos/`) || key.includes("..")) return err(400, "Modelo inválido");
  const obj = await env.FOTOS.get(key);
  if (!obj) return err(404, "Modelo no encontrado");
  return new Response(obj.body, {
    headers: {
      "Content-Type": key.endsWith(".gz") ? "application/gzip" : "application/octet-stream",
      "Cache-Control": "private, max-age=604800, immutable",
    },
  });
}
