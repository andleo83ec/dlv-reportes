// DLV Plataforma — Control de documentos: listado maestro de manuales, procedimientos, instructivos y formatos con su versión vigente,
// historial de versiones (elaboró, revisó, aprobó) con el archivo en R2, revisión periódica, acuse de lectura y PDF del listado maestro.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hoy = () => ymd(new Date());
const fmtF = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
const masMeses = (f, n) => { const [y, m, d] = f.split("-").map(Number); const x = new Date(y, m - 1 + n, d); return ymd(x); };
const peso = (b) => !b ? "" : b < 1048576 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1048576).toLocaleString("es-EC", { maximumFractionDigits: 1 }) + " MB";
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3600); }

const TIPOS = { manual: ["Manual", "MA"], politica: ["Política", "PO"], procedimiento: ["Procedimiento", "PR"], instructivo: ["Instructivo", "IN"], formato: ["Formato / registro", "FO"], externo: ["Documento externo", "EX"] };
const PLURAL = { manual: "Manuales", politica: "Políticas", procedimiento: "Procedimientos", instructivo: "Instructivos", formato: "Formatos y registros", externo: "Documentos externos" };
const AREAS = { Gerencia: "GER", "Oficina técnica": "OT", Obra: "OBR", Administración: "ADM", SSO: "SSO", Calidad: "CAL" };
const EST = { elaboracion: "En elaboración", vigente: "Vigente", obsoleto: "Obsoleto" };
// Listado inicial sugerido: los procesos que ya cubre la plataforma y los básicos de seguridad. Se edita libremente.
const SUGERIDOS = [
  ["MA-GER-01", "Manual de organización y procedimientos de DLV", "manual", "Gerencia", "", "Estructura, cargos, responsabilidades y mapa de procesos."],
  ["PO-GER-01", "Política de calidad, seguridad y ambiente", "politica", "Gerencia", "", ""],
  ["PR-CAL-01", "Control de documentos y registros", "procedimiento", "Calidad", "/documentos", "Codificación, aprobación, distribución y archivo de documentos."],
  ["PR-OT-01", "Estudio de propuestas y presupuestos", "procedimiento", "Oficina técnica", "/propuestas", ""],
  ["PR-OBR-01", "Inicio de obra", "procedimiento", "Obra", "/ciclo", "Entrega de obra adjudicada y análisis previo a la ejecución."],
  ["PR-OBR-02", "Reporte diario y bitácora de obra", "procedimiento", "Obra", "/reportes", ""],
  ["PR-OBR-03", "Control de avance con el modelo 3D", "procedimiento", "Obra", "/visor", ""],
  ["PR-OBR-04", "Requerimientos de información, actas y correspondencia", "procedimiento", "Obra", "/rdi", ""],
  ["PR-OBR-05", "Cierre y entrega de obra", "procedimiento", "Obra", "/ciclo", ""],
  ["PR-ADM-01", "Estados de pago al mandante", "procedimiento", "Administración", "/planillas", ""],
  ["PR-ADM-02", "Subcontratos y garantías", "procedimiento", "Administración", "/subcontratos", ""],
  ["PR-ADM-03", "Compras y recepción de materiales", "procedimiento", "Administración", "", "Cotización, comparativo, orden de pedido, recepción y factura."],
  ["PR-ADM-04", "Control de costos por obra", "procedimiento", "Administración", "/costos", ""],
  ["PR-ADM-05", "Contratación, asistencia y roles de pago", "procedimiento", "Administración", "/personal", ""],
  ["PR-SSO-01", "Seguridad y salud en obra", "procedimiento", "SSO", "", "Inducción, EPP, charlas diarias, permisos de trabajo e investigación de incidentes."],
  ["FO-OBR-01", "Reporte diario de obra", "formato", "Obra", "/reportes", ""],
  ["FO-OBR-02", "Requerimiento de información (RDI)", "formato", "Obra", "/rdi", ""],
  ["FO-OBR-03", "Acta de reunión", "formato", "Obra", "/rdi", ""],
  ["FO-OBR-04", "Protocolo de inicio de obra", "formato", "Obra", "/ciclo", ""],
  ["FO-OBR-05", "Protocolo de cierre y encuesta al cliente", "formato", "Obra", "/ciclo", ""],
  ["FO-ADM-01", "Planilla de estado de pago", "formato", "Administración", "/planillas", ""],
  ["FO-ADM-02", "Planilla de subcontrato", "formato", "Administración", "/subcontratos", ""],
  ["FO-ADM-03", "Rol de pagos", "formato", "Administración", "/personal", ""],
  ["FO-ADM-04", "Informe de costos de obra", "formato", "Administración", "/costos", ""],
  ["FO-GER-01", "Informe semanal de obra", "formato", "Gerencia", "/tablero", ""],
  ["FO-OT-01", "Oferta económica", "formato", "Oficina técnica", "/propuestas", ""],
  ["FO-SSO-01", "Registro de entrega de EPP", "formato", "SSO", "", ""],
  ["FO-SSO-02", "Registro de charla de seguridad", "formato", "SSO", "", ""]
];

