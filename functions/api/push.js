// /api/push — avisos en el celular (Web Push, estándar RFC 8291 + VAPID) sin servicios externos.
//   GET  /api/push?accion=clave     -> { clave }  clave pública con la que el celular se suscribe
//   POST /api/push?accion=enviar    (con la sesión de Supabase) -> envía los avisos que generó ese usuario
// Las claves VAPID se crean solas la primera vez y se guardan en R2 (_sistema/vapid.json); nunca salen del servidor.
const CLAVES = "_sistema/vapid.json";

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const desdeB64u = (s) => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const unir = (...partes) => { const n = partes.reduce((a, p) => a + p.length, 0), r = new Uint8Array(n); let i = 0; for (const p of partes) { r.set(p, i); i += p.length; } return r; };
const txt = (s) => new TextEncoder().encode(s);
const err = (status, error) => Response.json({ error }, { status });

async function hmac(clave, datos) {
  const k = await crypto.subtle.importKey("raw", clave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, datos));
}

export async function clavesVapid(env) {
  const obj = await env.FOTOS.get(CLAVES);
  if (obj) return JSON.parse(await obj.text());
  const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const priv = await crypto.subtle.exportKey("jwk", par.privateKey);
  const pub = b64u(await crypto.subtle.exportKey("raw", par.publicKey));
  await env.FOTOS.put(CLAVES, JSON.stringify({ priv, pub }), { httpMetadata: { contentType: "application/json" } });
  const leido = await env.FOTOS.get(CLAVES);   // si dos llamadas crearon claves a la vez, gana la que quedó guardada
  return JSON.parse(await leido.text());
}

async function jwtVapid(claves, endpoint, sujeto) {
  const aud = new URL(endpoint).origin;
  const cab = b64u(txt(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const cue = b64u(txt(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: sujeto })));
  const k = await crypto.subtle.importKey("jwk", claves.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, txt(cab + "." + cue));
  return cab + "." + cue + "." + b64u(firma);
}

// Cifra el contenido para un celular (aes128gcm, RFC 8188 + RFC 8291)
export async function cifrar(texto, p256dh, authSecreto) {
  const uaPub = desdeB64u(p256dh), auth = desdeB64u(authSecreto);
  const efimera = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", efimera.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, efimera.privateKey, 256));
  const prkClave = await hmac(auth, compartido);
  const ikm = await hmac(prkClave, unir(txt("WebPush: info\0"), uaPub, asPub, new Uint8Array([1])));
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(sal, ikm);
  const cek = (await hmac(prk, unir(txt("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, unir(txt("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, unir(txt(texto), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // 4096
  return unir(sal, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}

export async function enviarUno(claves, sujeto, s, contenido) {
  const cuerpo = await cifrar(JSON.stringify(contenido), s.p256dh, s.auth);
  const jwt = await jwtVapid(claves, s.endpoint, sujeto);
  const r = await fetch(s.endpoint, {
    method: "POST",
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high", Authorization: `vapid t=${jwt}, k=${claves.pub}` },
    body: cuerpo,
  });
  return r.status;
}

export async function onRequestGet({ request, env }) {
  if (!env.FOTOS) return err(500, "Falta el vínculo FOTOS al bucket R2");
  if (new URL(request.url).searchParams.get("accion") !== "clave") return err(400, "Acción inválida");
  const c = await clavesVapid(env);
  return Response.json({ clave: c.pub }, { headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  if (!env.FOTOS) return err(500, "Falta el vínculo FOTOS al bucket R2");
  if (new URL(request.url).searchParams.get("accion") !== "enviar") return err(400, "Acción inválida");
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return err(401, "Inicia sesión");
  const rpc = (fn, cuerpo) => fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) });
  const r = await rpc("push_pendientes");
  if (!r.ok) return err(r.status === 401 ? 401 : 502, "No se pudieron leer los avisos");
  const lista = await r.json();
  if (!Array.isArray(lista) || !lista.length) return Response.json({ enviados: 0 });
  const claves = await clavesVapid(env);
  const sujeto = new URL(request.url).origin;    // Apple exige un contacto: la dirección de la plataforma
  let enviados = 0; const caducados = [];
  await Promise.all(lista.map(async (a) => {
    try {
      const st = await enviarUno(claves, sujeto, a, { titulo: a.titulo, cuerpo: a.cuerpo, url: a.url });
      if (st >= 200 && st < 300) enviados++;
      else if (st === 404 || st === 410) caducados.push(a.endpoint);
    } catch (_) {}
  }));
  if (caducados.length) await rpc("push_quitar", { p_endpoints: caducados });
  return Response.json({ enviados, fallidos: lista.length - enviados });
}
