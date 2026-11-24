// Service worker de la app DLV:
//  · abre rápido y funciona con mala señal: primero intenta la red y, si no hay, muestra lo último guardado;
//  · guarda lo último que se leyó de la base para consultarlo sin conexión (no permite guardar cambios sin red);
//  · muestra los avisos (notificaciones) y al tocarlos abre la pantalla que corresponde.
const APP = "dlv-app-v1", DATOS = "dlv-datos-v1", LIBS = "dlv-libs-v1";
const ESPERA_RED = 6000;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(APP).then((c) => c.addAll(["/", "/styles.css", "/tema.css", "/nav.js", "/manifest.json", "/icon-192.png"]).catch(() => {})));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![APP, DATOS, LIBS].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

function conTiempo(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("lento")), ms))]); }

async function redPrimero(req, cache, clave) {
  const c = await caches.open(cache);
  try {
    const r = await conTiempo(fetch(req), ESPERA_RED);
    if (r && r.ok) c.put(clave || req, r.clone());
    return r;
  } catch (e) {
    const g = await c.match(clave || req, { ignoreVary: true });
    if (g) return g;
    throw e;
  }
}
async function cachePrimero(req) {
  const c = await caches.open(LIBS), g = await c.match(req);
  if (g) return g;
  const r = await fetch(req);
  if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone());
  return r;
}
const SIN_RED = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexión · DLV</title><body style="font-family:system-ui;background:#f4f4f5;color:#18181b;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px;text-align:center">
<div><div style="width:56px;height:56px;border-radius:14px;background:#18181b;color:#fff;display:grid;place-items:center;font-weight:800;margin:0 auto 14px">DLV</div>
<h1 style="font-size:1.3rem;margin:0 0 6px">Sin conexión</h1><p style="color:#71717a;margin:0 0 16px">Esta pantalla todavía no se abrió con internet en este teléfono.</p>
<button onclick="location.reload()" style="border:0;background:#18181b;color:#fff;border-radius:10px;padding:10px 16px;font:inherit">Reintentar</button></div>`;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v/") || url.pathname === "/sw.js") return;
    if (req.mode === "navigate") {
      e.respondWith(redPrimero(req, APP, url.pathname.replace(/\.html$/, "") || "/")
        .catch(() => new Response(SIN_RED, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
      return;
    }
    e.respondWith(redPrimero(req, APP).catch(() => Response.error()));
    return;
  }
  // Lecturas de la base (Supabase): lo último leído queda disponible sin conexión
  if (url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/rest/v1/")) {
    e.respondWith(redPrimero(req, DATOS, req.url).catch(() => Response.error()));
    return;
  }
  // Librerías y letras: no cambian (tienen versión en la dirección)
  if (/(^|\.)(jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)$/.test(url.hostname)) {
    e.respondWith(cachePrimero(req).catch(() => Response.error()));
  }
});

self.addEventListener("message", (e) => {
  if (e.data === "limpiar-datos") e.waitUntil(caches.delete(DATOS));   // al cerrar sesión
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { cuerpo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || "DLV", {
    body: d.cuerpo || "", icon: "/icon-192.png", badge: "/badge-96.png", data: { url: d.url || "/" }, tag: d.url || "dlv",
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of abiertas) { if ("focus" in c) { await c.focus(); if ("navigate" in c) return c.navigate(destino); return; } }
    return self.clients.openWindow(destino);
  })());
});
