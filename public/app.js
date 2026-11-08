// DLV Reportes — app principal (Supabase + Cloudflare R2 + jsPDF)
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoy = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const diaSemana = (f) => { if (!f) return ""; const [y, m, d] = f.split("-").map(Number); return DIAS[new Date(y, m - 1, d).getDay()]; };
const fmtF = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
const clone = (o) => JSON.parse(JSON.stringify(o));
const diasInfo = (o, f) => window.diasInfoDLV(o, f);

let sb = null, user = null, perfil = null;
let obras = [], reportes = [], obraId = "", perfiles = [], miembros = [];
let view = "lista", draft = null, dirty = false, obraDraft = null, confirmDel = null;
const urlCache = {};
const esAdmin = () => perfil && perfil.rol === "admin";

/* ---------- plantillas ---------- */
const EQ_LIV = ["Concretera", "Vibrador", "Amoladora", "Taladro / rotomartillo", "Andamio (cuerpos)", "Winche / elevador"];
const PER_DIR = ["Maestro mayor", "Albañil", "Fierrero", "Carpintero (encofrado)", "Peón", "Operador de equipo"];
const PER_IND = ["Residente de obra", "Asistente técnico", "Bodeguero", "Técnico de seguridad (SSO)", "Guardián"];
function nuevoReporte(o) {
  const prev = reportes[0];
  const n = reportes.reduce((m, r) => Math.max(m, r.numero || 0), 0) + 1;
  const base = {
    obraId: o.id, numero: n, fecha: hoy(), turno: "Día", avance: prev ? prev.avance || "" : "",
    clima: { manana: "Soleado", tarde: "Soleado", horasPar: "", obs: "" },
    equipos: EQ_LIV.map((e) => ({ tipo: "liviano", equipo: e, estado: "Operativo", horas: "", cant: "" })),
    directa: PER_DIR.map((c) => ({ cat: c, n: "", h: "" })),
    indirecta: PER_IND.map((c) => ({ cat: c, n: "", h: "" })),
    actividades: [{ cod: "", desc: "", ubic: "", und: "", cant: "" }],
    materiales: [],
    sso: { charla: false, epp: false, arnes: false, bordes: false, andamios: false, tema: "", incidentes: "" },
    ensayos: { slump: "", cilindros: "", fc: "", otros: "" },
    novedades: [""], fotos: [],
  };
  if (prev) { // copia recursos del último reporte
    base.equipos = clone(prev.equipos || base.equipos);
    base.directa = clone(prev.directa || base.directa);
    base.indirecta = clone(prev.indirecta || base.indirecta);
    base.actividades = (prev.actividades || []).filter((a) => a.cod || a.desc).map((a) => ({ cod: a.cod, desc: a.desc, ubic: a.ubic, und: a.und, cant: "" }));
    if (!base.actividades.length) base.actividades = [{ cod: "", desc: "", ubic: "", und: "", cant: "" }];
  }
  return base;
}

/* ---------- cálculos ---------- */
const keyAct = (a) => (a.cod || "").trim().toLowerCase() || (a.desc || "").trim().toLowerCase();
function acumPrevio(a, rep) {
  const k = keyAct(a); if (!k) return 0; let s = 0;
  for (const r of reportes) {
    if (r.id === rep.id) continue;
    if ((r.fecha || "") > (rep.fecha || "") || (r.fecha === rep.fecha && (r.numero || 0) >= (rep.numero || 0))) continue;
    for (const x of r.actividades || []) if (keyAct(x) === k) s += num(x.cant);
  }
  return s;
}
const totPer = (arr) => (arr || []).reduce((t, p) => ({ n: t.n + num(p.n), h: t.h + num(p.h) }), { n: 0, h: 0 });