let sb = null, user = null, perfil = null, docs = [], vers = [], lecs = [], sinTablas = false;
let view = "lista", doc = null, dirty = false, confirm = null, nv = null, subiendo = false;
let fBus = "", fTipo = "", fArea = "", fRev = false;
const esAdmin = () => perfil && perfil.rol === "admin";
const proxRev = (d) => d.estado === "vigente" && d.vigente_desde ? masMeses(d.vigente_desde, d.revision_meses || 12) : null;
const vencida = (d) => { const p = proxRev(d); return p && p < hoy(); };
const porVencer = (d) => { const p = proxRev(d); return p && p >= hoy() && p <= masMeses(hoy(), 1); };
const leido = (d) => !d.version || lecs.some((l) => l.documento_id === d.id && l.version === d.version && l.usuario_id === user.id);
const versDe = (id) => vers.filter((v) => v.documento_id === id).sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
const siguienteVersion = (d) => { if (!d.version) return "1"; const n = parseFloat(String(d.version).replace(",", ".")); return isFinite(n) ? String(Math.floor(n) + 1) : d.version + "-1"; };
const sugCodigo = (tipo, area) => { const pre = (TIPOS[tipo] || ["", "DOC"])[1] + "-" + (AREAS[area] || "GEN") + "-"; const n = docs.filter((d) => d.codigo.startsWith(pre)).map((d) => parseInt(d.codigo.slice(pre.length), 10) || 0); return pre + String((n.length ? Math.max(...n) : 0) + 1).padStart(2, "0"); };

