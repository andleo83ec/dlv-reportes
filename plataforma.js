// DLV Plataforma como Worker de Cloudflare (pantallas de public/ + funciones de functions/api/).
// Hace lo mismo que Cloudflare Pages: sirve los archivos de public/ y atiende /api/… con las mismas funciones.
// Se despliega desde Cloudflare → Workers & Pages → Create application → Connect GitHub → dlv-reportes (carpeta raíz).
import * as config from "./functions/api/config.js";
import * as documentos from "./functions/api/documentos.js";
import * as fotos from "./functions/api/fotos.js";
import * as modelos from "./functions/api/modelos.js";
import * as integra from "./functions/api/integra/[[ruta]].js";

const rutas = { "/api/config": config, "/api/documentos": documentos, "/api/fotos": fotos, "/api/modelos": modelos };

function manejador(mod, metodo) {
  const m = metodo.charAt(0) + metodo.slice(1).toLowerCase();
  return mod["onRequest" + m] || mod.onRequest || (metodo === "HEAD" && mod.onRequestGet) || null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    let mod = null, params = {};
    if (rutas[p]) mod = rutas[p];
    else if (p === "/api/integra" || p.startsWith("/api/integra/")) { mod = integra; params = { ruta: p.slice("/api/integra/".length).split("/").filter(Boolean) }; }
    if (mod) {
      const h = manejador(mod, request.method);
      if (!h) return new Response("Método no permitido", { status: 405 });
      try { return await h({ request, env, params, waitUntil: (x) => ctx.waitUntil(x), next: () => env.ASSETS.fetch(request) }); }
      catch (e) { return Response.json({ error: String((e && e.message) || e) }, { status: 500 }); }
    }
    if (p.startsWith("/api/")) return Response.json({ error: "Ruta no encontrada" }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