/* ---------- UI helpers ---------- */
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800); }
function setDirty(v) { dirty = v; const e = $("#estado"); if (view !== "editor") return; e.className = "state" + (v ? " dirty" : ""); e.textContent = v ? "Sin guardar" : draft && draft.id ? "Guardado" : "Nuevo"; }
const getP = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
function setP(o, p, v) { const ks = p.split("."); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]]; a[ks[ks.length - 1]] = v; }
const obraActual = () => obras.find((o) => o.id === obraId);
function inp(path, label, type = "text", extra = "") {
  const v = getP(draft, path) ?? ""; const id = "f_" + path.replace(/\./g, "_");
  return `<label class="fld" for="${id}"><span>${label}</span><input id="${id}" type="${type}" data-p="${path}" value="${esc(v)}" ${type === "number" ? 'inputmode="decimal" step="any"' : ""} ${extra}></label>`;
}
function sel(path, label, opts) {
  const v = getP(draft, path) ?? ""; const id = "f_" + path.replace(/\./g, "_");
  return `<label class="fld" for="${id}"><span>${label}</span><select id="${id}" data-p="${path}">${opts.map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
}

/* ---------- datos (Supabase) ---------- */
const fromRow = (r) => ({ ...(r.datos || {}), id: r.id, obraId: r.obra_id, numero: r.numero, fecha: r.fecha, turno: r.turno, creadoPor: r.creado_por });
async function cargarObras() {
  const { data, error } = await sb.from("obras").select("*").eq("activa", true).order("nombre");
  if (error) { toast("No se pudieron cargar las obras."); return; }
  obras = data || [];
  if (!obras.find((o) => o.id === obraId)) {
    let saved = ""; try { saved = localStorage.getItem("dlv-obra") || ""; } catch (_) {}
    obraId = (obras.find((o) => o.id === saved) || obras[0] || {}).id || "";
  }
  renderObras();
  await cargarReportes();
}
async function cargarReportes() {
  reportes = [];
  if (obraId) {
    const { data, error } = await sb.from("reportes").select("*").eq("obra_id", obraId).order("fecha", { ascending: false }).order("numero", { ascending: false });
    if (error) toast("No se pudieron cargar los reportes.");
    reportes = (data || []).map(fromRow);
  }
  if (view === "lista") render();
}
async function cargarMiembros(oid) {
  if (!esAdmin()) return;
  const [p, m] = await Promise.all([sb.from("perfiles").select("id,email,nombre,rol").order("email"), oid ? sb.from("obra_miembros").select("user_id").eq("obra_id", oid) : Promise.resolve({ data: [] })]);
  perfiles = p.data || []; miembros = (m.data || []).map((x) => x.user_id);
}

/* ---------- fotos (R2 vía /api/fotos) ---------- */
async function token() { const { data: { session } } = await sb.auth.getSession(); return session?.access_token || ""; }
async function urlsFotos(keys) {
  const t = await token();
  await Promise.all(keys.filter((k) => k && !urlCache[k]).map(async (k) => {
    const r = await fetch(`/api/fotos?obra=${encodeURIComponent(obraId)}&key=${encodeURIComponent(k)}`, { headers: { Authorization: "Bearer " + t } });
    if (r.ok) urlCache[k] = URL.createObjectURL(await r.blob());
  }));
  return keys.map((k) => urlCache[k]);
}
async function pintarFotos() {
  const imgs = [...document.querySelectorAll("img[data-key]")]; if (!imgs.length) return;
  try { await urlsFotos(imgs.map((i) => i.dataset.key)); } catch (_) {}
  imgs.forEach((i) => { if (urlCache[i.dataset.key]) i.src = urlCache[i.dataset.key]; else { i.alt = "Foto no disponible"; i.classList.add("nofoto"); } });
}
async function decodificar(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) {}
  return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
}
async function comprimir(file) {
  const img = await decodificar(file);
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  const k = Math.min(1, 1400 / Math.max(w0, h0)), w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
  return { blob: await new Promise((r) => c.toBlob(r, "image/jpeg", 0.78)), w, h };
}
async function subirFotos(files) {
  if (!draft) return;
  for (const file of files) {
    if (draft.fotos.length >= 6) { toast("Máximo 6 fotos por reporte."); break; }
    const msg = $("#fotoMsg");
    try {
      if (msg) msg.textContent = "Comprimiendo…";
      const { blob, w, h } = await comprimir(file);
      if (msg) msg.textContent = "Subiendo…";
      const r = await fetch(`/api/fotos?obra=${encodeURIComponent(draft.obraId)}`, { method: "POST", body: blob, headers: { "Content-Type": "image/jpeg", Authorization: "Bearer " + (await token()) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "error del servidor");
      const key = j.key;
      urlCache[key] = URL.createObjectURL(blob);
      draft.fotos.push({ key, w, h, desc: "", ubic: "" });
      setDirty(true); render();
    } catch (err) { toast("No se pudo subir la foto: " + err.message); render(); }
  }
}

/* ---------- avance del visor 3D (avance_registros) ---------- */
const BIM_EST = { ni: "No iniciado", ej: "En ejecución", ok: "Terminado", ob: "Observado" };
const bimCache = {};
const bimLabel = (r) => BIM_EST[r.estado] + (r.estado === "ej" || r.estado === "ob" ? " " + Math.round(r.pct) + " %" : "");
async function cargarBimDia() {
  if (!draft || !$("#bimDia")) return;
  const k = draft.obraId + "|" + draft.fecha;
  if (!bimCache[k]) {
    const { data, error } = await sb.from("avance_registros").select("id,fecha,estado,pct,nota,resumen,niveles,fotos,autor,total,volumen")
      .eq("obra_id", draft.obraId).eq("fecha", draft.fecha).order("creado");
    if (error) { const b = $("#bimDia"); if (b) b.innerHTML = `<span class="code">El visor 3D todavía no está activado en Supabase (falta ejecutar avance_bim.sql).</span>`; return; }
    bimCache[k] = data || [];
  }
  const rows = bimCache[k], box = $("#bimDia");
  if (!box || !draft || draft.obraId + "|" + draft.fecha !== k) return;
  const ya = new Set(draft.bim || []);
  $("#bimSum").textContent = rows.length ? rows.length + " registros" : "";
  box.innerHTML = rows.length ? `<div class="bimlist">${rows.map((r) => `
    <div class="bimrow"><div class="bimtop"><span class="bimst bimst-${esc(r.estado)}">${esc(bimLabel(r))}</span><b>${esc(r.resumen || r.total + " elementos")}</b>${ya.has(r.id) ? `<span class="pill">en el reporte</span>` : ""}</div>
      <span class="code">${esc(r.niveles || "")}${r.volumen ? " · " + esc(String(r.volumen).replace(".", ",")) + " m³" : ""}${r.autor ? " · " + esc(r.autor) : ""}</span>
      ${r.nota ? `<span>${esc(r.nota)}</span>` : ""}
      ${(r.fotos || []).length ? `<div class="bimth">${r.fotos.map((f) => `<img data-key="${esc(f.key)}" alt="Foto de avance">`).join("")}</div>` : ""}</div>`).join("")}</div>`
    : `<span class="code">Sin avances registrados en el visor para el ${fmtF(draft.fecha)}.</span>`;
  const btn = $("#bimBtn"); if (btn) btn.hidden = !rows.some((r) => !ya.has(r.id));
  pintarFotos();
  // reporte nuevo: trae solo el avance del día (actividades, fotos y observados)
  if (draft._autoBim && rows.some((r) => !ya.has(r.id))) traerBim();
}
// Asistencia del día tomada en Personal → mano de obra del reporte (por cargo, con horas)
const asisCache = {};
async function cargarAsisDia() {
  if (!draft || !draft.obraId || !draft.fecha) return;
  const k = draft.obraId + "|" + draft.fecha;
  if (!(k in asisCache)) {
    const { data, error } = await sb.from("asistencia").select("marcas").eq("obra_id", draft.obraId).eq("fecha", draft.fecha).maybeSingle();
    asisCache[k] = error ? null : data ? data.marcas || {} : {};
  }
  const mk = asisCache[k], box = $("#asisDia");
  if (!box || !draft || draft.obraId + "|" + draft.fecha !== k) return;
  if (mk === null) { box.hidden = true; delete draft._autoAsis; return; } // módulo de personal no activado
  const pres = Object.values(mk).filter((x) => x.e === "P" || x.e === "M");
  box.hidden = false;
  box.innerHTML = pres.length ? `<span class="code">Asistencia tomada en Personal: ${pres.length} ${pres.length === 1 ? "persona" : "personas"} en obra.</span><button class="btn sm" type="button" data-act="asisTraer">Traer de la asistencia</button>`
    : `<span class="code">Aún no hay asistencia tomada en Personal para este día.</span><a class="btn sm" href="/personal?obra=${encodeURIComponent(draft.obraId)}">Tomar asistencia</a>`;
  if (draft._autoAsis && pres.length && !totPer(draft.directa).n) traerAsis(); else delete draft._autoAsis;
}
function traerAsis() {
  delete draft._autoAsis;
  const mk = asisCache[draft.obraId + "|" + draft.fecha] || {}, g = { directa: {}, indirecta: {} };
  for (const x of Object.values(mk)) {
    if (x.e !== "P" && x.e !== "M") continue;
    const cat = x.cargo || "Sin cargo", k = PER_IND.includes(cat) ? "indirecta" : "directa", a = g[k][cat] = g[k][cat] || { n: 0, h: 0 };
    a.n++; a.h += (x.e === "P" ? 8 : 4) + num(x.hx);
  }
  let n = 0;
  for (const k of ["directa", "indirecta"]) {
    const usadas = new Set();
    for (const p of draft[k]) {
      const a = g[k][p.cat];
      if (a) { p.n = String(a.n); p.h = String(a.h); usadas.add(p.cat); n += a.n; }
      else if (k === "directa") { p.n = ""; p.h = ""; } // la directa es personal DLV: manda la asistencia; la indirecta conserva subcontratistas
    }
    for (const [cat, a] of Object.entries(g[k])) if (!usadas.has(cat)) { draft[k].push({ cat, n: String(a.n), h: String(a.h) }); n += a.n; }
  }
  setDirty(true); render(); toast(n + (n === 1 ? " persona pasada" : " personas pasadas") + " de la asistencia al reporte");
}
function traerBim() {
  delete draft._autoBim;
  const rows = bimCache[draft.obraId + "|" + draft.fecha] || [];
  draft.bim = draft.bim || [];
  let na = 0, nf = 0, sinCupo = 0;
  draft.actividades = draft.actividades.filter((a) => a.cod || a.desc || a.cant);
  draft.novedades = (draft.novedades || []).filter(Boolean);
  for (const r of rows) {
    if (draft.bim.includes(r.id)) continue;
    draft.actividades.push({ cod: "", desc: (r.resumen || r.total + " elementos") + " — " + bimLabel(r), ubic: r.niveles || "", und: r.volumen ? "m³" : "", cant: r.volumen ? String(r.volumen) : "", bim: r.id });
    na++;
    if (r.estado === "ob") draft.novedades.push("Observado en " + (r.resumen || "elementos") + (r.niveles ? " (" + r.niveles + ")" : "") + (r.nota ? ": " + r.nota : ""));
    for (const f of r.fotos || []) {
      if (draft.fotos.some((x) => x.key === f.key)) continue;
      if (draft.fotos.length >= 6) { sinCupo++; continue; }
      draft.fotos.push({ key: f.key, w: f.w, h: f.h, desc: (r.resumen || "") + " — " + bimLabel(r), ubic: r.niveles || "" });
      nf++;
    }
    draft.bim.push(r.id);
  }
  if (!draft.actividades.length) draft.actividades = [{ cod: "", desc: "", ubic: "", und: "", cant: "" }];
  if (!draft.novedades.length) draft.novedades = [""];
  setDirty(true); render();
  toast(`${na} actividades y ${nf} fotos pasadas al reporte` + (sinCupo ? ` (${sinCupo} fotos no entraron: máximo 6)` : ""));
}

/* ---------- render ---------- */
function renderObras() {
  const s = $("#obraSel");
  s.innerHTML = obras.length ? obras.map((o) => `<option value="${esc(o.id)}"${o.id === obraId ? " selected" : ""}>${esc(o.nombre)}</option>`).join("") : `<option value="">Sin obras asignadas</option>`;
  $("#btnNuevaObra").hidden = !esAdmin();
}
function render() {
  const m = $("#main");
  $("#top").hidden = !user;
  $("#dock").hidden = view !== "editor";
  if (!user) return renderLogin(m);
  if (view === "obra") return renderObraForm(m);
  if (view === "editor") { renderEditor(m); pintarFotos(); cargarBimDia(); cargarAsisDia(); return; }
  renderLista(m);
}
function renderLogin(m) {
  m.innerHTML = `<form class="login" id="loginForm">
    <div class="logo"><b>DLV</b><span>Reporte diario de obra</span></div>
    <p>Entra con el correo y la clave que te dio la oficina.</p>
    <label class="fld" for="lEmail"><span>Correo</span><input id="lEmail" type="email" autocomplete="username" required></label>
    <label class="fld" for="lPass"><span>Clave</span><input id="lPass" type="password" autocomplete="current-password" required></label>
    <span class="err" id="lErr"></span>
    <button class="btn primary" type="submit" id="lBtn">Entrar</button>
  </form>`;
}
function renderLista(m) {
  const o = obraActual();
  if (!o) {
    m.innerHTML = esAdmin()
      ? `<div class="empty"><h2 style="font-size:1.4rem">Crea tu primera obra</h2><span>Los datos de la obra se llenan una vez y salen en todos los reportes.</span><button class="btn primary" type="button" data-act="nuevaObra">+ Nueva obra</button></div>`
      : `<div class="empty"><b>Aún no tienes obras asignadas.</b><span>Pide al gerente de proyecto que te agregue a la obra.</span></div>`;
    return;
  }
  const di = diasInfo(o, hoy());
  m.innerHTML = `
  <section class="obracard">
    <div class="listhead"><h1>${esc(o.nombre)}</h1></div>
    <div class="kv">
      <div><small>Cliente</small><span>${esc(o.cliente || "—")}</span></div>
      <div><small>Contrato / proforma</small><span>${esc(o.contrato || "—")}</span></div>
      <div><small>Residente</small><span>${esc(o.residente || "—")}</span></div>
      <div><small>Fiscalizador</small><span>${esc(o.fiscalizador || "—")}</span></div>
      <div><small>Plazo</small><span>${o.plazo ? esc(o.plazo) + " días · inicio " + fmtF(o.inicio) : "—"}</span></div>
      <div><small>Hoy</small><span>${di.trans !== "" ? `Día ${di.trans}${di.rest !== "" ? ` · ${di.rest} restantes` : ""}` : "—"}</span></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn sm primary" href="/visor.html?obra=${encodeURIComponent(o.id)}">Visor 3D y avance</a>${esAdmin() ? `<button class="btn sm" type="button" data-act="editarObra">Editar obra y residentes</button>` : ""}</div>
  </section>
  <div class="listhead"><h1>Reportes</h1><button class="btn hivis" type="button" data-act="nuevoRep">+ Reporte de hoy</button></div>
  <div class="list">${reportes.length ? reportes.map((r) => {
    const tp = totPer(r.directa).n + totPer(r.indirecta).n, acts = (r.actividades || []).filter((a) => a.desc).length;
    return `<button class="rep" type="button" data-open="${esc(r.id)}">
      <span class="n">${String(r.numero || 0).padStart(3, "0")}</span>
      <span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${diaSemana(r.fecha)} ${fmtF(r.fecha)}</span>
      <span class="d">${tp} personas · ${acts} actividades · ${(r.fotos || []).length} fotos</span></span>
      <span class="pill">${esc(r.turno || "Día")}</span></button>`;
  }).join("") : `<div class="empty"><span>Aún no hay reportes de esta obra.</span><button class="btn hivis" type="button" data-act="nuevoRep">+ Primer reporte</button></div>`}</div>`;
}
function renderObraForm(m) {
  const o = obraDraft;
  const f = (k, l, t = "text", ph = "") => `<label class="fld" for="o_${k}"><span>${l}</span><input id="o_${k}" type="${t}" data-o="${k}" value="${esc(o[k] ?? "")}" placeholder="${esc(ph)}" ${t === "number" ? 'inputmode="numeric"' : ""}></label>`;
  const res = perfiles;
  m.innerHTML = `
  <section class="sec" open><summary><h2>${o.id ? "Editar obra" : "Nueva obra"}</h2></summary>
  <div class="body">
    ${f("nombre", "Nombre de la obra", "text", "Ej.: Edificio Rivoria")}
    <div class="grid2">${f("cliente", "Cliente / propietario")}${f("contrato", "Contrato / proforma N.°", "text", "Ej.: PROFORMA 014-2026")}</div>
    <div class="grid2">${f("residente", "Residente de obra")}${f("fiscalizador", "Fiscalizador")}</div>
    ${f("ubicacion", "Ubicación", "text", "Dirección, Cuenca")}
    <div class="grid2">${f("inicio", "Inicio contractual", "date")}${f("plazo", "Plazo (días calendario)", "number")}</div>
    ${f("gerente", "Gerente de proyecto")}
    <div class="sub">Personas que pueden llenar reportes de esta obra</div>
    ${res.length ? `<div class="miembros">${res.map((p) => `<label class="chk" for="m_${p.id}"><input type="checkbox" id="m_${p.id}" data-m="${p.id}"${miembros.includes(p.id) ? " checked" : ""}>${esc(p.nombre || p.email)}${p.rol === "admin" ? " (admin)" : ""}</label>`).join("")}</div>`
      : `<span class="code">Agrega usuarios en Supabase (Authentication → Users) y aparecerán aquí.</span>`}
    ${confirmDel === "obra" ? `<div class="confirm"><span>¿Archivar la obra? Sus reportes se conservan.</span><button class="btn sm danger" type="button" data-act="borrarObraOk">Sí, archivar</button><button class="btn sm" type="button" data-act="cancelDel">Cancelar</button></div>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between">
      <span style="display:flex;gap:8px"><button class="btn" type="button" data-act="cancelObra">Cancelar</button>${o.id ? `<button class="btn danger" type="button" data-act="borrarObra">Archivar</button>` : ""}</span>
      <button class="btn primary" type="button" data-act="guardarObra">Guardar obra</button>
    </div>
  </div></section>`;
}
function renderEditor(m) {
  const o = obraActual() || {}, d = draft, di = diasInfo(o, d.fecha);
  const td = totPer(d.directa), ti = totPer(d.indirecta);
  const climaOpts = ["Soleado", "Nublado", "Lluvia ligera", "Lluvia fuerte", "Viento fuerte", "Tormenta eléctrica"];
  const estOpts = ["Operativo", "En reparación", "Parado"];
  const sso = d.sso || {}, nAct = (d.actividades || []).filter((a) => a.desc || a.cod).length;
  const puedeBorrar = d.id && (esAdmin() || d.creadoPor === user.id);
  m.innerHTML = `
  <details class="sec" open><summary><span class="num">1</span><h2>Datos del día</h2><span class="sum">RDO-${String(d.numero).padStart(4, "0")}</span></summary>
    <div class="body">
      <div class="grid3">${inp("fecha", "Fecha", "date")}${sel("turno", "Turno", ["Día", "Noche", "Día y noche"])}${inp("numero", "Reporte N.°", "number")}</div>
      <div class="plazo">
        <div><small>Plazo</small><b>${o.plazo ? esc(o.plazo) + " d" : "—"}</b></div>
        <div><small>Término</small><b>${di.fin ? fmtF(di.fin) : "—"}</b></div>
        <div><small>Transcurridos</small><b>${di.trans !== "" ? di.trans : "—"}</b></div>
        <div class="${di.rest !== "" && di.rest < 0 ? "late" : ""}"><small>Restantes</small><b>${di.rest !== "" ? di.rest : "—"}</b></div>
      </div>
      ${inp("avance", "% avance físico acumulado", "number", 'placeholder="Ej.: 42"')}
    </div></details>
  <details class="sec"><summary><span class="num">2</span><h2>Clima</h2><span class="sum">${esc(d.clima.manana)} / ${esc(d.clima.tarde)}</span></summary>
    <div class="body">
      <div class="grid2">${sel("clima.manana", "Mañana", climaOpts)}${sel("clima.tarde", "Tarde", climaOpts)}</div>
      <div class="grid2">${inp("clima.horasPar", "Horas paralizadas", "number")}${inp("clima.obs", "Observaciones")}</div>
    </div></details>
  <details class="sec"><summary><span class="num">3</span><h2>Equipos</h2><span class="sum">${d.equipos.filter((e) => num(e.cant) || num(e.horas)).length} en uso</span></summary>
    <div class="body">${["liviano", "pesado"].map((tipo) => `
      <div class="sub">Equipos ${tipo}s</div>
      <div class="rows">${d.equipos.map((e, i) => e.tipo !== tipo ? "" : `
        <div class="r r-eq">${inp(`equipos.${i}.equipo`, "Equipo")}${sel(`equipos.${i}.estado`, "Estado", estOpts)}${inp(`equipos.${i}.horas`, "Horas", "number")}${inp(`equipos.${i}.cant`, "Cant.", "number")}
        <button class="x" type="button" data-del="equipos.${i}" aria-label="Quitar equipo">×</button></div>`).join("")}</div>
      <button class="btn sm add" type="button" data-add="equipos" data-tipo="${tipo}">+ Equipo ${tipo}</button>`).join("")}
    </div></details>
  <details class="sec"><summary><span class="num">4</span><h2>Mano de obra</h2><span class="sum">${td.n + ti.n} personas</span></summary>
    <div class="body"><div class="asisdia" id="asisDia" hidden></div>${[["directa", "Directa (DLV)", td], ["indirecta", "Indirecta / subcontratos", ti]].map(([k, t, tot]) => `
      <div class="sub">${t}</div>
      <div class="rows">${d[k].map((p, i) => `
        <div class="r r-per">${inp(`${k}.${i}.cat`, "Categoría")}${inp(`${k}.${i}.n`, "N.° pers.", "number")}${inp(`${k}.${i}.h`, "Horas", "number")}
        <button class="x" type="button" data-del="${k}.${i}" aria-label="Quitar">×</button></div>`).join("")}</div>
      <div class="tot"><button class="btn sm" type="button" data-add="${k}">+ Categoría</button><span>Total: <b id="tot_${k}">${tot.n}</b> pers.</span></div>`).join("")}
    </div></details>
  <details class="sec" open><summary><span class="num">5</span><h2>Actividades</h2><span class="sum">${nAct} rubros</span></summary>
    <div class="body">
      <span class="code">Usa el código de rubro del presupuesto. El acumulado suma los reportes anteriores de esta obra.</span>
      <div class="rows">${d.actividades.map((a, i) => `
        <div class="r r-act">${inp(`actividades.${i}.cod`, "Cód.")}${inp(`actividades.${i}.desc`, "Rubro / descripción")}
          <button class="x" type="button" data-del="actividades.${i}" aria-label="Quitar actividad">×</button>
          <div class="ext">${inp(`actividades.${i}.ubic`, "Ubicación (piso, eje)")}${inp(`actividades.${i}.und`, "Und")}${inp(`actividades.${i}.cant`, "Cant. día", "number")}
            <div class="fld"><span>Acumulado</span><div class="acum" id="acum_${i}">${r2(acumPrevio(a, d) + num(a.cant))}</div></div></div>
        </div>`).join("")}</div>
      <button class="btn sm add" type="button" data-add="actividades">+ Actividad</button>
    </div></details>
  <details class="sec"><summary><span class="num">6</span><h2>Materiales recibidos</h2><span class="sum">${d.materiales.length}</span></summary>
    <div class="body">
      <div class="rows">${d.materiales.map((x, i) => `
        <div class="r r-mat">${inp(`materiales.${i}.material`, "Material")}${inp(`materiales.${i}.proveedor`, "Proveedor")}
          <button class="x" type="button" data-del="materiales.${i}" aria-label="Quitar material">×</button>
          <div class="ext">${inp(`materiales.${i}.guia`, "Guía / factura")}${inp(`materiales.${i}.und`, "Und")}${inp(`materiales.${i}.cant`, "Cant.", "number")}${sel(`materiales.${i}.conforme`, "Conforme", ["Sí", "No"])}</div>
        </div>`).join("") || `<span class="code">Sin materiales recibidos hoy.</span>`}</div>
      <button class="btn sm add" type="button" data-add="materiales">+ Material</button>
    </div></details>
  <details class="sec"><summary><span class="num">7</span><h2>Seguridad y calidad</h2><span class="sum">${["charla", "epp", "arnes", "bordes", "andamios"].filter((k) => sso[k]).length}/5</span></summary>
    <div class="body">
      <div class="checks">${[["charla", "Charla de 5 min"], ["epp", "EPP completo"], ["arnes", "Arnés en altura"], ["bordes", "Bordes protegidos"], ["andamios", "Andamios revisados"]].map(([k, l]) => `
        <label class="chk" for="c_${k}"><input type="checkbox" id="c_${k}" data-c="sso.${k}"${sso[k] ? " checked" : ""}>${l}</label>`).join("")}</div>
      <div class="grid2">${inp("sso.tema", "Tema de la charla")}${inp("sso.incidentes", "Incidentes", "text", 'placeholder="Ninguno"')}</div>
      <div class="sub">Ensayos</div>
      <div class="grid2">${inp("ensayos.slump", "Asentamiento (cm)", "number")}${inp("ensayos.cilindros", "Cilindros (N.°)", "number")}</div>
      <div class="grid2">${inp("ensayos.fc", "f'c (kg/cm²)", "number")}${inp("ensayos.otros", "Otros ensayos")}</div>
    </div></details>
  <details class="sec"><summary><span class="num">8</span><h2>Novedades y fiscalización</h2><span class="sum">${d.novedades.filter(Boolean).length}</span></summary>
    <div class="body">
      <span class="code">Retrasos, órdenes de cambio, instrucciones del fiscalizador y pendientes.</span>
      <div class="rows">${d.novedades.map((t, i) => `<div class="r r-nov">${inp(`novedades.${i}`, `Novedad ${i + 1}`)}<button class="x" type="button" data-del="novedades.${i}" aria-label="Quitar novedad">×</button></div>`).join("")}</div>
      <button class="btn sm add" type="button" data-add="novedades">+ Novedad</button>
    </div></details>
  <details class="sec" open><summary><span class="num">3D</span><h2>Avance en el modelo</h2><span class="sum" id="bimSum"></span></summary>
    <div class="body">
      <div id="bimDia"><span class="code">Buscando avances registrados en el visor…</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm hivis" type="button" data-act="bimTraer" id="bimBtn" hidden>Pasar al reporte</button><a class="btn sm" href="/visor.html?obra=${encodeURIComponent(d.obraId)}">Abrir visor 3D</a></div>
    </div></details>
  <details class="sec" open><summary><span class="num">9</span><h2>Panel fotográfico</h2><span class="sum">${d.fotos.length}/6</span></summary>
    <div class="body"><div class="fotos">
      ${d.fotos.map((f, i) => `
        <div class="foto"><img data-key="${esc(f.key)}" alt="${esc(f.desc || "Foto " + (i + 1))}">
          <div class="m"><div class="bar"><span class="code">Foto ${i + 1}</span><button class="x" type="button" data-del="fotos.${i}" aria-label="Quitar foto">×</button></div>
            <input type="text" id="f_fotos_${i}_desc" data-p="fotos.${i}.desc" value="${esc(f.desc || "")}" placeholder="Descripción" aria-label="Descripción foto ${i + 1}">
            <input type="text" id="f_fotos_${i}_ubic" data-p="fotos.${i}.ubic" value="${esc(f.ubic || "")}" placeholder="Ubicación" aria-label="Ubicación foto ${i + 1}"></div></div>`).join("")}
      ${d.fotos.length < 6 ? `<label class="addfoto" for="fotoIn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Tomar o elegir foto<span class="code" id="fotoMsg">Se comprime a ~250 KB</span></label>` : ""}
    </div></div></details>
  ${puedeBorrar ? (confirmDel === "rep"
    ? `<div class="confirm"><span>¿Borrar el reporte ${String(d.numero).padStart(3, "0")}? No se puede deshacer.</span><button class="btn sm danger" type="button" data-act="borrarRepOk">Sí, borrar</button><button class="btn sm" type="button" data-act="cancelDel">Cancelar</button></div>`
    : `<div><button class="btn sm danger" type="button" data-act="borrarRep">Borrar este reporte</button></div>`) : ""}`;
  setDirty(dirty);
}

/* ---------- eventos ---------- */
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "loginForm") return;
  e.preventDefault();
  const b = $("#lBtn"); b.disabled = true; b.textContent = "Entrando…"; $("#lErr").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
  if (error) { $("#lErr").textContent = "Correo o clave incorrectos."; b.disabled = false; b.textContent = "Entrar"; }
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.p && draft) {
    setP(draft, t.dataset.p, t.value); setDirty(true);
    const mm = t.dataset.p.match(/^actividades\.(\d+)\.(cant|cod|desc)$/);
    if (mm) { const i = +mm[1], a = draft.actividades[i], el = $("#acum_" + i); if (el) el.textContent = r2(acumPrevio(a, draft) + num(a.cant)); }
    const pm = t.dataset.p.match(/^(directa|indirecta)\.\d+\.n$/);
    if (pm) { const el = $("#tot_" + pm[1]); if (el) el.textContent = totPer(draft[pm[1]]).n; }
    if (t.dataset.p === "fecha") render();
  } else if (t.dataset.o && obraDraft) obraDraft[t.dataset.o] = t.value;
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.c && draft) { setP(draft, t.dataset.c, t.checked); setDirty(true); }
  if (t.dataset.m) { const id = t.dataset.m; miembros = t.checked ? [...new Set([...miembros, id])] : miembros.filter((x) => x !== id); }
  if (t.id === "obraSel") { obraId = t.value; try { localStorage.setItem("dlv-obra", obraId); } catch (_) {} view = "lista"; draft = null; cargarReportes(); }
  if (t.id === "fotoIn") { subirFotos([...t.files]); t.value = ""; }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.open) return abrir(b.dataset.open);
  if (b.dataset.add && draft) {
    const k = b.dataset.add;
    const nuevo = { equipos: { tipo: b.dataset.tipo || "liviano", equipo: "", estado: "Operativo", horas: "", cant: "" }, directa: { cat: "", n: "", h: "" }, indirecta: { cat: "", n: "", h: "" },
      actividades: { cod: "", desc: "", ubic: "", und: "", cant: "" }, materiales: { material: "", proveedor: "", guia: "", und: "", cant: "", conforme: "Sí" }, novedades: "" }[k];
    draft[k].push(nuevo); setDirty(true); render(); return;
  }
  if (b.dataset.del && draft) { const [k, i] = b.dataset.del.split("."); draft[k].splice(+i, 1); setDirty(true); render(); return; }
  const a = b.dataset.act;
  if (b.id === "btnSalir") { await sb.auth.signOut(); return; }
  if (b.id === "btnNuevaObra" || a === "nuevaObra") { obraDraft = { nombre: "", cliente: "", contrato: "", residente: "", fiscalizador: "", ubicacion: "", inicio: "", plazo: "", gerente: "Ing. Andrés León V." }; await cargarMiembros(null); confirmDel = null; view = "obra"; render(); return; }
  if (a === "editarObra") { obraDraft = clone(obraActual()); await cargarMiembros(obraDraft.id); confirmDel = null; view = "obra"; render(); return; }
  if (a === "cancelObra") { view = draft ? "editor" : "lista"; render(); return; }
  if (a === "guardarObra") return guardarObra();
  if (a === "borrarObra") { confirmDel = "obra"; render(); return; }
  if (a === "borrarObraOk") return archivarObra();
  if (a === "cancelDel") { confirmDel = null; render(); return; }
  if (a === "nuevoRep") { const o = obraActual(); if (!o) return; draft = nuevoReporte(o); draft._autoBim = true; draft._autoAsis = true; confirmDel = null; view = "editor"; setDirty(true); render(); window.scrollTo(0, 0); return; }
  if (a === "borrarRep") { confirmDel = "rep"; render(); return; }
  if (a === "bimTraer") return traerBim();
  if (a === "asisTraer") return traerAsis();
  if (a === "borrarRepOk") return borrarRep();
  if (b.id === "btnVolver") {
    if (dirty && !b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "¿Salir sin guardar?"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "← Reportes"; }, 3000); return; }
    b.dataset.sure = ""; b.textContent = "← Reportes"; draft = null; dirty = false; view = "lista"; render(); window.scrollTo(0, 0); return;
  }
  if (b.id === "btnGuardar") return guardarRep();
  if (b.id === "btnPDF") return generarPDF();
});
function abrir(id) {
  const r = reportes.find((x) => x.id === id); if (!r) return;
  draft = clone(r); const base = nuevoReporte(obraActual() || { id: obraId });
  for (const k of Object.keys(base)) if (draft[k] == null) draft[k] = base[k];
  confirmDel = null; view = "editor"; dirty = false; render(); window.scrollTo(0, 0);
}

async function guardarObra() {
  const o = obraDraft; if (!o.nombre.trim()) return toast("Escribe el nombre de la obra.");
  const row = { nombre: o.nombre.trim(), cliente: o.cliente || null, contrato: o.contrato || null, residente: o.residente || null, fiscalizador: o.fiscalizador || null, ubicacion: o.ubicacion || null, inicio: o.inicio || null, plazo: o.plazo ? parseInt(o.plazo, 10) : null, gerente: o.gerente || null };
  const q = o.id ? sb.from("obras").update(row).eq("id", o.id).select().single() : sb.from("obras").insert(row).select().single();
  const { data, error } = await q;
  if (error) return toast("No se pudo guardar la obra: " + error.message);
  // miembros
  await sb.from("obra_miembros").delete().eq("obra_id", data.id);
  if (miembros.length) { const { error: em } = await sb.from("obra_miembros").insert(miembros.map((u) => ({ obra_id: data.id, user_id: u }))); if (em) toast("Obra guardada, pero no se pudieron asignar residentes."); }
  obraId = data.id; toast("Obra guardada"); view = draft ? "editor" : "lista"; await cargarObras();
}
async function archivarObra() {
  const { error } = await sb.from("obras").update({ activa: false }).eq("id", obraDraft.id);
  if (error) return toast("No se pudo archivar la obra.");
  obraId = ""; confirmDel = null; view = "lista"; toast("Obra archivada"); await cargarObras();
}
async function guardarRep() {
  const d = clone(draft); delete d._autoBim; delete d._autoAsis; d.numero = parseInt(d.numero, 10) || 1;
  d.actividades = d.actividades.map((a) => ({ ...a, acum: r2(acumPrevio(a, draft) + num(a.cant)) }));
  const { id, obraId: oid, numero, fecha, turno, creadoPor, ...datos } = d;
  const row = { obra_id: oid, numero, fecha, turno, datos, actualizado: new Date().toISOString() };
  const btn = $("#btnGuardar"); btn.disabled = true; btn.textContent = "Guardando…";
  try {
    const q = id ? sb.from("reportes").update(row).eq("id", id).select().single() : sb.from("reportes").insert(row).select().single();
    const { data, error } = await q;
    if (error) throw error;
    draft.id = data.id; draft.creadoPor = data.creado_por;
    const i = reportes.findIndex((r) => r.id === data.id); const plano = { ...fromRow(data), creadoPor: data.creado_por };
    if (i >= 0) reportes[i] = plano; else reportes.unshift(plano);
    reportes.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || (b.numero || 0) - (a.numero || 0));
    setDirty(false); toast("Reporte guardado");
  } catch (err) {
    toast(String(err.code) === "23505" ? "Ya existe un reporte con ese número en esta obra." : "No se pudo guardar: " + (err.message || "revisa tu conexión"));
  } finally { btn.disabled = false; btn.textContent = "Guardar"; }
}
async function borrarRep() {
  const { error } = await sb.from("reportes").delete().eq("id", draft.id);
  if (error) return toast("No se pudo borrar el reporte.");
  reportes = reportes.filter((r) => r.id !== draft.id); draft = null; dirty = false; confirmDel = null; view = "lista"; toast("Reporte borrado"); render();
}

/* ---------- PDF ---------- */
async function imgData(url) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
  return { data: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height };
}
async function generarPDF() {
  if (!window.jspdf) return toast("No se cargó el generador de PDF. Revisa tu conexión y recarga.");
  const btn = $("#btnPDF"); btn.disabled = true; btn.textContent = "Generando…";
  try {
    const o = obraActual() || {}, d = draft;
    const fotos = (d.fotos || []).slice(0, 6);
    let urls = []; try { urls = await urlsFotos(fotos.map((f) => f.key)); } catch (_) {}
    const datos = await Promise.all(urls.map((u) => (u ? imgData(u).catch(() => null) : null)));
    const doc = window.pdfDLV(o, d, datos, (a) => acumPrevio(a, d) + num(a.cant));
    const name = `RDO-${String(d.numero).padStart(4, "0")} ${(o.nombre || "Obra").replace(/[\\/:*?"<>|]/g, "")} ${d.fecha}.pdf`;
    const blob = doc.output("blob"), file = new File([blob], name, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); } catch (err) { if (err.name !== "AbortError") doc.save(name); }
    } else doc.save(name);
  } catch (err) { toast("No se pudo generar el PDF."); }
  finally { btn.disabled = false; btn.textContent = "PDF"; }
}

/* ---------- arranque ---------- */
async function entrar(session) {
  user = session ? session.user : null;
  if (!user) { perfil = null; obras = []; reportes = []; view = "lista"; draft = null; render(); return; }
  const { data } = await sb.from("perfiles").select("*").eq("id", user.id).maybeSingle();
  perfil = data || { rol: "residente" };
  $("#quien").textContent = perfil.nombre || user.email;
  view = "lista"; render(); await cargarObras();
}
(async () => {
  try {
    const cfg = await (await fetch("/api/config")).json();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("config");
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch (_) {
    $("#main").innerHTML = `<div class="empty"><b>Falta configurar la app.</b><span>Revisa las variables SUPABASE_URL y SUPABASE_ANON_KEY en Cloudflare Pages (paso 4 de la guía).</span></div>`;
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  await entrar(session);
  sb.auth.onAuthStateChange((ev, s) => { if (ev === "SIGNED_IN" && !user) entrar(s); if (ev === "SIGNED_OUT") entrar(null); });
})();
})();
