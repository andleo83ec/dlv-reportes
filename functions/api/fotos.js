// Fotos de obra guardadas en Cloudflare R2 (vínculo "FOTOS" al bucket dlv-fotos).
// Solo responde a usuarios con sesión en Supabase y con acceso a la obra (lo decide RLS).
//
//   POST /api/fotos?obra=<id>             cuerpo: JPEG  -> { key }
//   GET  /api/fotos?obra=<id>&key=<key>                 -> la imagen
//
// Las dos llamadas llevan el encabezado  Authorization: Bearer <token de Supabase>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB por foto (la app las comprime a ~250 KB)

const err = (status, error) => Response.json({ error }, { status });

// Pregunta a Supabase, como el usuario, si puede ver la obra. Token inválido o sin acceso -> false.
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
  const tipo = request.headers.get("Content-Type") || "";
  if (tipo !== "image/jpeg") return err(415, "Solo se aceptan fotos JPEG");
  const largo = Number(request.headers.get("Content-Length") || 0);
  if (largo > MAX_BYTES) return err(413, "La foto pesa más de 5 MB");

  const d = new Date();
  const key = `obras/${v.obraId}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.jpg`;
  const obj = await env.FOTOS.put(key, request.body, { httpMetadata: { contentType: "image/jpeg" } });
  if (!obj || obj.size > MAX_BYTES) {
    if (obj) await env.FOTOS.delete(key);
    return err(413, "La foto pesa más de 5 MB");
  }
  return Response.json({ key });
}

export async function onRequestGet({ request, env }) {
  const v = await validar(request, env);
  if (v.res) return v.res;
  const key = v.url.searchParams.get("key") || "";
  if (!key.startsWith(`obras/${v.obraId}/`) || key.includes("..")) return err(400, "Foto inválida");
  const obj = await env.FOTOS.get(key);
  if (!obj) return err(404, "Foto no encontrada");
  return new Response(obj.body, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
}
