// Barra lateral común de la plataforma DLV (estilo CRM).
// En escritorio queda fija a la izquierda; en celular y tablet se abre como cajón desde el botón "Menú DLV".
// Solo aparece con la sesión iniciada (cuando la página muestra su encabezado #top).
(function () {
  if (window.__dlvNav) return; window.__dlvNav = true;
  const I = {
    inicio: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
    tablero: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    reporte: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v3h6V3"/><path d="M9 11h6M9 15h4"/>',
    visor: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
    planilla: '<path d="M4 4h16v16H4z"/><path d="M4 9h16M4 14h16M10 9v11"/>',
    sub: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/><path d="M16 4.5a3 3 0 0 1 0 6M18 14.8c1.6.7 2.6 2.4 3 5.2"/>',
    rdi: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
    oficio: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h4"/><path d="m14.5 18.5 1.5 1.5 3-3"/>',
    ciclo: '<path d="M4 20V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
    costos: '<path d="M3 20h18"/><path d="M6 16V9M11 16V5M16 16v-4M21 16V8"/>',
    compras: '<path d="M3 4h2l2.4 11h11L21 7H6.2"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    facturas: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    personal: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"/>',
    docs: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
    propuestas: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18"/>',
    campana: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    salir: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>'
  };
  const GRUPOS = [
    { h: "", it: [["/", "Inicio", "inicio"], ["/tablero", "Tablero", "tablero"]] },
    { h: "Obra", it: [["/reportes", "Reporte diario", "reporte"], ["/visor", "Visor 3D y avance", "visor"], ["/planillas", "Estado de pago", "planilla"], ["/subcontratos", "Subcontratos", "sub"], ["/rdi", "RDI y actas", "rdi"], ["/oficios", "Oficios", "oficio"], ["/ciclo", "Inicio y cierre", "ciclo"]] },
    { h: "Gestión", it: [["/costos", "Control de costos", "costos"], ["/compras", "Compras", "compras"], ["/facturas", "Facturas SRI", "facturas", true], ["/personal", "Personal", "personal"], ["/documentos", "Documentos", "docs"]] },
    { h: "Comercial", it: [["/propuestas", "Propuestas", "propuestas", true]] }
  ];
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k] || ""}</svg>`;
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const actual = (location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/").replace(/\/+$/, "") || "/");

  function construir() {
    const top = document.getElementById("top");
    if (!top || actual === "/visor") return;
    const side = document.createElement("aside");
    side.className = "side"; side.setAttribute("aria-label", "Programas de la plataforma"); side.hidden = true;
    side.innerHTML = `<div class="sb-brand"><span class="sb-logo">DLV</span><span class="sb-name"><b>DLV</b><small>Plataforma de obra</small></span></div>` +
      GRUPOS.map((g) => `<nav class="sb-grp">${g.h ? `<div class="sb-h">${g.h}</div>` : ""}${g.it.map(([href, t, ic, adm]) =>
        `<a class="sb-it" href="${href}"${adm ? ' data-admin="1"' : ""}${href === actual ? ' aria-current="page"' : ""}>${svg(ic)}<span>${t}</span></a>`).join("")}</nav>`).join("") +
      `<div class="sb-foot"><span class="sb-av" id="sbAv">·</span><span class="sb-who"><b id="sbNom">&nbsp;</b><small id="sbRol"></small></span><button class="sb-out" id="sbAvisos" type="button" title="Avisos en este teléfono" aria-label="Avisos en este teléfono">${svg("campana")}</button><button class="sb-out" id="sbOut" type="button" title="Cerrar sesión" aria-label="Cerrar sesión">${svg("salir")}</button></div>`;
    const veil = document.createElement("div"); veil.className = "sb-veil"; veil.hidden = true;
    document.body.prepend(veil); document.body.prepend(side);

    const abrir = (si) => { document.body.classList.toggle("side-open", si); veil.hidden = !si; };
    veil.addEventListener("click", () => abrir(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") abrir(false); });
    // En celular, "Menú DLV" abre el cajón en vez de ir al portal
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest('.top a[href="/"]');
      if (a && !side.hidden && window.matchMedia("(max-width:1023.98px)").matches) { e.preventDefault(); abrir(true); }
    });
    side.querySelector("#sbOut").addEventListener("click", salir);
    side.querySelector("#sbAvisos").addEventListener("click", activarAvisos);
    // En el inicio (celular) no hay menú lateral: botón de avisos junto a "Salir"
    const usr = top.querySelector(".user");
    if (actual === "/" && usr && !usr.querySelector(".sb-campana")) {
      const bt = document.createElement("button"); bt.type = "button"; bt.className = "btn sm ghost sb-campana"; bt.innerHTML = svg("campana") + "Avisos";
      bt.addEventListener("click", activarAvisos); usr.insertBefore(bt, usr.querySelector("#btnSalir"));
    }
    estadoAvisos();
    const menu = top.querySelector('a.btn[href="/"]');
    if (menu) { menu.classList.add("sb-menu"); menu.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>Menú'; }

    const mostrar = () => { const ver = !top.hidden; side.hidden = !ver; document.body.classList.toggle("con-side", ver); if (ver) perfil(); };
    new MutationObserver(mostrar).observe(top, { attributes: true, attributeFilter: ["hidden"] });
    mostrar();
  }

  function sesion() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^sb-.+-auth-token$/.test(k)) { const v = JSON.parse(localStorage.getItem(k)); return v && (v.currentSession || v); }
      }
    } catch (_) {}
    return null;
  }
  let pedido = false;
  async function perfil() {
    const quien = document.getElementById("quien");
    const ponNombre = (n) => { if (!n) return; document.getElementById("sbNom").textContent = n; document.getElementById("sbAv").textContent = n.replace(/^(ing|arq|dr|sr|sra)\.?\s+/i, "").split(/\s+/).slice(0, 2).map((p) => p[0] || "").join("").toUpperCase(); };
    if (quien && quien.textContent.trim()) ponNombre(quien.textContent.trim());
    if (quien) new MutationObserver(() => ponNombre(quien.textContent.trim())).observe(quien, { childList: true, characterData: true, subtree: true });
    if (pedido) return; pedido = true;
    const s = sesion(); if (!s || !s.access_token || !s.user) return;
    try {
      const cfg = await (await fetch("/api/config")).json();
      if (!cfg.supabaseUrl) return;
      const r = await fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/perfiles?select=nombre,rol&id=eq." + encodeURIComponent(s.user.id), { headers: { apikey: cfg.supabaseAnonKey, Authorization: "Bearer " + s.access_token } });
      const [p] = r.ok ? await r.json() : [];
      if (!p) return;
      ponNombre(p.nombre || s.user.email);
      document.getElementById("sbRol").textContent = p.rol === "admin" ? "Administrador" : p.rol ? p.rol.charAt(0).toUpperCase() + p.rol.slice(1) : "";
      if (p.rol !== "admin") document.querySelectorAll('.side [data-admin="1"]').forEach((a) => (a.hidden = true));
    } catch (_) {}
  }
  function salir() {
    limpiarDatos();
    const b = document.getElementById("btnSalir");
    if (b) { b.click(); return; }
    try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (/^sb-.+-auth-token$/.test(k)) localStorage.removeItem(k); } } catch (_) {}
    location.href = "/";
  }


  /* ---------- Dentro de la app nativa (Android / iPhone con Capacitor) ---------- */
  const nativo = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  async function compartirArchivo(file) {
    const P = window.Capacitor.Plugins;
    const b64 = await new Promise((ok, mal) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1]); fr.onerror = mal; fr.readAsDataURL(file); });
    const nombre = (file.name || "archivo").replace(/[\\/:*?"<>|]+/g, "_");
    const w = await P.Filesystem.writeFile({ path: nombre, data: b64, directory: "CACHE" });
    await P.Share.share({ title: nombre, files: [w.uri], dialogTitle: "Compartir o guardar" });
  }
  if (nativo()) {
    document.documentElement.classList.add("app-nativa");
    // Los PDF se comparten (WhatsApp, correo, Drive, Archivos…) con la hoja nativa del teléfono
    navigator.canShare = (d) => !!(d && ((d.files && d.files.length) || d.url || d.text));
    navigator.share = async (d) => {
      if (d && d.files && d.files.length) return compartirArchivo(d.files[0]);
      return window.Capacitor.Plugins.Share.share({ title: d && d.title, text: d && d.text, url: d && d.url });
    };
    // Descargas con <a download> (jsPDF, CSV…): el visor web no descarga, se comparte el archivo
    const bajar = (a) => {
      const href = a.getAttribute("href") || "";
      if (!a.hasAttribute("download") || !/^(blob:|data:)/.test(href)) return false;
      fetch(href).then((r) => r.blob()).then((b) => compartirArchivo(new File([b], a.getAttribute("download") || "archivo", { type: b.type }))).catch(() => {});
      return true;
    };
    const clickOrig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (!bajar(this)) return clickOrig.call(this); };
    const dispOrig = HTMLAnchorElement.prototype.dispatchEvent;
    HTMLAnchorElement.prototype.dispatchEvent = function (ev) { if (ev && ev.type === "click" && bajar(this)) return false; return dispOrig.call(this, ev); };
    document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[download]"); if (a && bajar(a)) e.preventDefault(); }, true);
  }

  /* ---------- App instalable: funciona sin señal, avisos en el teléfono ---------- */
  const esIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalada = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true || nativo();
  let swReg = null;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then((r) => { swReg = r; estadoAvisos(); }).catch(() => {});
  }
  function limpiarDatos() { try { navigator.serviceWorker && navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage("limpiar-datos"); } catch (_) {} }
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#btnSalir")) limpiarDatos(); }, true);

  function aviso(texto, ms) {
    let t = document.getElementById("dlvAviso");
    if (!t) { t = document.createElement("div"); t.id = "dlvAviso"; t.className = "dlv-aviso"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = texto; t.hidden = false; clearTimeout(t._t); if (ms) t._t = setTimeout(() => (t.hidden = true), ms);
  }
  // Barra de "sin conexión"
  function red() {
    let b = document.getElementById("dlvRed");
    if (navigator.onLine) { if (b) b.hidden = true; return; }
    if (!b) { b = document.createElement("div"); b.id = "dlvRed"; b.className = "dlv-red"; b.textContent = "Sin conexión: ves lo último que se cargó. Los cambios no se guardarán hasta que vuelva la señal."; document.body.prepend(b); }
    b.hidden = false;
  }
  window.addEventListener("online", red); window.addEventListener("offline", red);
  if (document.readyState !== "loading") red(); else document.addEventListener("DOMContentLoaded", red);

  // Sugerencia de instalar en el iPhone (solo en el inicio, una vez cerrada no vuelve)
  function sugerirInstalar() {
    if (!esIOS || instalada || actual !== "/") return;
    try { if (localStorage.getItem("dlv-instalar-visto")) return; } catch (_) {}
    const c = document.createElement("div"); c.className = "dlv-instalar";
    c.innerHTML = '<b>Instala DLV en tu iPhone</b><span>En Safari toca <b>Compartir</b> y luego <b>Agregar a pantalla de inicio</b>. Así abre como app y puede avisarte de pedidos y oficios.</span><button type="button" aria-label="Cerrar">×</button>';
    c.querySelector("button").onclick = () => { c.remove(); try { localStorage.setItem("dlv-instalar-visto", "1"); } catch (_) {} };
    document.body.appendChild(c);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sugerirInstalar); else sugerirInstalar();

  async function estadoAvisos() {
    const b = document.getElementById("sbAvisos"); if (!b) return;
    let activo = false;
    try { activo = !!(swReg && "PushManager" in window && Notification.permission === "granted" && (await swReg.pushManager.getSubscription())); } catch (_) {}
    b.classList.toggle("on", activo);
    b.title = activo ? "Avisos activados en este teléfono" : "Activar avisos en este teléfono";
  }
  const b64aBytes = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
  async function activarAvisos() {
    if (nativo()) return aviso("En la app, los avisos llegarán con la próxima versión. Por ahora se reciben desde la versión web instalada.", 6000);
    if (esIOS && !instalada) return aviso("Para recibir avisos en el iPhone, primero agrega DLV a la pantalla de inicio (Safari → Compartir → Agregar a pantalla de inicio) y ábrela desde ese ícono.", 9000);
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return aviso("Este navegador no permite avisos.", 5000);
    const s = sesion(); if (!s || !s.access_token) return aviso("Inicia sesión primero.", 4000);
    try {
      const reg = swReg || (await navigator.serviceWorker.ready);
      const yaHay = await reg.pushManager.getSubscription();
      if (yaHay && Notification.permission === "granted") {
        await guardarSuscripcion(yaHay, s);
        return aviso("Los avisos ya están activados en este teléfono.", 4000);
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return aviso("No se dio permiso para avisos. Se puede activar en Ajustes → Notificaciones → DLV.", 7000);
      const { clave } = await (await fetch("/api/push?accion=clave")).json();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(clave) });
      await guardarSuscripcion(sub, s);
      aviso("Listo: este teléfono recibirá avisos de pedidos, órdenes y oficios.", 5000);
    } catch (e) { aviso("No se pudieron activar los avisos: " + (e.message || e), 7000); }
    estadoAvisos();
  }
  async function guardarSuscripcion(sub, s) {
    const j = sub.toJSON(), cfg = await (await fetch("/api/config")).json();
    const r = await fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/push_suscripciones?on_conflict=endpoint", {
      method: "POST",
      headers: { apikey: cfg.supabaseAnonKey, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, agente: navigator.userAgent.slice(0, 200) }),
    });
    if (!r.ok) throw new Error(r.status === 404 ? "falta instalar avisos.sql en Supabase" : "no se guardó la suscripción");
  }

  // Después de guardar algo en la base, el servidor envía los avisos que ese cambio generó
  let pendienteEnvio = null;
  function enviarAvisos() {
    clearTimeout(pendienteEnvio);
    pendienteEnvio = setTimeout(() => {
      const s = sesion(); if (!s || !s.access_token) return;
      _fetch("/api/push?accion=enviar", { method: "POST", headers: { Authorization: "Bearer " + s.access_token } }).catch(() => {});
    }, 1500);
  }
  const _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const p = _fetch(input, init);
    try {
      const url = typeof input === "string" ? input : input.url, m = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (m !== "GET" && m !== "HEAD" && /\/rest\/v1\//.test(url) && !/push_(pendientes|quitar|suscripciones)/.test(url)) p.then((r) => { if (r.ok) enviarAvisos(); }).catch(() => {});
    } catch (_) {}
    return p;
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", construir); else construir();
})();
