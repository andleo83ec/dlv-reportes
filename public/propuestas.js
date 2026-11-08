// DLV Plataforma — Estudio de propuestas: embudo comercial con efectividad, presupuesto de costos con
// indirectos y utilidad, cotizaciones con cuadro comparativo y adjudicación que crea la obra con su presupuesto.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hoy = () => ymd(new Date());
const masDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const fmtF = (f) => { if (!f) return "—"; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
const diasA = (f) => { if (!f) return null; const [y, m, d] = String(f).slice(0, 10).split("-").map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d) - t) / 864e5); };
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").trim().replace(/[$\s]/g, ""); if (!s) return 0;
  const c = s.lastIndexOf(","), d = s.lastIndexOf(".");
  if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (c > -1) s = s.match(/,/g).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (d > -1 && (s.match(/\./g).length > 1 || /^-?\d{1,3}(\.\d{3})+$/.test(s))) s = s.replace(/\./g, "");
  const n = parseFloat(s); return isFinite(n) ? n : 0;
}
function formatoNumeros(txt) {
  let coma = 0, punto = 0;
  for (const cel of txt.split(/[\t\r\n]+/)) { const v = cel.trim();
    if (/^-?[\d.]*,\d{1,2}$/.test(v) || /^-?\d{1,3}(\.\d{3})+,\d+$/.test(v)) coma++;
    else if (/^-?[\d,]*\.\d{1,2}$/.test(v) || /^-?\d{1,3}(,\d{3})+\.\d+$/.test(v)) punto++; }
  return coma > punto ? "coma" : punto > coma ? "punto" : "";
}
const numCon = (v, modo) => { const s = String(v ?? "").trim().replace(/[$\s]/g, ""); return modo === "coma" ? num(s.replace(/\./g, "").replace(",", ".")) : modo === "punto" ? num(s.replace(/,/g, "")) : num(s); };
const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => "$ " + (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyK = (n) => n >= 1e6 ? "$ " + (n / 1e6).toLocaleString("es-EC", { maximumFractionDigits: 2 }) + " M" : n >= 1e4 ? "$ " + (n / 1e3).toLocaleString("es-EC", { maximumFractionDigits: 1 }) + " mil" : money(n);
const qty = (n) => (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n, d = 1) => (n || 0).toLocaleString("es-EC", { minimumFractionDigits: d, maximumFractionDigits: d }) + " %";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

const EST = { estudio: "En estudio", presentada: "Presentada", adjudicada: "Adjudicada", perdida: "Perdida", desistida: "Desistida" };
const TIPO_COT = { material: "Material", subcontrato: "Subcontrato", equipo: "Equipo" };
let sb = null, user = null, perfil = null, props = [], cots = [], sinTablas = false, noAdmin = false;
let view = "lista", filtro = "activas", item = null, dirty = false, confirm = null, pegar = false, busca = "";
const anio = new Date().getFullYear();

/* ---------- cálculo ---------- */
function calc(p) {
  const directo = (p.rubros || []).reduce((t, r) => t + num(r.cantidad) * num(r.costo), 0);
  const factor = (1 + num(p.indirectos_pct) / 100) * (1 + num(p.utilidad_pct) / 100);
  // la oferta suma precios unitarios redondeados a centavos, igual que el PDF y las planillas de la obra
  const oferta = (p.rubros || []).reduce((t, r) => t + r2(num(r.costo) * factor) * num(r.cantidad), 0);
  const ind = directo * num(p.indirectos_pct) / 100, util = oferta - directo - ind;
  return { directo: r2(directo), ind: r2(ind), util: r2(util), oferta: r2(oferta), iva: r2(oferta * num(p.iva_pct) / 100), total: r2(oferta * (1 + num(p.iva_pct) / 100)), factor };
}
const pu = (r, f) => r2(num(r.costo) * f);
function semEntrega(p) {
  if (p.estado !== "estudio") return null;
  const d = diasA(p.entrega); if (d == null) return { cls: "", txt: "Sin fecha de entrega" };
  if (d < 0) return { cls: "mal", txt: "Venció la entrega " + fmtF(p.entrega) };
  if (d <= 3) return { cls: "aviso", txt: d === 0 ? "Se entrega hoy" : "Entrega en " + d + (d === 1 ? " día" : " días") };
  return { cls: "", txt: "Entrega " + fmtF(p.entrega) };
}

/* ---------- datos ---------- */
async function cargar() {
  const [a, b] = await Promise.all([sb.from("propuestas").select("*").order("numero", { ascending: false }), sb.from("cotizaciones").select("*").order("grupo")]);
  if (a.error || b.error) { sinTablas = true; return; }
  props = a.data || []; cots = b.data || [];
}

/* ---------- render ---------- */
const conDock = () => ["prop", "cot"].includes(view);
function setDirty(v) { dirty = v; const e = $("#estado"); if (!conDock()) return; e.className = "state" + (v ? " dirty" : ""); e.textContent = v ? "Sin guardar" : "Guardado"; }
const get = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
function inp(path, label, type = "text", extra = "") { const v = get(item, path) ?? ""; const id = "f_" + path.replace(/\./g, "_"); return `<label class="fld" for="${id}"><span>${label}</span><input id="${id}" type="${type}" data-p="${path}" value="${esc(v)}"${extra}></label>`; }
function sel(path, label, opts) { const v = get(item, path); const id = "f_" + path.replace(/\./g, "_"); return `<label class="fld" for="${id}"><span>${label}</span><select id="${id}" data-p="${path}">${opts.map(([k, l]) => `<option value="${esc(k)}"${v === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`; }
function area(path, label, ph = "", rows = 3) { const v = get(item, path) ?? ""; const id = "f_" + path.replace(/\./g, "_"); return `<label class="fld" for="${id}"><span>${label}</span><textarea id="${id}" data-p="${path}" rows="${rows}" placeholder="${esc(ph)}">${esc(v)}</textarea></label>`; }
function render() {
  const m = $("#main");
  $("#top").hidden = !user; $("#dock").hidden = !conDock();
  if (conDock()) { $("#btnPDF").hidden = view !== "prop"; $("#btnVolver").textContent = view === "cot" ? "← Propuesta" : "← Propuestas"; }
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (noAdmin) { m.innerHTML = `<div class="empty"><b>Solo para administradores.</b><span>El estudio de propuestas tiene información comercial reservada.</span></div>`; return; }
  if (sinTablas) { m.innerHTML = `<div class="empty"><b>Falta activar el estudio de propuestas.</b><span>Ejecuta <b>supabase/propuestas.sql</b> en Supabase → SQL Editor y recarga.</span></div>`; return; }
  if (view === "prop") return renderProp(m);
  if (view === "cot") return renderCot(m);
  renderLista(m);
}
function renderLista(m) {
  const delAnio = props.filter((p) => String(p.presentada || p.recepcion || p.creado || "").slice(0, 4) === String(anio));
  const adj = delAnio.filter((p) => p.estado === "adjudicada"), per = delAnio.filter((p) => p.estado === "perdida");
  const efCnt = adj.length + per.length ? adj.length / (adj.length + per.length) * 100 : null;
  const mAdj = adj.reduce((t, p) => t + num(p.monto_oferta), 0), mPer = per.reduce((t, p) => t + num(p.monto_oferta), 0);
  const efMonto = mAdj + mPer ? mAdj / (mAdj + mPer) * 100 : null;
  const estudio = props.filter((p) => p.estado === "estudio"), pres = props.filter((p) => p.estado === "presentada");
  const filtros = { activas: (p) => p.estado === "estudio" || p.estado === "presentada", estudio: (p) => p.estado === "estudio", presentada: (p) => p.estado === "presentada", adjudicada: (p) => p.estado === "adjudicada", perdida: (p) => p.estado === "perdida" || p.estado === "desistida", todas: () => true };
  const q = busca.trim().toLowerCase();
  const lista = props.filter(filtros[filtro]).filter((p) => !q || [p.codigo, p.nombre, p.cliente].join(" ").toLowerCase().includes(q));
  m.innerHTML = `
  <section class="obracard"><div class="listhead"><h1>Propuestas</h1><button class="btn hivis" type="button" data-act="nueva">+ Propuesta</button></div>
    <div class="kpis">
      <div><small>En estudio</small><b>${estudio.length} · ${moneyK(estudio.reduce((t, p) => t + num(p.monto_oferta), 0))}</b></div>
      <div><small>Esperando respuesta</small><b>${pres.length} · ${moneyK(pres.reduce((t, p) => t + num(p.monto_oferta), 0))}</b></div>
      <div><small>Adjudicado ${anio}</small><b>${moneyK(mAdj)}</b></div>
      <div><small>Efectividad ${anio}</small><b>${efCnt == null ? "—" : pct(efCnt, 0) + " · " + pct(efMonto, 0) + " en $"}</b></div>
    </div>
    <span class="code">Efectividad comercial: propuestas adjudicadas sobre las ya resueltas (adjudicadas + perdidas) del año, en número y en monto.</span>
  </section>
  <div class="chips" role="group" aria-label="Filtrar">${[["activas", "Activas"], ["estudio", "En estudio"], ["presentada", "Presentadas"], ["adjudicada", "Adjudicadas"], ["perdida", "Perdidas"], ["todas", "Todas"]].map(([k, l]) => `<button type="button" data-filtro="${k}" aria-pressed="${filtro === k}">${l}</button>`).join("")}</div>
  <label class="fld" for="busca"><span class="vh">Buscar</span><input id="busca" type="text" placeholder="Buscar por proyecto, cliente o código…" value="${esc(busca)}" autocomplete="off"></label>
  <div class="list">${lista.map((p) => { const s = semEntrega(p), k = calc(p); return `<button class="rep doc" type="button" data-prop="${esc(p.id)}"><span class="n sm">${esc(p.codigo || "P-" + String(p.numero).padStart(3, "0"))}</span>
    <span class="mid"><span class="t">${esc(p.nombre)}</span><span class="d">${esc(p.cliente || "Sin cliente")} · ${money(k.oferta)} sin IVA${(p.rubros || []).length ? " · " + p.rubros.length + " rubros" : ""}${p.estado === "perdida" && p.ganador ? " · ganó " + esc(p.ganador) : ""}</span></span>
    <span class="pill ${s ? "gp-" + s.cls : "pe-" + esc(p.estado)}">${s ? esc(s.txt) : EST[p.estado]}</span></button>`; }).join("") || `<div class="empty"><span>No hay propuestas en este filtro.</span></div>`}</div>`;
}
function renderProp(m) {
  const p = item, k = calc(p), cs = p.id ? cots.filter((c) => c.propuesta_id === p.id) : [];
  const grupos = [...new Set(cs.map((c) => c.grupo))];
  let cap = null;
  const filas = p.rubros.map((r, i) => {
    let h = ""; if ((r.capitulo || "") !== cap) { cap = r.capitulo || ""; if (cap) h += `<div class="capt">${esc(cap)}</div>`; }
    return h + `<div class="r r-pr"><label class="fld"><span>Cód.</span><input type="text" data-p="rubros.${i}.codigo" value="${esc(r.codigo || "")}"></label>
      <label class="fld"><span>Descripción</span><input type="text" data-p="rubros.${i}.descripcion" value="${esc(r.descripcion || "")}"></label>
      <button class="x" type="button" data-delr="${i}" aria-label="Quitar rubro">×</button>
      <div class="ext"><label class="fld"><span>Und</span><input type="text" data-p="rubros.${i}.unidad" value="${esc(r.unidad || "")}"></label>
        <label class="fld"><span>Cantidad</span><input type="text" inputmode="decimal" data-p="rubros.${i}.cantidad" value="${esc(r.cantidad ?? "")}"></label>
        <label class="fld"><span>Costo unit.</span><input type="text" inputmode="decimal" data-p="rubros.${i}.costo" value="${esc(r.costo ?? "")}"></label>
        <div class="fld"><span>P. oferta</span><div class="acum" id="pu_${i}">${money(pu(r, k.factor))}</div></div>
        <div class="fld"><span>Total oferta</span><div class="acum" id="tt_${i}">${money(pu(r, k.factor) * num(r.cantidad))}</div></div></div></div>`;
  }).join("");
  const s = semEntrega(p);
  m.innerHTML = `
  <details class="sec" data-sec="a" open><summary><span class="num">P</span><h2>${esc(p.codigo || "Nueva propuesta")}</h2><span class="sum">${s ? esc(s.txt) : EST[p.estado]}</span></summary><div class="body">
    ${inp("nombre", "Proyecto", "text", ' placeholder="Ej.: Edificio Rivoria"')}
    <div class="grid2">${inp("codigo", "Código", "text", ' placeholder="PROFORMA 015-2026"')}${sel("tipo", "Tipo", [["privada", "Privada"], ["publica", "Pública (SERCOP)"]])}</div>
    <div class="grid2">${inp("cliente", "Cliente")}${inp("contacto", "Contacto")}</div>
    ${inp("ubicacion", "Ubicación")}
    <div class="grid3">${inp("recepcion", "Recibida", "date")}${inp("entrega", "Entregar hasta", "date")}${inp("plazo_dias", "Plazo de obra (días)", "number", ' inputmode="numeric"')}</div>
    <div class="grid2">${inp("responsable", "Responsable del estudio")}${sel("estado", "Estado", Object.entries(EST))}</div>
  </div></details>
  <section class="sumcard" id="sumcard">${resumen(k, p)}</section>
  <details class="sec" data-sec="b" open><summary><span class="num">${p.rubros.length}</span><h2>Presupuesto de costos</h2><span class="sum">${money(k.directo)} directo</span></summary><div class="body">
    <div class="grid3">${inp("indirectos_pct", "Indirectos (%)", "text", ' inputmode="decimal"')}${inp("utilidad_pct", "Utilidad (%)", "text", ' inputmode="decimal"')}${inp("iva_pct", "IVA (%)", "text", ' inputmode="decimal"')}</div>
    <span class="code">Precio de oferta = costo unitario × (1 + indirectos) × (1 + utilidad). Factor actual: ${k.factor.toLocaleString("es-EC", { maximumFractionDigits: 4 })}.</span>
    <label class="fld" for="busR"><span class="vh">Buscar rubro</span><input id="busR" type="text" placeholder="Buscar rubro…" autocomplete="off"></label>
    <div class="rows" id="rubrosBox">${filas || `<span class="code">Pega los rubros desde tu sábana de costos o agrégalos uno a uno.</span>`}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm add" type="button" data-act="addR">+ Rubro</button><button class="btn sm" type="button" data-act="verPegar">Pegar desde Excel</button></div>
    ${pegar ? `<div class="pastebox"><span class="code">Columnas: Código · Descripción · Unidad · Cantidad · Costo unitario (sin indirectos ni utilidad). Las filas sin cantidad ni costo quedan como capítulos.</span><textarea id="pegarTxt" rows="6"></textarea><div><button class="btn sm primary" type="button" data-act="pegarOk">Agregar rubros</button> <button class="btn sm ghost" type="button" data-act="pegarNo">Cancelar</button></div></div>` : ""}
  </div></details>
  ${p.id ? `<details class="sec" data-sec="c"${cs.length ? " open" : ""}><summary><span class="num">${cs.length}</span><h2>Cotizaciones y comparativo</h2><span class="sum">${grupos.length} grupos</span></summary><div class="body">
    ${grupos.map((g) => { const lista = cs.filter((c) => c.grupo === g).sort((a, b) => num(a.total) - num(b.total)), min = num(lista[0].total); return `<div class="cmp"><div class="cmph"><b>${esc(g)}</b><span class="code">${lista.length} cotizaciones</span></div>
      ${lista.map((c) => `<button class="cmpr${c.seleccionada ? " selc" : ""}" type="button" data-cot="${esc(c.id)}"><span class="pv">${c.seleccionada ? "✓ " : ""}${esc(c.proveedor)}<small>${esc(TIPO_COT[c.tipo])}${c.plazo ? " · " + esc(c.plazo) : ""}${c.pago ? " · " + esc(c.pago) : ""}${c.validez ? " · válida hasta " + fmtF(c.validez) : ""}</small></span>
        <span class="mt">${money(num(c.total))}<small>${num(c.total) === min ? "la más baja" : "+" + pct((num(c.total) - min) / (min || 1) * 100, 1)}</small></span></button>`).join("")}</div>`; }).join("") || `<span class="code">Registra las cotizaciones de proveedores y subcontratistas. Las del mismo grupo se comparan entre sí.</span>`}
    <div><button class="btn sm" type="button" data-act="nuevaCot">+ Cotización</button></div>
  </div></details>
  <details class="sec" data-sec="d"${["adjudicada", "perdida", "desistida"].includes(p.estado) ? " open" : ""}><summary><span class="num">R</span><h2>Resultado</h2><span class="sum">${EST[p.estado]}</span></summary><div class="body">
    ${inp("presentada", "Fecha de presentación", "date")}
    ${p.estado === "perdida" ? `<div class="grid2">${inp("ganador", "Quién ganó")}${inp("monto_ganador", "Monto ganador ($)", "text", ' inputmode="decimal"')}</div>${area("motivo", "Por qué se perdió", "Precio, plazo, experiencia, relación con el cliente…", 2)}` : ""}
    ${p.estado === "perdida" && num(p.monto_ganador) ? `<span class="code">Diferencia con el ganador: ${pct((k.oferta - num(p.monto_ganador)) / (num(p.monto_ganador) || 1) * 100, 1)} (${money(k.oferta - num(p.monto_ganador))}).</span>` : ""}
    ${p.obra_id ? `<div class="note-ok">Obra creada en la plataforma con su presupuesto. <a class="btn sm" href="/planillas?obra=${encodeURIComponent(p.obra_id)}">Ver estado de pago</a></div>`
      : p.estado === "adjudicada" ? (confirm === "adj" ? `<div class="confirm"><span>Se creará la obra «${esc(p.nombre)}» con ${p.rubros.length} rubros a precio de oferta en Estado de pago.</span><button class="btn sm primary" type="button" data-act="adjOk">Crear obra</button><button class="btn sm" type="button" data-act="noConf">Cancelar</button></div>`
      : `<div><button class="btn hivis" type="button" data-act="adj">Crear la obra con este presupuesto</button></div><span class="code">Crea la obra, deja su presupuesto listo para planillar y la enlaza con esta propuesta. Después asigna residentes desde Reportes.</span>`) : ""}
    ${area("notas", "Notas", "", 2)}
  </div></details>` : `<span class="code">Guarda la propuesta para registrar cotizaciones y su resultado.</span>`}
  ${p.id ? (confirm === "del" ? `<div class="confirm"><span>¿Borrar esta propuesta y sus cotizaciones?</span><button class="btn sm danger" type="button" data-act="delOk">Sí, borrar</button><button class="btn sm" type="button" data-act="noConf">Cancelar</button></div>` : `<div><button class="btn sm danger" type="button" data-act="del">Borrar propuesta</button></div>`) : ""}`;
  setDirty(dirty); aplicarSecciones();
}
function resumen(k, p) {
  const row = (a, b, cls = "") => `<div class="${cls}"><span>${a}</span><b>${b}</b></div>`;
  return `<div class="sumgrid">${row("Costo directo", money(k.directo))}${row("Indirectos " + num(p.indirectos_pct).toLocaleString("es-EC") + " %", money(k.ind))}${row("Utilidad " + num(p.utilidad_pct).toLocaleString("es-EC") + " %", money(k.util))}
    ${row("Oferta sin IVA", money(k.oferta), "big")}${row("IVA " + num(p.iva_pct).toLocaleString("es-EC") + " %", money(k.iva))}${row("Oferta con IVA", money(k.total), "big tot")}</div>`;
}
function renderCot(m) {
  const c = item, p = props.find((x) => x.id === c.propuesta_id) || {};
  const grupos = [...new Set(cots.filter((x) => x.propuesta_id === c.propuesta_id).map((x) => x.grupo))];
  m.innerHTML = `<details class="sec" open><summary><span class="num">C</span><h2>Cotización</h2><span class="sum">${esc(p.nombre || "")}</span></summary><div class="body">
    <label class="fld" for="f_grupo"><span>Qué se cotiza (grupo para comparar)</span><input id="f_grupo" type="text" data-p="grupo" list="grpList" value="${esc(c.grupo || "")}" placeholder="Ej.: Hormigón premezclado"><datalist id="grpList">${grupos.map((g) => `<option value="${esc(g)}">`).join("")}</datalist></label>
    <div class="grid2">${inp("proveedor", "Proveedor o subcontratista")}${sel("tipo", "Tipo", Object.entries(TIPO_COT))}</div>
    <div class="grid2">${inp("total", "Total sin IVA ($)", "text", ' inputmode="decimal"')}${inp("validez", "Válida hasta", "date")}</div>
    <div class="grid2">${inp("plazo", "Plazo de entrega", "text", ' placeholder="Ej.: 5 días"')}${inp("pago", "Forma de pago", "text", ' placeholder="Ej.: 50 % anticipo"')}</div>
    ${inp("contacto", "Contacto")}
    ${area("notas", "Observaciones", "Qué incluye, qué no incluye, transporte, descuentos…", 3)}
    <label class="chk" for="f_sel"><input type="checkbox" id="f_sel" data-c="seleccionada"${c.seleccionada ? " checked" : ""}>Es la seleccionada en su grupo</label>
    ${c.id ? (confirm === "delc" ? `<div class="confirm"><span>¿Borrar esta cotización?</span><button class="btn sm danger" type="button" data-act="delcOk">Sí, borrar</button><button class="btn sm" type="button" data-act="noConf">Cancelar</button></div>` : `<div><button class="btn sm danger" type="button" data-act="delc">Borrar cotización</button></div>`) : ""}
  </div></details>`;
  setDirty(dirty);
}
const secAb = {};
document.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.sec) secAb[d.dataset.sec] = d.open; }, true);
function aplicarSecciones() { document.querySelectorAll("details[data-sec]").forEach((d) => { if (d.dataset.sec in secAb) d.open = secAb[d.dataset.sec]; }); }

/* ---------- acciones ---------- */
function abrirProp(p) {
  for (const k in secAb) delete secAb[k];
  item = p ? JSON.parse(JSON.stringify(p)) : { numero: props.reduce((m, x) => Math.max(m, x.numero || 0), 0) + 1, codigo: "PROFORMA " + String(props.reduce((m, x) => Math.max(m, x.numero || 0), 0) + 1).padStart(3, "0") + "-" + anio, nombre: "", cliente: "", tipo: "privada", recepcion: hoy(), entrega: masDias(7), estado: "estudio", rubros: [], indirectos_pct: 18, utilidad_pct: 10, iva_pct: 15 };
  item.rubros = item.rubros || [];
  view = "prop"; confirm = null; pegar = false; dirty = !p; render(); window.scrollTo(0, 0);
}
async function guardarProp() {
  const p = item;
  if (!(p.nombre || "").trim()) return toast("Escribe el nombre del proyecto.");
  const rubros = p.rubros.filter((r) => (r.descripcion || "").trim()).map((r) => ({ id: r.id || uid(), codigo: r.codigo || "", descripcion: r.descripcion.trim(), unidad: r.unidad || "", cantidad: num(r.cantidad), costo: num(r.costo), capitulo: r.capitulo || "" }));
  const k = calc({ ...p, rubros });
  const row = { numero: parseInt(p.numero, 10) || 1, codigo: p.codigo || null, nombre: p.nombre.trim(), cliente: p.cliente || null, contacto: p.contacto || null, ubicacion: p.ubicacion || null, tipo: p.tipo,
    recepcion: p.recepcion || null, entrega: p.entrega || null, presentada: p.presentada || (p.estado !== "estudio" && !p.presentada ? hoy() : null), estado: p.estado, responsable: p.responsable || null,
    plazo_dias: parseInt(p.plazo_dias, 10) || null, rubros, indirectos_pct: num(p.indirectos_pct), utilidad_pct: num(p.utilidad_pct), iva_pct: num(p.iva_pct), monto_oferta: k.oferta, monto_costo: k.directo,
    ganador: p.ganador || null, monto_ganador: num(p.monto_ganador) || null, motivo: p.motivo || null, notas: p.notas || null, obra_id: p.obra_id || null, actualizado: new Date().toISOString() };
  const btn = $("#btnGuardar"); btn.disabled = true;
  try {
    const { data, error } = p.id ? await sb.from("propuestas").update(row).eq("id", p.id).select().single() : await sb.from("propuestas").insert(row).select().single();
    if (error) throw error;
    const i = props.findIndex((x) => x.id === data.id); if (i >= 0) props[i] = data; else props.unshift(data);
    props.sort((a, b) => b.numero - a.numero);
    item = JSON.parse(JSON.stringify(data)); item.rubros = item.rubros || [];
    setDirty(false); render(); toast("Propuesta guardada");
  } catch (err) { toast(String(err.code) === "23505" ? "Ya existe una propuesta con ese número." : "No se pudo guardar: " + (err.message || "revisa tu conexión")); }
  finally { btn.disabled = false; }
}
async function adjudicar() {
  const p = item;
  if (dirty) return toast("Guarda primero la propuesta.");
  const k = calc(p);
  const { data: ob, error } = await sb.from("obras").insert({ nombre: p.nombre, cliente: p.cliente || null, contrato: p.codigo || null, ubicacion: p.ubicacion || null, plazo: parseInt(p.plazo_dias, 10) || null, activa: true }).select().single();
  if (error) return toast("No se pudo crear la obra: " + error.message);
  let aviso = "";
  if (p.rubros.length) {
    const rows = p.rubros.map((r, i) => ({ obra_id: ob.id, codigo: r.codigo || "", descripcion: r.descripcion, unidad: r.unidad || "", cantidad: num(r.cantidad), precio: pu(r, k.factor), costo: num(r.costo) || null, capitulo: r.capitulo || "", adicional: false, orden: (i + 1) * 10 }));
    for (let i = 0; i < rows.length; i += 500) { let { error: e2 } = await sb.from("rubros").insert(rows.slice(i, i + 500)); if (e2 && /costo/.test(e2.message || "")) ({ error: e2 } = await sb.from("rubros").insert(rows.slice(i, i + 500).map(({ costo, ...x }) => x))); if (e2) { aviso = " (el presupuesto no se cargó: activa Estado de pago con planillas.sql)"; break; } }
  }
  const { data, error: e3 } = await sb.from("propuestas").update({ obra_id: ob.id, estado: "adjudicada", actualizado: new Date().toISOString() }).eq("id", p.id).select().single();
  if (!e3) { const i = props.findIndex((x) => x.id === data.id); props[i] = data; item = JSON.parse(JSON.stringify(data)); }
  confirm = null; setDirty(false); render(); toast("Obra creada" + aviso);
}
function abrirCot(c) {
  item = c ? JSON.parse(JSON.stringify(c)) : { propuesta_id: item.id, grupo: "", tipo: "material", proveedor: "", total: "", validez: masDias(15), plazo: "", pago: "", contacto: "", notas: "", seleccionada: false };
  view = "cot"; confirm = null; dirty = !c; render(); window.scrollTo(0, 0);
}
async function guardarCot() {
  const c = item;
  if (!(c.grupo || "").trim() || !(c.proveedor || "").trim()) return toast("Escribe qué se cotiza y el proveedor.");
  const row = { propuesta_id: c.propuesta_id, grupo: c.grupo.trim(), tipo: c.tipo, proveedor: c.proveedor.trim(), contacto: c.contacto || null, total: num(c.total), validez: c.validez || null, plazo: c.plazo || null, pago: c.pago || null, notas: c.notas || null, seleccionada: !!c.seleccionada };
  const { data, error } = c.id ? await sb.from("cotizaciones").update(row).eq("id", c.id).select().single() : await sb.from("cotizaciones").insert(row).select().single();
  if (error) return toast("No se pudo guardar: " + error.message);
  if (row.seleccionada) for (const o of cots.filter((x) => x.propuesta_id === row.propuesta_id && x.grupo === row.grupo && x.id !== data.id && x.seleccionada)) { await sb.from("cotizaciones").update({ seleccionada: false }).eq("id", o.id); o.seleccionada = false; }
  const i = cots.findIndex((x) => x.id === data.id); if (i >= 0) cots[i] = data; else cots.push(data);
  toast("Cotización guardada"); volverAProp();
}
function volverAProp() { const p = props.find((x) => x.id === item.propuesta_id); item = JSON.parse(JSON.stringify(p)); item.rubros = item.rubros || []; view = "prop"; dirty = false; confirm = null; secAb.c = true; render(); }

/* ---------- PDF ---------- */
function pdf() {
  if (!window.jspdf) return toast("No se cargó el generador de PDF. Revisa tu conexión y recarga.");
  if (dirty) return toast("Guarda antes de generar el PDF.");
  const p = item, k = calc(p), cs = cots.filter((c) => c.propuesta_id === p.id);
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" }); { const _t = doc.text.bind(doc), _l = (s) => typeof s === "string" ? s.replace(/[\u2212\u2013]/g, "-").replace(/\u2713/g, "»").replace(/\u2610/g, "[  ]").replace(/[\u2605\u2606]/g, "*").replace(/\u2197/g, ">").replace(/\u2199/g, "<").replace(/\u2192/g, "->") : s; doc.text = (s, ...a) => _t(Array.isArray(s) ? s.map(_l) : _l(s), ...a); }
  const M = 12, W = 186, NAVY = [58, 61, 64], AMB = [169, 165, 157], GRID = [150, 150, 150], LBL = [243, 242, 239], SUB = [232, 231, 227];
  let y = 0, page = 1;
  const fit = (s, w) => { s = String(s ?? ""); while (s && doc.getTextWidth(s) > w) s = s.slice(0, -2) + "…"; return s; };
  const header = (t) => {
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.rect(M, M, W, 18); doc.line(M + 44, M, M + 44, M + 18); doc.line(M + W - 44, M, M + W - 44, M + 18);
    doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("DLV", M + 5, M + 9.5); doc.setFillColor(...AMB); doc.rect(M + 5, M + 10.8, 15, 1, "F");
    doc.setFontSize(6.2); doc.text("CONSTRUCCIONES CÍA. LTDA.", M + 5, M + 14.6);
    doc.setFontSize(12); doc.text(t, M + 44 + (W - 88) / 2, M + 8.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85, 85, 85); doc.text(fit(p.nombre, W - 92), M + 44 + (W - 88) / 2, M + 13.5, { align: "center" });
    [["CÓDIGO", p.codigo || ""], ["FECHA", fmtF(p.presentada || hoy())], ["PÁGINA", String(page)]].forEach(([a, b], i) => { const x = M + W - 44, yy = M + i * 6; if (i) doc.line(x, yy, M + W, yy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(a, x + 1.5, yy + 4); doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(fit(b, 26), M + W - 1.5, yy + 4, { align: "right" }); });
    doc.setFontSize(5.6); doc.setTextColor(120, 120, 120); doc.text("DLV Construcciones Cía. Ltda. · Av. Primero de Mayo y Av. de las Américas, Cuenca · 099 950 1112", M, 290);
    y = M + 22;
  };
  let titulo = "PRESUPUESTO REFERENCIAL";
  const need = (h) => { if (y + h > 282) { doc.addPage(); page++; header(titulo); } };
  const cols = [["CÓD.", 16, "l"], ["DESCRIPCIÓN", 82, "l"], ["UND", 12, "c"], ["CANT.", 22, "r"], ["P. UNIT.", 24, "r"], ["TOTAL", 30, "r"]];
  const head = () => { need(12); let x = M; doc.setFillColor(...NAVY); doc.rect(M, y, W, 6, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); doc.setTextColor(255, 255, 255);
    for (const [h, w, al] of cols) { doc.text(h, al === "r" ? x + w - 1.5 : al === "c" ? x + w / 2 : x + 1.5, y + 4, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; } y += 6; };
  const linea = (vals, opt = {}) => { const ls = doc.splitTextToSize(String(vals[1] ?? ""), cols[1][1] - 3); const h = Math.max(5, ls.length * 3.4 + 1.6); if (y + h > 282) { doc.addPage(); page++; header(titulo); head(); }
    if (opt.fill) { doc.setFillColor(...opt.fill); doc.rect(M, y, W, h, "F"); } doc.setDrawColor(215, 215, 215); doc.line(M, y + h, M + W, y + h);
    let x = M; doc.setFont("helvetica", opt.bold ? "bold" : "normal"); doc.setFontSize(7); doc.setTextColor(30, 30, 30);
    cols.forEach(([, w, al], i) => { const v = i === 1 ? ls : vals[i]; if (v != null && v !== "") doc.text(v, al === "r" ? x + w - 1.5 : al === "c" ? x + w / 2 : x + 1.5, y + 3.6, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; }); y += h; };
  header(titulo);
  doc.setFontSize(7.2);
  [["CLIENTE", p.cliente], ["PROYECTO", p.nombre], ["UBICACIÓN", p.ubicacion], ["PLAZO", p.plazo_dias ? p.plazo_dias + " días calendario" : "—"]].forEach(([a, b], i) => { const x = M + (i % 2) * (W / 2), yy = y + Math.floor(i / 2) * 6;
    doc.setFillColor(...LBL); doc.rect(x, yy, 26, 6, "F"); doc.setDrawColor(...GRID); doc.rect(x, yy, W / 2, 6); doc.setFont("helvetica", "bold"); doc.setTextColor(...NAVY); doc.text(a, x + 1.5, yy + 4);
    doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(fit(b || "—", W / 2 - 30), x + 28, yy + 4); });
  y += 15; head();
  let cap = null;
  for (const r of p.rubros) {
    if ((r.capitulo || "") !== cap) { cap = r.capitulo || ""; if (cap) linea(["", cap.toUpperCase()], { bold: true, fill: LBL }); }
    const u = pu(r, k.factor); linea([r.codigo, r.descripcion, r.unidad, qty(num(r.cantidad)), money(u), money(u * num(r.cantidad))]);
  }
  const totRub = p.rubros.reduce((t, r) => t + pu(r, k.factor) * num(r.cantidad), 0);
  need(24); y += 2;
  [["SUBTOTAL", totRub], ["IVA " + num(p.iva_pct).toLocaleString("es-EC") + " %", totRub * num(p.iva_pct) / 100], ["TOTAL", totRub * (1 + num(p.iva_pct) / 100)]].forEach(([a, b], i) => {
    const x = M + W - 80; if (i === 2) { doc.setFillColor(...SUB); doc.rect(x, y, 80, 6, "F"); } doc.setDrawColor(...GRID); doc.rect(x, y, 80, 6);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.6); doc.setTextColor(30, 30, 30); doc.text(a, x + 2, y + 4.2); doc.text(money(b), x + 78, y + 4.2, { align: "right" }); y += 6; });
  y += 4; doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(70, 70, 70);
  for (const t of ["Los precios unitarios incluyen costos indirectos y utilidad.", "Validez de la oferta: 30 días desde su fecha de presentación.", "Forma de pago según contrato; planillas mensuales por avance de obra."]) { need(4); doc.text("• " + t, M, y); y += 4; }
  need(28); y += 6; doc.setFillColor(...NAVY); doc.rect(M, y, 80, 4, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); doc.setTextColor(255, 255, 255); doc.text("DLV CONSTRUCCIONES CÍA. LTDA.", M + 40, y + 2.8, { align: "center" });
  doc.setDrawColor(...GRID); doc.rect(M, y + 4, 80, 18); doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(60, 60, 60); doc.text("Ing. Andrés León V. · Gerente de Proyectos", M + 2, y + 20);
  // cuadro comparativo (anexo, uso interno)
  if (cs.length) {
    titulo = "CUADRO COMPARATIVO DE COTIZACIONES"; doc.addPage(); page++; header(titulo);
    for (const g of [...new Set(cs.map((c) => c.grupo))]) {
      const lista = cs.filter((c) => c.grupo === g).sort((a, b) => num(a.total) - num(b.total)), min = num(lista[0].total);
      need(14); doc.setFillColor(...NAVY); doc.rect(M, y, W, 5.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(7.4); doc.setTextColor(255, 255, 255); doc.text(fit(g.toUpperCase(), W - 4), M + 2, y + 3.9); y += 5.5;
      for (const c of lista) {
        need(6); if (c.seleccionada) { doc.setFillColor(...SUB); doc.rect(M, y, W, 6, "F"); } doc.setDrawColor(215, 215, 215); doc.line(M, y + 6, M + W, y + 6);
        doc.setFont("helvetica", c.seleccionada ? "bold" : "normal"); doc.setFontSize(7); doc.setTextColor(30, 30, 30);
        doc.text(fit((c.seleccionada ? "✓ " : "") + c.proveedor, 60), M + 1.5, y + 4); doc.text(fit([c.plazo, c.pago].filter(Boolean).join(" · "), 62), M + 64, y + 4);
        doc.text(money(num(c.total)), M + W - 26, y + 4, { align: "right" }); doc.text(num(c.total) === min ? "menor" : "+" + pct((num(c.total) - min) / (min || 1) * 100, 1), M + W - 1.5, y + 4, { align: "right" }); y += 6;
      }
      y += 4;
    }
  }
  const name = `${(p.codigo || "Propuesta").replace(/[\\/:*?"<>|]/g, "")} ${(p.nombre || "").replace(/[\\/:*?"<>|]/g, "")}.pdf`;
  const blob = doc.output("blob"), file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch((e) => { if (e.name !== "AbortError") doc.save(name); });
  else doc.save(name);
}

/* ---------- eventos ---------- */
const setP = (o, p, v) => { const ks = p.split("."); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]]; a[ks[ks.length - 1]] = v; };
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "busca") { busca = t.value; const pos = t.selectionStart; render(); const b = $("#busca"); b.focus(); b.setSelectionRange(pos, pos); return; }
  if (t.id === "busR") { const q = t.value.trim().toLowerCase(); document.querySelectorAll("#rubrosBox .r-pr").forEach((r) => { r.hidden = !!q && !r.textContent.toLowerCase().includes(q) && ![...r.querySelectorAll("input")].some((i) => i.value.toLowerCase().includes(q)); }); return; }
  if (t.dataset.p && item && t.tagName !== "SELECT") {
    setP(item, t.dataset.p, t.value); setDirty(true);
    if (view === "prop" && (/^rubros\.\d+\.(cantidad|costo)$/.test(t.dataset.p) || /_pct$/.test(t.dataset.p))) {
      const k = calc(item); $("#sumcard").innerHTML = resumen(k, item);
      item.rubros.forEach((r, i) => { const a = $("#pu_" + i), b = $("#tt_" + i); if (a) a.textContent = money(pu(r, k.factor)); if (b) b.textContent = money(pu(r, k.factor) * num(r.cantidad)); });
    }
  }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.c && item) { item[t.dataset.c] = t.checked; setDirty(true); return; }
  if (t.tagName === "SELECT" && t.dataset.p && item) { setP(item, t.dataset.p, t.value); if (t.dataset.p === "estado" && t.value !== "estudio" && !item.presentada) item.presentada = hoy(); setDirty(true); render(); }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.filtro) { filtro = b.dataset.filtro; render(); return; }
  if (b.dataset.prop) return abrirProp(props.find((x) => x.id === b.dataset.prop));
  if (b.dataset.cot) { if (dirty) return toast("Guarda primero la propuesta."); return abrirCot(cots.find((x) => x.id === b.dataset.cot)); }
  if (b.dataset.delr && item) { item.rubros.splice(+b.dataset.delr, 1); setDirty(true); render(); return; }
  const a = b.dataset.act;
  if (a === "nueva") return abrirProp(null);
  if (a === "addR") { item.rubros.push({ id: uid(), codigo: "", descripcion: "", unidad: "", cantidad: "", costo: "", capitulo: (item.rubros[item.rubros.length - 1] || {}).capitulo || "" }); setDirty(true); render(); return; }
  if (a === "verPegar") { pegar = true; render(); return; }
  if (a === "pegarNo") { pegar = false; render(); return; }
  if (a === "pegarOk") {
    const txt = $("#pegarTxt").value, modo = formatoNumeros(txt); let cap = "", n = 0;
    for (const raw of txt.split(/\r?\n/)) {
      if (!raw.trim()) continue; const c = raw.split("\t").map((x) => x.trim());
      const [codigo, descripcion, unidad, cantidad, costo] = c.length >= 5 ? c : c.length === 4 ? ["", ...c] : ["", c.join(" "), "", "", ""];
      const tiene = numCon(cantidad, modo) || numCon(costo, modo);
      if (/^(c[oó]d|item|rubro|descrip)/i.test(codigo || descripcion) && !tiene) continue;
      if (!tiene) { cap = [codigo, descripcion].filter(Boolean).join(" ").trim() || cap; continue; }
      if (!descripcion) continue;
      item.rubros.push({ id: uid(), codigo, descripcion, unidad, cantidad: numCon(cantidad, modo), costo: numCon(costo, modo), capitulo: cap }); n++;
    }
    pegar = false; setDirty(true); render(); toast(n ? n + " rubros agregados" : "No encontré rubros con cantidad o costo."); return;
  }
  if (a === "nuevaCot") { if (dirty) return toast("Guarda primero la propuesta."); return abrirCot(null); }
  if (a === "adj") { if (dirty) return toast("Guarda primero la propuesta."); confirm = "adj"; render(); return; }
  if (a === "adjOk") return adjudicar();
  if (a === "del") { confirm = "del"; render(); return; }
  if (a === "delc") { confirm = "delc"; render(); return; }
  if (a === "noConf") { confirm = null; render(); return; }
  if (a === "delOk") { const { error } = await sb.from("propuestas").delete().eq("id", item.id); if (error) return toast("No se pudo borrar."); props = props.filter((x) => x.id !== item.id); cots = cots.filter((x) => x.propuesta_id !== item.id); view = "lista"; item = null; dirty = false; render(); toast("Propuesta borrada"); return; }
  if (a === "delcOk") { const { error } = await sb.from("cotizaciones").delete().eq("id", item.id); if (error) return toast("No se pudo borrar."); cots = cots.filter((x) => x.id !== item.id); toast("Cotización borrada"); return volverAProp(); }
  if (b.id === "btnGuardar") return view === "prop" ? guardarProp() : guardarCot();
  if (b.id === "btnPDF") { try { pdf(); } catch (err) { toast("No se pudo generar el PDF."); } return; }
  if (b.id === "btnVolver") {
    if (dirty && !b.dataset.sure) { b.dataset.sure = "1"; const prev = b.textContent; b.textContent = "¿Salir sin guardar?"; setTimeout(() => { if (b.dataset.sure) { b.dataset.sure = ""; b.textContent = prev; } }, 3000); return; }
    b.dataset.sure = "";
    if (view === "cot") return volverAProp();
    view = "lista"; item = null; dirty = false; render(); window.scrollTo(0, 0);
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
  if (perfil.rol !== "admin") { noAdmin = true; return render(); }
  await cargar(); render();
})();
})();
