// Puente entre la plataforma y el servicio de integraciones (Worker "dlv-integraciones": facturas del SRI y WhatsApp).
//   /api/integra/<ruta>  →  <Worker>/api/<ruta>   (se reenvía el encabezado Authorization con la sesión de Supabase)
// Configúralo en Cloudflare Pages → Settings → Bindings → Service binding: nombre INTEGRACIONES → Worker dlv-integraciones.
// (Alternativa: variable INTEGRACIONES_URL con la dirección del Worker, p. ej. https://dlv-integraciones.<cuenta>.workers.dev)
export async function onRequest({ request, env, params }) {
  const ruta = [].concat(params.ruta || []).join("/");
  if (!/^[\w./-]*$/.test(ruta) || ruta.includes("..")) return Response.json({ error: "Ruta inválida" }, { status: 400 });
  const q = new URL(request.url).search;
  const init = { method: request.method, headers: { Authorization: request.headers.get("Authorization") || "", "Content-Type": request.headers.get("Content-Type") || "application/json" } };
  if (!["GET", "HEAD"].includes(request.method)) init.body = await request.arrayBuffer();
  if (env.INTEGRACIONES && env.INTEGRACIONES.fetch) return env.INTEGRACIONES.fetch(new Request("https://integraciones/api/" + ruta + q, init));
  if (env.INTEGRACIONES_URL) return fetch(env.INTEGRACIONES_URL.replace(/\/$/, "") + "/api/" + ruta + q, init);
  return Response.json({ error: "no_configurado", mensaje: "Falta conectar el servicio de integraciones (facturas del SRI y WhatsApp)." }, { status: 503 });
}