/* ---------- datos ---------- */
async function cargar() {
  const [a, b, c] = await Promise.all([
    sb.from("documentos").select("*").order("codigo"),
    sb.from("documento_versiones").select("*").order("creado"),
    sb.from("documento_lecturas").select("*")
  ]);
  if (a.error) { sinTablas = true; return render(); }
  docs = a.data || []; vers = b.data || []; lecs = c.data || [];
  const qs = new URLSearchParams(location.search), id = qs.get("doc");
  if (id && docs.find((d) => d.id === id)) return abrir(docs.find((d) => d.id === id));
  render();
}
async function tok() { const { data: { session } } = await sb.auth.getSession(); return session ? session.access_token : ""; }
async function abrirArchivo(key, nombre) {
  const w = window.open("", "_blank"); // se abre antes de esperar para que Safari no la bloquee
  try {
    const r = await fetch("/api/documentos?key=" + encodeURIComponent(key), { headers: { Authorization: "Bearer " + (await tok()) } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo abrir");
    const url = URL.createObjectURL(await r.blob());
    if (w) w.location = url; else { const a = document.createElement("a"); a.href = url; a.download = nombre || "documento"; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { if (w) w.close(); toast(e.message); }
}

/* ---------- render ---------- */
const secAbierta = {};
document.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.sec) secAbierta[view + d.dataset.sec] = d.open; }, true);
function aplicarSecciones() { document.querySelectorAll("details[data-sec]").forEach((d) => { const k = view + d.dataset.sec; if (k in secAbierta) d.open = secAbierta[k]; }); }
function render() { renderBase(); aplicarSecciones(); }
function setDirty(v) { dirty = v; const e = $("#estado"); e.className = "state" + (v ? " dirty" : ""); e.textContent = v ? "Sin guardar" : "Guardado"; }
function renderBase() {
  const m = $("#main");
  $("#top").hidden = !user;
  $("#dock").hidden = view !== "doc";
  if (view === "doc") { $("#btnPDF").hidden = true; $("#btnGuardar").hidden = !esAdmin(); $("#btnVolver").textContent = "← Listado"; }
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (sinTablas) { m.innerHTML = `<div class="empty"><b>Falta activar el control de documentos.</b><span>Ejecuta <b>supabase/documentos.sql</b> en Supabase → SQL Editor y recarga.</span></div>`; return; }
  if (view === "doc") return renderDoc(m);
  renderLista(m);
}
function filtrados() {
  const q = fBus.trim().toLowerCase();
  return docs.filter((d) => (!fTipo || d.tipo === fTipo) && (!fArea || d.area === fArea) && (!fRev || vencida(d) || porVencer(d))
    && (!q || [d.codigo, d.titulo, d.responsable, d.descripcion].some((x) => String(x || "").toLowerCase().includes(q))));
}
function renderLista(m) {
  const vig = docs.filter((d) => d.estado === "vigente"), venc = docs.filter(vencida), pv = docs.filter(porVencer), elab = docs.filter((d) => d.estado === "elaboracion");
  const nuevos = vig.filter((d) => d.archivo_key && !leido(d));
  const lista = filtrados(), areas = [...new Set(docs.map((d) => d.area).filter(Boolean))].sort();
  const grupos = Object.keys(TIPOS).map((t) => ({ t, items: lista.filter((d) => d.tipo === t) })).filter((g) => g.items.length);
  m.innerHTML = `
  <section class="obracard"><div class="listhead"><h1>Listado maestro</h1><div class="acts">${docs.length ? `<button class="btn sm" type="button" data-act="pdf">PDF del listado</button>` : ""}${esAdmin() ? `<button class="btn hivis" type="button" data-act="nuevo">+ Documento</button>` : ""}</div></div>
    <div class="kpis"><div><small>Documentos</small><b>${docs.length}</b></div><div><small>Vigentes</small><b>${vig.length}</b></div><div><small>En elaboración</small><b>${elab.length}</b></div><div><small>Revisión vencida</small><b class="${venc.length ? "rojo" : ""}">${venc.length}</b></div></div>
    ${venc.length || pv.length ? `<button class="alertbar${venc.length ? " mal" : ""}" type="button" data-act="verRev"><b>${venc.length ? venc.length + (venc.length === 1 ? " documento con la revisión vencida" : " documentos con la revisión vencida") : ""}${venc.length && pv.length ? " · " : ""}${pv.length ? pv.length + " por revisar este mes" : ""}</b><span>${[...venc, ...pv].slice(0, 3).map((d) => esc(d.codigo)).join(" · ")}</span></button>` : ""}
    ${nuevos.length ? `<div class="alertbar"><b>${nuevos.length === 1 ? "1 documento actualizado" : nuevos.length + " documentos actualizados"} que aún no confirmas haber leído</b><span>${nuevos.slice(0, 3).map((d) => esc(d.codigo + " v" + d.version)).join(" · ")}</span></div>` : ""}
  </section>
  ${docs.length ? `<div class="filtros">
    <label class="fld"><span>Buscar</span><input id="fBus" type="search" placeholder="Código, título o responsable" value="${esc(fBus)}"></label>
    <label class="fld"><span>Tipo</span><select id="fTipo"><option value="">Todos</option>${Object.entries(TIPOS).map(([k, [v]]) => `<option value="${k}"${fTipo === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="fld"><span>Área</span><select id="fArea"><option value="">Todas</option>${areas.map((a) => `<option${fArea === a ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></label>
    <label class="chk"><input type="checkbox" id="fRev"${fRev ? " checked" : ""}> Por revisar</label></div>` : ""}
  ${grupos.map((g) => `<div class="capt">${PLURAL[g.t]} <span class="code">${g.items.length}</span></div>
    <div class="list">${g.items.map(fila).join("")}</div>`).join("")
    || (docs.length ? `<div class="empty"><span>Ningún documento coincide con el filtro.</span></div>`
    : `<div class="empty"><b>Aún no hay documentos.</b><span>Es el listado de manuales, procedimientos y formatos de DLV con su versión vigente, quién la aprobó y cuándo toca revisarla.</span>
      ${esAdmin() ? `<button class="btn hivis" type="button" data-act="sugeridos">Cargar listado sugerido (${SUGERIDOS.length} documentos)</button><button class="btn" type="button" data-act="nuevo">+ Documento en blanco</button>` : ""}</div>`)}
  <span class="code">Códigos: tipo-área-número (MA manual, PO política, PR procedimiento, IN instructivo, FO formato, EX externo · GER, OT, OBR, ADM, SSO, CAL).</span>`;
}
function fila(d) {
  const p = proxRev(d), cls = vencida(d) ? "mal" : porVencer(d) ? "aviso" : "";
  return `<button class="rep doc" type="button" data-doc="${esc(d.id)}"><span class="cod">${esc(d.codigo)}</span>
    <span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${esc(d.titulo)}</span>
      <span class="d">${esc([d.area, d.responsable, d.version ? "v" + d.version + (d.vigente_desde ? " desde " + fmtF(d.vigente_desde) : "") : "", d.programa ? "en la plataforma" : ""].filter(Boolean).join(" · "))}</span>
      ${p ? `<span class="d ${cls}">Revisión ${cls === "mal" ? "vencida el " : ""}${fmtF(p)}</span>` : ""}</span>
    <span class="pill de-${esc(d.estado)}">${EST[d.estado]}${d.estado === "vigente" && d.archivo_key && !leido(d) ? " · nuevo" : ""}</span></button>`;
}
function renderDoc(m) {
  const d = doc, ad = esAdmin(), dis = ad ? "" : " disabled", hist = d.id ? versDe(d.id) : [];
  const lect = d.id && d.version ? lecs.filter((l) => l.documento_id === d.id && l.version === d.version) : [];
  const inp = (k, label, extra = "") => `<label class="fld" for="d_${k}"><span>${label}</span><input id="d_${k}" type="text" data-p="${k}" value="${esc(d[k] ?? "")}"${extra}${dis}></label>`;
  m.innerHTML = `
  <details class="sec" open><summary><span class="num">${esc((TIPOS[d.tipo] || ["", "DOC"])[1])}</span><h2>${d.id ? esc(d.codigo) : "Nuevo documento"}</h2><span class="sum">${EST[d.estado]}${d.version ? " · v" + esc(d.version) : ""}</span></summary><div class="body">
    ${inp("titulo", "Título")}
    <div class="grid2"><label class="fld" for="d_tipo"><span>Tipo</span><select id="d_tipo" data-p="tipo"${dis}>${Object.entries(TIPOS).map(([k, [v]]) => `<option value="${k}"${d.tipo === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="fld" for="d_area"><span>Área</span><input id="d_area" type="text" list="dlArea" data-p="area" value="${esc(d.area || "")}"${dis}></label></div>
    <datalist id="dlArea">${Object.keys(AREAS).map((a) => `<option value="${esc(a)}">`).join("")}</datalist>
    <div class="grid2">${inp("codigo", "Código", ' autocapitalize="characters"')}${inp("responsable", "Responsable (dueño del documento)")}</div>
    ${ad && !d.id ? `<button class="lnk" type="button" data-act="sugCod">Sugerir código según tipo y área</button>` : ""}
    <label class="fld" for="d_desc"><span>Alcance / descripción</span><textarea id="d_desc" data-p="descripcion" rows="2"${dis}>${esc(d.descripcion || "")}</textarea></label>
    <div class="grid2"><label class="fld" for="d_rev"><span>Revisar cada (meses)</span><input id="d_rev" type="text" inputmode="numeric" data-p="revision_meses" value="${esc(d.revision_meses ?? 12)}"${dis}></label>
      ${inp("programa", "Programa de la plataforma (opcional)", ' placeholder="/reportes"')}</div>
    ${ad && d.id ? `<label class="fld" for="d_est"><span>Estado</span><select id="d_est" data-p="estado">${Object.entries(EST).map(([k, v]) => `<option value="${k}"${d.estado === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>` : ""}
  </div></details>
  ${d.id ? `
  <section class="obracard vig">
    <div class="listhead"><h2 class="h2">Versión vigente</h2>${d.programa ? `<a class="btn sm" href="${esc(d.programa)}">Abrir en la plataforma</a>` : ""}</div>
    ${d.version ? `<div class="kv"><span>Versión</span><b>${esc(d.version)}</b><span>Vigente desde</span><b>${fmtF(d.vigente_desde)}</b><span>Próxima revisión</span><b class="${vencida(d) ? "rojo" : ""}">${fmtF(proxRev(d)) || "—"}</b></div>
      ${d.archivo_key ? `<button class="btn primary" type="button" data-file="${esc(d.archivo_key)}" data-name="${esc(d.archivo_nombre || "")}">Abrir ${esc(d.archivo_nombre || "archivo")} ${d.archivo_tamano ? "· " + peso(d.archivo_tamano) : ""}</button>` : `<span class="code">${d.programa ? "Este formato lo genera la plataforma; no necesita archivo." : "Esta versión no tiene archivo adjunto."}</span>`}
      ${d.estado === "vigente" ? (leido(d) ? `<span class="okline">✓ Confirmaste la lectura de la versión ${esc(d.version)}</span>` : `<button class="btn" type="button" data-act="leido">Confirmo que leí la versión ${esc(d.version)}</button>`) : ""}`
    : `<span class="code">Todavía no tiene una versión aprobada.${ad ? " Publica la primera abajo." : ""}</span>`}
  </section>
  ${ad ? (nv ? `<details class="sec" open><summary><span class="num">+</span><h2>Publicar versión ${esc(nv.version)}</h2><span class="sum"></span></summary><div class="body">
      <div class="grid2"><label class="fld" for="n_ver"><span>Versión</span><input id="n_ver" type="text" data-n="version" value="${esc(nv.version)}"></label><label class="fld" for="n_fecha"><span>Fecha de aprobación</span><input id="n_fecha" type="date" data-n="fecha" value="${esc(nv.fecha)}"></label></div>
      <label class="fld" for="n_cambios"><span>Qué cambió</span><textarea id="n_cambios" data-n="cambios" rows="2" placeholder="${d.version ? "Ej.: se agrega el control de EPP en la recepción de material" : "Emisión inicial"}">${esc(nv.cambios)}</textarea></label>
      <div class="grid3"><label class="fld"><span>Elaboró</span><input type="text" data-n="elaborado" value="${esc(nv.elaborado)}"></label><label class="fld"><span>Revisó</span><input type="text" data-n="revisado" value="${esc(nv.revisado)}"></label><label class="fld"><span>Aprobó</span><input type="text" data-n="aprobado" value="${esc(nv.aprobado)}"></label></div>
      <label class="fld" for="n_file"><span>Archivo (PDF, Word, Excel…; hasta 95 MB)</span><input id="n_file" type="file"></label>
      <span class="code">Al publicar, esta pasa a ser la versión vigente y la anterior queda como obsoleta en el historial. El equipo verá el aviso para confirmar su lectura.</span>
      <div class="acts"><button class="btn primary" type="button" data-act="publicar"${subiendo ? " disabled" : ""}>${subiendo ? "Subiendo…" : "Publicar versión"}</button><button class="btn ghost" type="button" data-act="nvNo">Cancelar</button></div>
    </div></details>` : `<div><button class="btn hivis" type="button" data-act="nv">${d.version ? "Publicar nueva versión" : "Publicar primera versión"}</button></div>`) : ""}
  ${hist.length ? `<details class="sec" data-sec="hist" open><summary><span class="num">${hist.length}</span><h2>Historial de versiones</h2><span class="sum"></span></summary><div class="body"><div class="hist">${hist.map((v, i) => `
    <div class="hv${i ? " obs" : ""}"><div class="h"><b>v${esc(v.version)}</b><span class="pill ${i ? "" : "de-vigente"}">${i ? "Obsoleta" : "Vigente"}</span><span class="code">${fmtF(v.fecha)}</span>${v.archivo_key ? `<button class="lnk" type="button" data-file="${esc(v.archivo_key)}" data-name="${esc(v.archivo_nombre || "")}">${esc(v.archivo_nombre || "archivo")}</button>` : ""}</div>
      ${v.cambios ? `<span>${esc(v.cambios)}</span>` : ""}
      <span class="code">${[v.elaborado && "Elaboró: " + v.elaborado, v.revisado && "Revisó: " + v.revisado, v.aprobado && "Aprobó: " + v.aprobado].filter(Boolean).map(esc).join(" · ")}</span></div>`).join("")}</div></div></details>` : ""}
  ${d.version ? `<details class="sec" data-sec="lec"><summary><span class="num">${lect.length}</span><h2>Confirmaron lectura</h2><span class="sum">v${esc(d.version)}</span></summary><div class="body">
    ${lect.length ? `<div class="mini">${lect.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).map((l) => `<div><span>${esc(l.nombre || "Usuario")}</span><span class="code">${fmtF(String(l.fecha).slice(0, 10))}</span></div>`).join("")}</div>` : `<span class="code">Nadie ha confirmado todavía la lectura de esta versión.</span>`}
  </div></details>` : ""}
  ${ad ? (confirm === "del" ? `<div class="confirm"><span>¿Borrar ${esc(d.codigo)} con todo su historial? Si ya no se usa, mejor márcalo como obsoleto.</span><button class="btn sm danger" type="button" data-act="delOk">Sí, borrar</button><button class="btn sm" type="button" data-act="noDel">Cancelar</button></div>` : `<div><button class="btn sm ghost" type="button" data-act="del">Borrar documento</button></div>`) : ""}` : ""}`;
  setDirty(dirty);
}

/* ---------- acciones ---------- */
function abrir(d) {
  doc = d ? { ...d } : { codigo: "", titulo: "", tipo: "procedimiento", area: "", responsable: "", descripcion: "", programa: "", estado: "elaboracion", revision_meses: 12 };
  nv = null; confirm = null; view = "doc"; dirty = !d; render(); window.scrollTo(0, 0);
}
async function guardar() {
  const d = doc;
  if (!(d.titulo || "").trim()) return toast("Escribe el título.");
  if (!(d.codigo || "").trim()) d.codigo = sugCodigo(d.tipo, d.area);
  const row = { codigo: d.codigo.trim().toUpperCase(), titulo: d.titulo.trim(), tipo: d.tipo, area: (d.area || "").trim() || null, responsable: (d.responsable || "").trim() || null, descripcion: (d.descripcion || "").trim() || null,
    programa: (d.programa || "").trim() || null, estado: d.estado, revision_meses: parseInt(d.revision_meses, 10) || 12, actualizado: new Date().toISOString() };
  const { data, error } = d.id ? await sb.from("documentos").update(row).eq("id", d.id).select().single() : await sb.from("documentos").insert(row).select().single();
  if (error) return toast(/duplicate|unique/i.test(error.message) ? "Ya existe un documento con el código " + row.codigo + "." : "No se pudo guardar: " + error.message);
  const i = docs.findIndex((x) => x.id === data.id); if (i > -1) docs[i] = data; else docs.push(data);
  docs.sort((a, b) => a.codigo.localeCompare(b.codigo));
  doc = { ...data }; dirty = false; render(); toast(d.id ? "Cambios guardados" : data.codigo + " creado · publica su primera versión");
}
async function publicar() {
  const d = doc, n = nv;
  if (dirty) return toast("Guarda primero los datos del documento.");
  if (!(n.version || "").trim()) return toast("Escribe el número de versión.");
  if (vers.some((v) => v.documento_id === d.id && v.version === n.version.trim())) return toast("La versión " + n.version + " ya existe.");
  const f = $("#n_file").files[0];
  if (!f && !d.programa) return toast("Adjunta el archivo de la versión " + n.version + ".");
  subiendo = true; render();
  let arch = {};
  try {
    if (f) {
      const r = await fetch("/api/documentos?doc=" + d.id + "&nombre=" + encodeURIComponent(f.name), { method: "POST", headers: { Authorization: "Bearer " + (await tok()), "Content-Type": f.type || "application/octet-stream" }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "No se pudo subir el archivo");
      arch = { archivo_key: j.key, archivo_nombre: f.name, archivo_tipo: f.type || null, archivo_tamano: f.size };
    }
    const vrow = { documento_id: d.id, version: n.version.trim(), fecha: n.fecha || hoy(), cambios: (n.cambios || "").trim() || null, elaborado: (n.elaborado || "").trim() || null, revisado: (n.revisado || "").trim() || null, aprobado: (n.aprobado || "").trim() || null, ...arch };
    const { data: v, error } = await sb.from("documento_versiones").insert(vrow).select().single();
    if (error) throw new Error(error.message);
    vers.push(v);
    const upd = { version: v.version, vigente_desde: v.fecha, estado: "vigente", archivo_key: arch.archivo_key || null, archivo_nombre: arch.archivo_nombre || null, archivo_tipo: arch.archivo_tipo || null, archivo_tamano: arch.archivo_tamano || null, actualizado: new Date().toISOString() };
    const { data, error: e2 } = await sb.from("documentos").update(upd).eq("id", d.id).select().single();
    if (e2) throw new Error(e2.message);
    const i = docs.findIndex((x) => x.id === data.id); docs[i] = data; doc = { ...data };
    nv = null; toast("Versión " + v.version + " publicada");
  } catch (e) { toast(e.message); }
  subiendo = false; render();
}
async function cargarSugeridos() {
  const ya = new Set(docs.map((d) => d.codigo));
  const rows = SUGERIDOS.filter((s) => !ya.has(s[0])).map(([codigo, titulo, tipo, area, programa, descripcion], i) => ({ codigo, titulo, tipo, area, programa: programa || null, descripcion: descripcion || null, estado: "elaboracion", revision_meses: 12, orden: i }));
  const { data, error } = await sb.from("documentos").insert(rows).select();
  if (error) return toast("No se pudo cargar: " + error.message);
  docs = docs.concat(data || []).sort((a, b) => a.codigo.localeCompare(b.codigo)); render();
  toast((data || []).length + " documentos cargados en elaboración. Asigna responsables y publica sus versiones.");
}
async function confirmarLectura() {
  const row = { documento_id: doc.id, version: doc.version, usuario_id: user.id, nombre: (perfil && perfil.nombre) || user.email };
  const { data, error } = await sb.from("documento_lecturas").insert(row).select().single();
  if (error && !/duplicate|unique/i.test(error.message)) return toast("No se pudo registrar: " + error.message);
  lecs.push(data || { ...row, fecha: new Date().toISOString() }); render(); toast("Lectura registrada");
}

/* ---------- PDF del listado maestro ---------- */
function pdf() {
  const lista = filtrados().slice().sort((a, b) => Object.keys(TIPOS).indexOf(a.tipo) - Object.keys(TIPOS).indexOf(b.tipo) || a.codigo.localeCompare(b.codigo));
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "landscape" }); { const _t = doc.text.bind(doc), _l = (s) => typeof s === "string" ? s.replace(/[−–]/g, "-").replace(/✓/g, "»").replace(/→/g, "->") : s; doc.text = (s, ...a) => _t(Array.isArray(s) ? s.map(_l) : _l(s), ...a); }
  const M = 10, W = 277, NAVY = [58, 61, 64], AMB = [169, 165, 157], GRID = [150, 150, 150], SUB = [232, 231, 227], ROJO = [160, 70, 62];
  const fit = (x, w) => { x = String(x ?? ""); while (x && doc.getTextWidth(x) > w) x = x.slice(0, -2) + "…"; return x; };
  let pagina = 1;
  const header = () => {
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.rect(M, M, W, 18); doc.line(M + 48, M, M + 48, M + 18); doc.line(M + W - 52, M, M + W - 52, M + 18);
    doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("DLV", M + 5, M + 9.5); doc.setFillColor(...AMB); doc.rect(M + 5, M + 10.8, 15, 1, "F");
    doc.setFontSize(6.4); doc.text("CONSTRUCCIONES CÍA. LTDA.", M + 5, M + 14.6);
    doc.setFontSize(12.5); doc.text("LISTADO MAESTRO DE DOCUMENTOS", M + 48 + (W - 100) / 2, M + 8.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85, 85, 85); doc.text("Manuales, políticas, procedimientos, instructivos y formatos con su versión vigente", M + 48 + (W - 100) / 2, M + 13.2, { align: "center" });
    [["CÓDIGO", "FO-CAL-01"], ["FECHA", fmtF(hoy())], ["PÁGINA", String(pagina)]].forEach(([k, v], i) => {
      const x = M + W - 52, yy = M + i * 6; if (i) doc.line(x, yy, M + W, yy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4);
      doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(v, M + W - 1.5, yy + 4, { align: "right" });
    });
    doc.setFontSize(5.6); doc.setTextColor(120, 120, 120); doc.text("DLV Construcciones Cía. Ltda. · Copia controlada solo en la plataforma; impresa es copia no controlada.", M, 203);
    return M + 21;
  };
  const cols = [["CÓDIGO", 22, "l"], ["DOCUMENTO", 78, "l"], ["TIPO", 26, "l"], ["ÁREA", 24, "l"], ["RESPONSABLE", 34, "l"], ["VERSIÓN", 14, "c"], ["VIGENTE DESDE", 20, "c"], ["PRÓX. REVISIÓN", 21, "c"], ["ESTADO", 21, "l"], ["LECTURAS", 17, "r"]];
  const head = (yy) => { let x = M; doc.setFillColor(...NAVY); doc.rect(M, yy, W, 6, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(255, 255, 255);
    for (const [h, w, al] of cols) { doc.text(h, al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, yy + 4, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; } return yy + 6; };
  let y = head(header());
  for (const d of lista) {
    if (y + 5.6 > 198) { doc.addPage("a4", "landscape"); pagina++; y = head(header()); }
    const nl = d.version ? lecs.filter((l) => l.documento_id === d.id && l.version === d.version).length : 0;
    const vals = [d.codigo, d.titulo, TIPOS[d.tipo][0], d.area || "", d.responsable || "", d.version || "—", fmtF(d.vigente_desde) || "—", fmtF(proxRev(d)) || "—", EST[d.estado], d.version ? String(nl) : ""];
    doc.setDrawColor(210, 210, 210); doc.line(M, y + 5.6, M + W, y + 5.6);
    let x = M; doc.setFont("helvetica", "normal"); doc.setFontSize(6.6);
    cols.forEach(([, w, al], i) => { doc.setTextColor(...(i === 7 && vencida(d) ? ROJO : [30, 30, 30])); doc.setFont("helvetica", i === 0 ? "bold" : "normal"); if (vals[i]) doc.text(fit(vals[i], w - 2.4), al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, y + 3.8, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; });
    y += 5.6;
  }
  doc.setFillColor(...SUB); doc.rect(M, y, W, 5.6, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.6); doc.setTextColor(30, 30, 30);
  doc.text(lista.length + " documentos · " + lista.filter((d) => d.estado === "vigente").length + " vigentes · " + lista.filter(vencida).length + " con revisión vencida", M + 1.2, y + 3.8);
  const name = "Listado maestro de documentos DLV " + hoy() + ".pdf";
  const blob = doc.output("blob"), file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch((e) => { if (e.name !== "AbortError") doc.save(name); });
  else doc.save(name);
}

/* ---------- eventos ---------- */
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "fBus") { fBus = t.value; const p = t.selectionStart; render(); const b = $("#fBus"); b.focus(); b.setSelectionRange(p, p); return; }
  if (t.dataset.p && doc && view === "doc") { doc[t.dataset.p] = t.value; setDirty(true); return; }
  if (t.dataset.n && nv) { nv[t.dataset.n] = t.value; return; }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "fTipo") { fTipo = t.value; render(); return; }
  if (t.id === "fArea") { fArea = t.value; render(); return; }
  if (t.id === "fRev") { fRev = t.checked; render(); return; }
  if (t.tagName === "SELECT" && t.dataset.p && doc) { doc[t.dataset.p] = t.value; setDirty(true); return; }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.doc) return abrir(docs.find((x) => x.id === b.dataset.doc));
  if (b.dataset.file) return abrirArchivo(b.dataset.file, b.dataset.name);
  const a = b.dataset.act;
  if (a === "nuevo") return abrir(null);
  if (a === "sugeridos") { b.disabled = true; return cargarSugeridos(); }
  if (a === "verRev") { fRev = true; render(); return; }
  if (a === "pdf") { try { pdf(); } catch (err) { console.error(err); toast("No se pudo generar el PDF."); } return; }
  if (a === "sugCod") { doc.codigo = sugCodigo(doc.tipo, doc.area); setDirty(true); render(); return; }
  if (a === "nv") {
    const ult = versDe(doc.id)[0] || {};
    nv = { version: siguienteVersion(doc), fecha: hoy(), cambios: "", elaborado: ult.elaborado || doc.responsable || "", revisado: ult.revisado || "", aprobado: ult.aprobado || (perfil && perfil.nombre) || "" }; render(); return;
  }
  if (a === "nvNo") { nv = null; render(); return; }
  if (a === "publicar") return publicar();
  if (a === "leido") return confirmarLectura();
  if (a === "del") { confirm = "del"; render(); return; }
  if (a === "noDel") { confirm = null; render(); return; }
  if (a === "delOk") { const { error } = await sb.from("documentos").delete().eq("id", doc.id); if (error) return toast("No se pudo borrar."); docs = docs.filter((x) => x.id !== doc.id); view = "lista"; doc = null; dirty = false; render(); toast("Documento borrado"); return; }
  if (b.id === "btnGuardar") return guardar();
  if (b.id === "btnVolver") {
    if (dirty && !b.dataset.sure) { b.dataset.sure = "1"; const prev = b.textContent; b.textContent = "¿Salir sin guardar?"; setTimeout(() => { if (b.dataset.sure) { b.dataset.sure = ""; b.textContent = prev; } }, 3000); return; }
    b.dataset.sure = ""; view = "lista"; doc = null; nv = null; dirty = false; render(); window.scrollTo(0, 0);
  }
});

/* ---------- arranque ---------- */
(async () => {
  try {
    const cfg = await (await fetch("/api/config")).json();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("config");
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch (_) { $("#main").innerHTML = `<div class="empty"><b>Falta configurar la plataforma.</b></div>`; return; }
  const { data: { session } } = await sb.auth.getSession();
  user = session ? session.user : null;
  if (!user) return render();
  const { data: pf } = await sb.from("perfiles").select("*").eq("id", user.id).maybeSingle();
  perfil = pf || { rol: "residente" }; $("#quien").textContent = perfil.nombre || user.email;
  await cargar();
})();
})();
