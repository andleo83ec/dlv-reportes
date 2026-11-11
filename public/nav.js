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
    ciclo: '<path d="M4 20V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
    costos: '<path d="M3 20h18"/><path d="M6 16V9M11 16V5M16 16v-4M21 16V8"/>',
    compras: '<path d="M3 4h2l2.4 11h11L21 7H6.2"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    facturas: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    personal: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"/>',
    docs: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
    propuestas: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18"/>',
    salir: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>'
  };
  const GRUPOS = [
    { h: "", it: [["/", "Inicio", "inicio"], ["/tablero", "Tablero", "tablero"]] },
    { h: "Obra", it: [["/reportes", "Reporte diario", "reporte"], ["/visor", "Visor 3D y avance", "visor"], ["/planillas", "Estado de pago", "planilla"], ["/subcontratos", "Subcontratos", "sub"], ["/rdi", "RDI y actas", "rdi"], ["/ciclo", "Inicio y cierre", "ciclo"]] },
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
      `<div class="sb-foot"><span class="sb-av" id="sbAv">·</span><span class="sb-who"><b id="sbNom">&nbsp;</b><small id="sbRol"></small></span><button class="sb-out" id="sbOut" type="button" title="Cerrar sesión" aria-label="Cerrar sesión">${svg("salir")}</button></div>`;
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
    const b = document.getElementById("btnSalir");
    if (b) { b.click(); return; }
    try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (/^sb-.+-auth-token$/.test(k)) localStorage.removeItem(k); } } catch (_) {}
    location.href = "/";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", construir); else construir();
})();
