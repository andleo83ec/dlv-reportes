// DLV Plataforma — portal de inicio: menú de programas (tabla "programas" en Supabase) y resumen del día.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoy = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3000); }

const CATS = ["Obra", "Oficina técnica", "Comercial", "Administración"];
const ESTADOS = { activo: "Activo", beta: "Beta", desarrollo: "En desarrollo" };
const ICONOS = {
  reporte: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h6"/>',
  cubo: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
  casco: '<path d="M3 17h18M5 17v-2a7 7 0 0 1 14 0v2"/><path d="M10 8V5h4v3"/>',
  grafico: '<path d="M4 20V4M4 20h16"/><path d="m7 15 4-4 3 3 5-6"/>',
  carrito: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11L21 7H6.2"/>',
  factura: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  calculadora: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8v4H8zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
  plano: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  hierro: '<path d="M4 20 20 4M4 14 14 4M10 20 20 10"/>',
  presupuesto: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  carpeta: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  personas: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 20a6 6 0 0 0-4-5.6"/>',
  camion: '<path d="M2 6h11v10H2zM13 10h5l3 3v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  app: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'
};
const icono = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[k] || ICONOS.app}</svg>`;

// Menú base: se usa mientras la tabla "programas" no exista en Supabase
const BASE = [
  { id: "b1", nombre: "Reporte diario de obra", descripcion: "Clima, personal, equipos, actividades, materiales y panel fotográfico. PDF de 2 hojas.", url: "/reportes", categoria: "Obra", icono: "reporte", estado: "activo", orden: 10 },
  { id: "b3", nombre: "Estado de pago (planillas)", descripcion: "Presupuesto por obra, planillas al mandante con anterior, presente y acumulado, anticipo, garantía e IVA. PDF.", url: "/planillas", categoria: "Oficina técnica", icono: "presupuesto", estado: "beta", orden: 10 },
  { id: "b2", nombre: "Visor 3D y avance", descripcion: "Modelo IFC de ArchiCAD: registra el avance por elemento con fotos y pásalo al reporte diario.", url: "/visor", categoria: "Obra", icono: "cubo", estado: "beta", orden: 20 }
];

let sb = null, user = null, perfil = null;
let programas = [], sinTabla = false, editando = false, obrasHoy = null, filtro = "";
const esAdmin = () => perfil && perfil.rol === "admin";

/* ---------- datos ---------- */
async function cargarProgramas() {
  const { data, error } = await sb.from("programas").select("*").order("orden").order("nombre");
  if (error) { sinTabla = true; programas = BASE.slice(); return; }
  sinTabla = false; programas = data || [];
}
async function cargarHoy() {
  const { data: obras, error } = await sb.from("obras").select("id,nombre").eq("activa", true).order("nombre");
  if (error) { obrasHoy = null; return; }
  const { data: reps } = await sb.from("reportes").select("obra_id").eq("fecha", hoy());
  const con = new Set((reps || []).map((r) => r.obra_id));
  obrasHoy = (obras || []).map((o) => ({ ...o, reporte: con.has(o.id) }));
}

/* ---------- render ---------- */
function saludo() { const h = new Date().getHours(); return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches"; }
function render() {
  const m = $("#main");
  $("#top").hidden = !user; $("#pfoot").hidden = !user;
  if (!user) return renderLogin(m);
  const nombre = ((perfil && perfil.nombre) || user.email || "").split(" ")[0];
  const visibles = programas;
  const cats = [...CATS, ...[...new Set(programas.map((p) => p.categoria))].filter((c) => !CATS.includes(c)).sort()];
  const grupos = cats.map((c) => ({ c, items: visibles.filter((p) => p.categoria === c).sort((a, b) => (a.orden ?? 100) - (b.orden ?? 100) || a.nombre.localeCompare(b.nombre, "es")) })).filter((g) => g.items.length || (editando && CATS.includes(g.c)));
  const pend = obrasHoy ? obrasHoy.filter((o) => !o.reporte) : [];
  m.innerHTML = `
  <section class="hello">
    <h1>${saludo()}${nombre ? ", " + esc(nombre) : ""}</h1>
    ${obrasHoy && obrasHoy.length ? `<div class="hoy"><span class="code">HOY · ${new Date().toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long" })}</span>
      <div class="hoy-row">${obrasHoy.map((o) => `<a class="obra-chip ${o.reporte ? "ok" : "pend"}" href="/reportes"><span class="d"></span>${esc(o.nombre)}<small>${o.reporte ? "Reporte listo" : "Sin reporte"}</small></a>`).join("")}</div>
      ${pend.length ? `<span class="hint">${pend.length === 1 ? "1 obra" : pend.length + " obras"} sin reporte de hoy.</span>` : `<span class="hint">Todas las obras tienen su reporte de hoy.</span>`}</div>` : ""}
  </section>
  <div class="tools-row">
    <label class="fld search" for="buscar"><span class="vh">Buscar programa</span><input id="buscar" type="text" placeholder="Buscar programa…" value="${esc(filtro)}" autocomplete="off"></label>
    ${esAdmin() ? `<button class="btn ${editando ? "primary" : ""}" type="button" data-act="editar">${editando ? "Listo" : "Administrar"}</button>` : ""}
  </div>
  ${editando && sinTabla ? `<div class="confirm" style="background:var(--warn-bg)"><span>Para agregar y editar programas, ejecuta <b>supabase/portal.sql</b> en Supabase → SQL Editor. Mientras tanto se muestra el menú base.</span></div>` : ""}
  ${grupos.map((g) => `
    <section class="cat">
      <div class="cat-h"><h2>${esc(g.c)}</h2><span class="code">${g.items.length}</span></div>
      <div class="grid">${g.items.map(card).join("")}${editando && !sinTabla ? `<button class="card add-card" type="button" data-nuevo="${esc(g.c)}"><span class="ic">+</span><b>Agregar programa</b><small>en ${esc(g.c)}</small></button>` : ""}</div>
    </section>`).join("")}
  <div class="empty" id="sinRes" hidden>Ningún programa coincide con la búsqueda.</div>
  ${editando && !sinTabla ? `<div><button class="btn" type="button" data-nuevo="">+ Programa en otra categoría</button></div>` : ""}`;
  aplicarFiltro();
}
function aplicarFiltro() {
  const q = filtro.trim().toLowerCase();
  let total = 0;
  document.querySelectorAll(".cat").forEach((sec) => {
    let n = 0;
    sec.querySelectorAll("[data-q]").forEach((c) => { const ok = !q || c.dataset.q.includes(q); c.hidden = !ok; if (ok) n++; });
    sec.hidden = !!q && !n; total += n;
  });
  const sr = $("#sinRes"); if (sr) sr.hidden = !q || total > 0;
}
function card(p) {
  const dq = ` data-q="${esc([p.nombre, p.descripcion, p.categoria].join(" ").toLowerCase())}"`;
  const activo = p.estado !== "desarrollo" && p.url;
  const ext = /^https?:\/\//i.test(p.url || "");
  const inner = `<span class="ic">${icono(p.icono)}</span>
    <span class="tx"><b>${esc(p.nombre)}${ext && activo ? ' <span class="ext" aria-label="abre en otra pestaña">↗</span>' : ""}</b><small>${esc(p.descripcion || "")}</small></span>
    ${p.estado !== "activo" ? `<span class="badge ${esc(p.estado)}">${ESTADOS[p.estado] || p.estado}</span>` : ""}${p.solo_admin ? `<span class="badge adm">Solo admin</span>` : ""}`;
  if (editando && !sinTabla) return `<button class="card editable" type="button" data-edit="${esc(p.id)}"${dq}>${inner}<span class="edit">Editar</span></button>`;
  if (!activo) return `<div class="card off" aria-disabled="true"${dq}>${inner}</div>`;
  return `<a class="card"${dq} href="${esc(p.url)}"${ext || p.nueva_pestana ? ' target="_blank" rel="noopener"' : ""}>${inner}</a>`;
}
function renderLogin(m) {
  m.innerHTML = `<form class="login" id="loginForm">
    <div class="logo"><b>DLV</b><span>Plataforma de obra</span></div>
    <p>Entra con el correo y la clave que te dio la oficina.</p>
    <label class="fld" for="lEmail"><span>Correo</span><input id="lEmail" type="email" autocomplete="username" required></label>
    <label class="fld" for="lPass"><span>Clave</span><input id="lPass" type="password" autocomplete="current-password" required></label>
    <span class="err" id="lErr"></span>
    <button class="btn primary" type="submit" id="lBtn">Entrar</button>
  </form>`;
}

/* ---------- edición (solo admin) ---------- */
let form = null, confirmar = false;
function abrirForm(p, cat) {
  form = p ? { ...p } : { nombre: "", descripcion: "", url: "", categoria: cat || "Obra", icono: "app", estado: "activo", solo_admin: false, nueva_pestana: false, orden: 100 };
  confirmar = false; renderForm();
}
function renderForm() {
  const f = form, cats = [...new Set([...CATS, ...programas.map((p) => p.categoria)])];
  $("#sheetRoot").innerHTML = `<div class="sheet" id="sheet"><form class="sheet-card" id="progForm" role="dialog" aria-label="${f.id ? "Editar programa" : "Nuevo programa"}">
    <div class="sheet-h"><h2>${f.id ? "Editar programa" : "Nuevo programa"}</h2><button class="btn sm ghost" type="button" data-act="cerrar">Cerrar</button></div>
    <label class="fld" for="pNombre"><span>Nombre</span><input id="pNombre" type="text" data-f="nombre" value="${esc(f.nombre)}" required placeholder="Ej.: Planillas de hierro"></label>
    <label class="fld" for="pDesc"><span>Descripción corta</span><textarea id="pDesc" data-f="descripcion" placeholder="Qué hace, en una línea">${esc(f.descripcion || "")}</textarea></label>
    <label class="fld" for="pUrl"><span>Dirección</span><input id="pUrl" type="text" data-f="url" value="${esc(f.url || "")}" placeholder="/ruta-interna o https://…" inputmode="url" autocapitalize="off"></label>
    <div class="grid2">
      <label class="fld" for="pCat"><span>Categoría</span><input id="pCat" type="text" data-f="categoria" value="${esc(f.categoria)}" list="catList" required><datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
      <label class="fld" for="pEst"><span>Estado</span><select id="pEst" data-f="estado">${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}"${f.estado === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
    </div>
    <div class="fld"><span>Ícono</span><div class="icons">${Object.keys(ICONOS).map((k) => `<button type="button" class="icon-opt" data-icono="${k}" aria-pressed="${f.icono === k}" aria-label="${k}">${icono(k)}</button>`).join("")}</div></div>
    <div class="grid2">
      <label class="fld" for="pOrden"><span>Orden en la categoría</span><input id="pOrden" type="number" inputmode="numeric" data-f="orden" value="${esc(f.orden ?? 100)}"></label>
      <div class="fld"><span>Opciones</span>
        <label class="chk" for="pTab"><input type="checkbox" id="pTab" data-c="nueva_pestana"${f.nueva_pestana ? " checked" : ""}>Abrir en otra pestaña</label>
        <label class="chk" for="pAdm"><input type="checkbox" id="pAdm" data-c="solo_admin"${f.solo_admin ? " checked" : ""}>Solo administradores</label></div>
    </div>
    ${confirmar ? `<div class="confirm"><span>¿Quitar «${esc(f.nombre)}» del menú? El programa en sí no se borra.</span><button class="btn sm danger" type="button" data-act="borrarOk">Sí, quitar</button><button class="btn sm" type="button" data-act="noBorrar">Cancelar</button></div>` : ""}
    <div class="sheet-f">${f.id ? `<button class="btn danger" type="button" data-act="borrar">Quitar del menú</button>` : "<span></span>"}<button class="btn primary" type="submit" id="pSave">Guardar</button></div>
  </form></div>`;
}
async function guardarForm() {
  const f = form;
  if (!f.nombre.trim()) return toast("Escribe el nombre del programa.");
  const url = (f.url || "").trim();
  if (url && !/^\/|^https?:\/\//i.test(url)) return toast("La dirección debe empezar con / (programa de esta app) o con https://");
  const row = { nombre: f.nombre.trim(), descripcion: (f.descripcion || "").trim() || null, url: url || null, categoria: (f.categoria || "Obra").trim() || "Obra",
    icono: f.icono || "app", estado: f.estado || "activo", solo_admin: !!f.solo_admin, nueva_pestana: !!f.nueva_pestana, orden: parseInt(f.orden, 10) || 100, actualizado: new Date().toISOString() };
  const btn = $("#pSave"); btn.disabled = true; btn.textContent = "Guardando…";
  const { error } = f.id ? await sb.from("programas").update(row).eq("id", f.id) : await sb.from("programas").insert(row);
  if (error) { btn.disabled = false; btn.textContent = "Guardar"; return toast("No se pudo guardar: " + error.message); }
  $("#sheetRoot").innerHTML = ""; form = null; toast("Programa guardado"); await cargarProgramas(); render();
}
async function borrar() {
  const { error } = await sb.from("programas").delete().eq("id", form.id);
  if (error) return toast("No se pudo quitar: " + error.message);
  $("#sheetRoot").innerHTML = ""; form = null; toast("Programa quitado del menú"); await cargarProgramas(); render();
}

/* ---------- eventos ---------- */
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.target.id === "progForm") return guardarForm();
  if (e.target.id !== "loginForm") return;
  const b = $("#lBtn"); b.disabled = true; b.textContent = "Entrando…"; $("#lErr").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
  if (error) { $("#lErr").textContent = "Correo o clave incorrectos."; b.disabled = false; b.textContent = "Entrar"; }
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "buscar") { filtro = t.value; aplicarFiltro(); return; }
  if (t.dataset.f && form) form[t.dataset.f] = t.value;
});
document.addEventListener("change", (e) => { const t = e.target; if (t.dataset.c && form) form[t.dataset.c] = t.checked; });
document.addEventListener("click", async (e) => {
  if (e.target.id === "sheet") { $("#sheetRoot").innerHTML = ""; form = null; return; }
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "btnSalir") { await sb.auth.signOut(); return; }
  if (b.dataset.icono && form) { form.icono = b.dataset.icono; document.querySelectorAll(".icon-opt").forEach((x) => x.setAttribute("aria-pressed", x.dataset.icono === form.icono)); return; }
  if (b.dataset.edit) return abrirForm(programas.find((p) => p.id === b.dataset.edit));
  if (b.dataset.nuevo !== undefined) return abrirForm(null, b.dataset.nuevo || "");
  const a = b.dataset.act;
  if (a === "editar") { editando = !editando; render(); return; }
  if (a === "cerrar") { $("#sheetRoot").innerHTML = ""; form = null; return; }
  if (a === "borrar") { confirmar = true; renderForm(); return; }
  if (a === "noBorrar") { confirmar = false; renderForm(); return; }
  if (a === "borrarOk") return borrar();
});

/* ---------- arranque ---------- */
async function entrar(session) {
  user = session ? session.user : null;
  if (!user) { perfil = null; editando = false; render(); return; }
  const { data } = await sb.from("perfiles").select("*").eq("id", user.id).maybeSingle();
  perfil = data || { rol: "residente" };
  $("#quien").textContent = perfil.nombre || user.email;
  await Promise.all([cargarProgramas(), cargarHoy()]);
  render();
}
(async () => {
  try {
    const cfg = await (await fetch("/api/config")).json();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("config");
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch (_) {
    $("#main").innerHTML = `<div class="empty"><b>Falta configurar la plataforma.</b><span>Revisa las variables SUPABASE_URL y SUPABASE_ANON_KEY en Cloudflare Pages.</span></div>`;
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  await entrar(session);
  sb.auth.onAuthStateChange((ev, s) => { if (ev === "SIGNED_IN" && !user) entrar(s); if (ev === "SIGNED_OUT") entrar(null); });
})();
})();
