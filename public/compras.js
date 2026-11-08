// DLV Plataforma — Compras. Dos caminos que terminan igual:
//   Pedido de obra (PD) → aprobación con proveedor y precios → orden de pedido (OC) → recepción (GE) → factura
//   Solicitud de cotización (SC) → proformas → comparativo y adjudicación → órdenes (OC) → recepción (GE) → factura
// La factura crea el gasto en Control de costos. Mismas tablas que el módulo dlv-compras, con permisos por obra.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hoy = () => ymd(new Date());
const masDias = (n, base) => { const d = base ? new Date(base + "T12:00") : new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const fmtF = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
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
  for (const cel of txt.split(/[\t\r\n]+/)) { const v = cel.trim(); if (/^-?[\d.]*,\d{1,4}$/.test(v) || /^-?\d{1,3}(\.\d{3})+,\d+$/.test(v)) coma++; else if (/^-?[\d,]*\.\d{1,4}$/.test(v) || /^-?\d{1,3}(,\d{3})+\.\d+$/.test(v)) punto++; }
  return coma > punto ? "coma" : punto > coma ? "punto" : "";
}
const numCon = (v, modo) => { const s = String(v ?? "").trim().replace(/[$\s]/g, ""); return modo === "coma" ? num(s.replace(/\./g, "").replace(",", ".")) : modo === "punto" ? num(s.replace(/,/g, "")) : num(s); };
const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => "$ " + (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pu4 = (n) => "$ " + (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const qty = (n) => (n || 0).toLocaleString("es-EC", { maximumFractionDigits: 3 });
const dec = (v) => typeof v === "number" ? String(v).replace(".", ",") : v ?? "";
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3800); }
// RUC ecuatoriano: 13 dígitos terminados en 001 (validación básica de forma)
const rucOk = (r) => /^\d{10}001$/.test(String(r || "").trim()) && +String(r).slice(0, 2) >= 1 && (+String(r).slice(0, 2) <= 24 || +String(r).slice(0, 2) === 30);

const ETAPAS = { pedido: "Por aprobar", cotizacion: "En cotización", comparativo: "Comparativo", orden: "Orden por emitir", entrega: "Por recibir", factura: "Por facturar", cerrado: "Cerrado", rechazado: "Rechazado" };
const EST_OC = { borrador: "Borrador", emitida: "Emitida", parcial: "Recepción parcial", recibida: "Recibida", facturada: "Facturada", anulada: "Anulada" };
const CATS = { materiales: "Materiales", equipos: "Equipos y transporte", indirectos: "Indirectos de obra", otros: "Otros" };
const UNIDADES = ["u", "saco", "m3", "m2", "m", "ml", "kg", "qq", "lt", "gl", "rollo", "plancha", "varilla", "volqueta", "global"];

let sb = null, user = null, perfil = null, obras = [], obraId = "";
let reqs = [], items = [], invit = [], profs = [], pitems = [], ocs = [], ocItems = [], ges = [], geItems = [], facts = [], provs = [], hist = [], sri = null, sinTablas = false, conGastos = true;
let view = "lista", tab = "procesos", req = null, oc = null, prov = null, dirty = false, confirm = null;
let pegar = false, aprob = null, pf = null, adj = null, rec = null, fac = null, provNuevo = null, volverA = "lista", fOC = "pend";
const esAdmin = () => perfil && perfil.rol === "admin";
const obra = (id) => obras.find((o) => o.id === (id || obraId)) || {};
const provDe = (ruc) => provs.find((p) => p.ruc === ruc) || { ruc, razon_social: ruc || "" };
const itemsDe = (rid) => items.filter((i) => i.requerimiento_id === rid).sort((a, b) => a.linea - b.linea);
const ocsDe = (rid) => ocs.filter((o) => o.requerimiento_id === rid);
const ocItemsDe = (oid) => ocItems.filter((i) => i.orden_id === oid).sort((a, b) => a.linea - b.linea);
const gesDe = (oid) => ges.filter((g) => g.orden_id === oid).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
const factsDe = (oid) => facts.filter((f) => f.orden_id === oid);
const profsDe = (rid) => profs.filter((p) => p.requerimiento_id === rid);
const recibidoDe = (oiId) => geItems.filter((g) => g.orden_item_id === oiId).reduce((t, g) => t + num(g.cantidad_recibida), 0);
const tolerancia = (v) => Math.max(1, Math.abs(v) * 0.01);

/* ---------- estados calculados ---------- */
function estadoOC(o) {
  if (o.estado === "anulada" || o.estado === "borrador") return o.estado;
  const its = ocItemsDe(o.id);
  const completo = its.length && its.every((i) => recibidoDe(i.id) >= num(i.cantidad) - 1e-9);
  const alguno = its.some((i) => recibidoDe(i.id) > 0);
  const fact = factsDe(o.id).reduce((t, f) => t + num(f.subtotal), 0), rv = valorRecibido(o);
  if (o.estado === "facturada" || (completo && fact > 0 && fact >= rv - tolerancia(rv))) return "facturada";
  return completo ? "recibida" : alguno ? "parcial" : "emitida";
}
const valorRecibido = (o) => r2(ocItemsDe(o.id).reduce((t, i) => t + recibidoDe(i.id) * num(i.precio_unitario), 0));
function etapaReq(r) {
  if (r.etapa === "rechazado") return "rechazado";
  const os = ocsDe(r.id).filter((o) => o.estado !== "anulada");
  if (os.length) {
    const es = os.map(estadoOC);
    if (es.every((e) => e === "facturada")) return "cerrado";
    if (es.some((e) => e === "borrador")) return "orden";
    if (es.every((e) => e === "recibida" || e === "facturada")) return "factura";
    return "entrega";
  }
  if (ocsDe(r.id).length && r.etapa !== "pedido" && r.etapa !== "cotizacion") return "cerrado"; // todas anuladas
  if (r.tipo === "directo" && r.etapa === "pedido") return "pedido";
  return profsDe(r.id).length ? "comparativo" : "cotizacion";
}
function calcOC(its, ivaPct) { const sub = r2(its.reduce((t, i) => t + num(i.cantidad) * num(i.precio_unitario), 0)), iva = r2(sub * num(ivaPct) / 100); return { subtotal: sub, iva, total: r2(sub + iva) }; }
function ultimoPrecio(desc, und) {
  const k = norm(desc); if (!k) return null;
  const c = hist.filter((h) => norm(h.descripcion) === k && (!und || !h.unidad || h.unidad === und)).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return c[0] || null;
}

/* ---------- datos ---------- */
async function q(fn) { try { const { data, error } = await fn(); return error ? null : data || []; } catch (_) { return null; } }
const ids = (arr) => arr.map((x) => x.id);
async function cargarObra() {
  reqs = items = invit = profs = pitems = ocs = ocItems = ges = geItems = facts = []; sinTablas = false;
  if (!obraId) return render();
  const r = await q(() => sb.from("compras_requerimientos").select("*").eq("obra_id", obraId).order("created_at", { ascending: false }));
  if (r === null) { sinTablas = true; return render(); }
  reqs = r;
  const o = await q(() => sb.from("compras_ordenes").select("*").eq("obra_id", obraId).order("created_at", { ascending: false }));
  ocs = o || [];
  const rid = ids(reqs), oid = ids(ocs);
  const [it, oi, ge] = await Promise.all([
    rid.length ? q(() => sb.from("compras_req_items").select("*").in("requerimiento_id", rid)) : [],
    oid.length ? q(() => sb.from("compras_orden_items").select("*").in("orden_id", oid)) : [],
    oid.length ? q(() => sb.from("compras_entregas").select("*").in("orden_id", oid)) : []
  ]);
  items = it || []; ocItems = oi || []; ges = ge || [];
  geItems = ges.length ? (await q(() => sb.from("compras_entrega_items").select("*").in("entrega_id", ids(ges)))) || [] : [];
  if (esAdmin()) {
    const [iv, pr, fa] = await Promise.all([
      rid.length ? q(() => sb.from("compras_invitados").select("*").in("requerimiento_id", rid)) : [],
      rid.length ? q(() => sb.from("compras_proformas").select("*").in("requerimiento_id", rid)) : [],
      oid.length ? q(() => sb.from("compras_orden_facturas").select("*").in("orden_id", oid)) : []
    ]);
    invit = iv || []; profs = pr || []; facts = fa || [];
    pitems = profs.length ? (await q(() => sb.from("compras_proforma_items").select("*").in("proforma_id", ids(profs)))) || [] : [];
  }
  render();
}
async function cargarGlobal() {
  provs = (await q(() => sb.from("proveedores").select("*").order("razon_social"))) || [];
  if (esAdmin()) {
    // historial de precios de todas las obras para mostrar el último precio pagado
    const [os, is] = await Promise.all([q(() => sb.from("compras_ordenes").select("id,numero,fecha,proveedor_ruc,estado")), q(() => sb.from("compras_orden_items").select("orden_id,descripcion,unidad,precio_unitario"))]);
    const om = Object.fromEntries((os || []).filter((x) => x.estado !== "anulada" && x.estado !== "borrador").map((x) => [x.id, x]));
    hist = (is || []).filter((i) => om[i.orden_id]).map((i) => ({ ...i, fecha: om[i.orden_id].fecha, numero: om[i.orden_id].numero, ruc: om[i.orden_id].proveedor_ruc }));
    // facturas que llegaron por correo (si está instalado el lector de facturas)
    sri = await q(() => sb.from("facturas_proveedor").select("clave_acceso,ruc_emisor,razon_social,numero,fecha_emision,subtotal,iva,total,obra_id,estado").eq("estado", "procesada").order("fecha_emision", { ascending: false }));
  }
}

/* ---------- render ---------- */
const secAbierta = {};
document.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.sec) secAbierta[view + d.dataset.sec] = d.open; }, true);
function aplicarSecciones() { document.querySelectorAll("details[data-sec]").forEach((d) => { const k = view + d.dataset.sec; if (k in secAbierta) d.open = secAbierta[k]; }); }
function render() { renderBase(); aplicarSecciones(); }
function setDirty(v) { dirty = v; const e = $("#estado"); if (!e) return; e.className = "state" + (v ? " dirty" : ""); e.textContent = v ? "Sin guardar" : ""; }
const reqEditable = (r) => !r.id || (esAdmin() ? !profsDe(r.id).length && !ocsDe(r.id).length : r.etapa === "pedido" && r.tipo === "directo");
function renderBase() {
  const m = $("#main");
  $("#top").hidden = !user;
  const conDock = view !== "lista";
  $("#dock").hidden = !conDock;
  if (conDock) {
    $("#btnVolver").textContent = view === "oc" && volverA === "req" ? "← Proceso" : "← Compras";
    $("#btnPDF").hidden = !(view === "oc" && oc && oc.id) && !(view === "req" && req && req.id && profsDe(req.id).length);
    $("#btnPDF").textContent = view === "req" ? "PDF comparativo" : "PDF orden";
    $("#btnGuardar").hidden = view === "req" ? !reqEditable(req) : view === "oc" ? !(esAdmin() && oc.estado === "borrador") : !esAdmin();
    setDirty(dirty);
  }
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (!obraId && view !== "prov") { m.innerHTML = `<div class="empty"><b>Sin obras asignadas.</b></div>`; return; }
  if (sinTablas) { m.innerHTML = `<div class="empty"><b>Falta activar Compras.</b><span>Ejecuta <b>supabase/compras.sql</b> en Supabase → SQL Editor y recarga.</span></div>`; return; }
  if (view === "req") return renderReq(m);
  if (view === "oc") return renderOC(m);
  if (view === "prov") return renderProv(m);
  renderLista(m);
}
function renderLista(m) {
  const tabs = [["procesos", "Procesos (" + reqs.length + ")"], ["ordenes", "Órdenes (" + ocs.length + ")"]].concat(esAdmin() ? [["proveedores", "Proveedores"]] : []);
  m.innerHTML = `<div class="segtabs" style="grid-template-columns:repeat(${tabs.length},1fr)" role="tablist">${tabs.map(([k, v]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${v}</button>`).join("")}</div>
  ${tab === "ordenes" ? htmlOrdenes() : tab === "proveedores" ? htmlProveedores() : htmlProcesos()}`;
}
function tarjetaReq(r) {
  const et = etapaReq(r), its = itemsDe(r.id), os = ocsDe(r.id).filter((o) => o.estado !== "anulada");
  return `<button class="rep rq" type="button" data-req="${esc(r.id)}"><span class="tp ${r.tipo}">${r.tipo === "directo" ? "PD" : "SC"}</span>
    <span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${esc(r.titulo)}${r.urgente ? ` <em class="urg">URGENTE</em>` : ""}</span>
      <span class="d">${esc([r.numero || "nuevo", fmtF(r.fecha), its.length + (its.length === 1 ? " ítem" : " ítems"), r.solicitado_por || r.creado_por, os.length ? os.map((o) => o.numero || "OC").join(", ") : ""].filter(Boolean).join(" · "))}</span></span>
    <span class="pill et-${et}">${ETAPAS[et]}</span></button>`;
}
function htmlProcesos() {
  const grupos = [["Por aprobar", ["pedido"]], ["En cotización", ["cotizacion", "comparativo"]], ["En curso", ["orden", "entrega", "factura"]], ["Cerrados", ["cerrado", "rechazado"]]];
  const pend = reqs.filter((r) => etapaReq(r) === "pedido").length;
  return `
  <div class="listhead"><h1>Compras · ${esc(obra().nombre)}</h1><div class="acts"><button class="btn hivis" type="button" data-act="nuevoPD">+ Pedido de obra</button>${esAdmin() ? `<button class="btn" type="button" data-act="nuevoSC">+ Cotización</button>` : ""}</div></div>
  ${esAdmin() && pend ? `<div class="alertbar"><b>${pend === 1 ? "1 pedido de obra espera" : pend + " pedidos de obra esperan"} tu aprobación</b><span>Apruébalos con proveedor y precios, pásalos a cotización o recházalos.</span></div>` : ""}
  ${reqs.length ? grupos.map(([t, ets]) => { const g = reqs.filter((r) => ets.includes(etapaReq(r))); return g.length ? `<details class="grp" data-sec="g${ets[0]}"${ets[0] === "cerrado" ? "" : " open"}><summary>${t} <span class="code">${g.length}</span></summary><div class="list">${g.map(tarjetaReq).join("")}</div></details>` : ""; }).join("")
    : `<div class="empty"><span>${esAdmin() ? "Un pedido de obra va directo a orden con tu aprobación. Una cotización pasa por proformas y comparativo antes de la orden." : "Pide aquí el material de tu obra. Cuando se apruebe, verás la orden y registrarás la recepción con la guía de remisión."}</span><button class="btn hivis" type="button" data-act="nuevoPD">+ Primer pedido</button></div>`}`;
}
function htmlOrdenes() {
  const lista = ocs.filter((o) => { const e = estadoOC(o); return fOC === "todas" || (fOC === "pend" ? ["emitida", "parcial"].includes(e) : fOC === "fact" ? e === "recibida" : true); });
  return `
  <div class="listhead"><h1>Órdenes de pedido</h1></div>
  <div class="chipsel">${[["pend", "Por recibir"], ["fact", "Por facturar"], ["todas", "Todas"]].map(([k, v]) => `<button type="button" data-foc="${k}" aria-pressed="${fOC === k}">${v} (${k === "todas" ? ocs.length : ocs.filter((o) => k === "pend" ? ["emitida", "parcial"].includes(estadoOC(o)) : estadoOC(o) === "recibida").length})</button>`).join("")}</div>
  <div class="list">${lista.length ? lista.map(tarjetaOC).join("") : `<div class="empty"><span>No hay órdenes en este grupo.</span></div>`}</div>`;
}
function tarjetaOC(o) {
  const e = estadoOC(o), its = ocItemsDe(o.id), av = its.length ? its.reduce((t, i) => t + Math.min(1, recibidoDe(i.id) / (num(i.cantidad) || 1)), 0) / its.length * 100 : 0;
  return `<button class="rep" type="button" data-oc="${esc(o.id)}"><span class="ocn">${esc((o.numero || "OC").replace(/^OC-\d{4}-/, ""))}<small>OC</small></span>
    <span style="min-width:0;display:flex;flex-direction:column;gap:3px"><span class="t">${esc(provDe(o.proveedor_ruc).razon_social)}</span>
      <span class="d">${esc([o.numero, fmtF(o.fecha), o.fecha_entrega ? "entrega " + fmtF(o.fecha_entrega) : "", money(num(o.total))].filter(Boolean).join(" · "))}</span>
      ${e !== "borrador" && e !== "anulada" ? `<span class="meter sm"><i style="width:${av.toFixed(0)}%"></i></span>` : ""}</span>
    <span class="pill oc-${e}">${EST_OC[e]}</span></button>`;
}
function htmlProveedores() {
  return `<div class="listhead"><h1>Proveedores</h1><button class="btn hivis" type="button" data-act="nuevoProv">+ Proveedor</button></div>
  <div class="list">${provs.length ? provs.map((p) => { const n = hist.filter((h) => h.ruc === p.ruc).length; return `<button class="rep" type="button" data-prov="${esc(p.ruc)}"><span class="ini">${esc(p.razon_social.split(/\s+/).slice(0, 2).map((x) => x[0]).join(""))}</span>
    <span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${esc(p.razon_social)}</span><span class="d">${esc([p.ruc, p.categoria, p.contacto, p.telefono].filter(Boolean).join(" · "))}</span></span>
    <span class="code">${n ? n + " ítems" : ""}</span></button>`; }).join("") : `<div class="empty"><span>Registra a tus proveedores con su RUC. Es la misma lista que usa el lector de facturas del SRI.</span></div>`}</div>`;
}

/* ----- proceso (pedido o cotización) ----- */
function renderReq(m) {
  const r = req, ed = reqEditable(r), dis = ed ? "" : " disabled", et = r.id ? etapaReq(r) : (r.tipo === "directo" ? "pedido" : "cotizacion");
  m.innerHTML = `
  <details class="sec" open><summary><span class="num">${r.tipo === "directo" ? "PD" : "SC"}</span><h2>${r.id ? esc(r.numero || "Proceso") : r.tipo === "directo" ? "Nuevo pedido de obra" : "Nueva solicitud de cotización"}</h2><span class="sum">${ETAPAS[et]}</span></summary><div class="body">
    <label class="fld" for="r_tit"><span>${r.tipo === "directo" ? "¿Qué se necesita?" : "Título del proceso"}</span><input id="r_tit" type="text" data-r="titulo" value="${esc(r.titulo)}" placeholder="${r.tipo === "directo" ? "Ej.: cemento y arena para losa N+6" : "Ej.: acero de refuerzo losas 3 a 5"}"${dis}></label>
    <div class="grid2"><label class="fld" for="r_lim"><span>${r.tipo === "directo" ? "Se necesita para" : "Recibir proformas hasta"}</span><input id="r_lim" type="date" data-r="fecha_limite" value="${esc(r.fecha_limite || "")}"${dis}></label>
      <label class="fld" for="r_lug"><span>Lugar de entrega</span><input id="r_lug" type="text" data-r="lugar_entrega" value="${esc(r.lugar_entrega || "")}" placeholder="Obra ${esc(obra().nombre || "")}"${dis}></label></div>
    ${r.tipo === "directo" ? `<label class="chk"><input type="checkbox" id="r_urg"${r.urgente ? " checked" : ""}${dis}> Urgente</label>` : ""}
    <label class="fld" for="r_not"><span>Notas</span><textarea id="r_not" data-r="notas_pedido" rows="2"${dis}>${esc(r.notas_pedido || "")}</textarea></label>
    ${r.motivo_rechazo ? `<span class="warnline">Rechazado: ${esc(r.motivo_rechazo)}</span>` : ""}
  </div></details>
  <details class="sec" open><summary><span class="num">${r.items.length}</span><h2>Ítems</h2><span class="sum"></span></summary><div class="body">
    <div class="rows">${r.items.map((it, i) => `
      <div class="r r-it2">${ed ? `<label class="fld"><span>Descripción</span><input type="text" data-i="${i}" data-k="descripcion" value="${esc(it.descripcion)}"></label>
        <label class="fld"><span>Und</span><input type="text" list="dlUnd" data-i="${i}" data-k="unidad" value="${esc(it.unidad)}"></label>
        <label class="fld"><span>Cantidad</span><input type="text" inputmode="decimal" data-i="${i}" data-k="cantidad" value="${esc(dec(it.cantidad))}"></label>
        <button class="x" type="button" data-delit="${i}" aria-label="Quitar ítem">×</button>
        <label class="fld ext"><span>Especificación (opcional)</span><input type="text" data-i="${i}" data-k="especificacion" value="${esc(it.especificacion || "")}"></label>`
      : `<span class="ln1"><b>${qty(num(it.cantidad))} ${esc(it.unidad)}</b> ${esc(it.descripcion)}${it.especificacion ? ` <span class="code">· ${esc(it.especificacion)}</span>` : ""}</span>`}</div>`).join("") || `<span class="code">Agrega lo que se necesita.</span>`}</div>
    <datalist id="dlUnd">${UNIDADES.map((u) => `<option value="${u}">`).join("")}</datalist>
    ${ed ? `<div class="acts"><button class="btn sm" type="button" data-act="addIt">+ Ítem</button><button class="btn sm" type="button" data-act="verPegar">Pegar desde Excel</button></div>
      ${pegar !== false ? `<div class="pastebox"><span class="code">Columnas: Descripción · Unidad · Cantidad (· Especificación).</span><textarea id="pegarTxt" rows="5"></textarea><div><button class="btn sm primary" type="button" data-act="pegarOk">Agregar</button> <button class="btn sm ghost" type="button" data-act="pegarNo">Cancelar</button></div></div>` : ""}` : ""}
  </div></details>
  ${r.id ? htmlAcciones(r, et) : ""}`;
}
function htmlAcciones(r, et) {
  let h = "";
  if (esAdmin() && et === "pedido") {
    if (!aprob) h += `<section class="obracard"><div class="listhead"><h2 class="h2">Decisión</h2></div><div class="acts"><button class="btn primary" type="button" data-act="aprobar">Aprobar con proveedor y precios</button><button class="btn" type="button" data-act="aCotizar">Pasar a cotización</button><button class="btn ghost" type="button" data-act="rechazar">Rechazar</button></div>
      ${confirm === "rech" ? `<div class="confirm"><label class="fld" style="flex:1"><span>Motivo</span><input id="motivo" type="text"></label><button class="btn sm danger" type="button" data-act="rechOk">Rechazar pedido</button><button class="btn sm" type="button" data-act="noConf">Cancelar</button></div>` : ""}
      ${calcOC(r.items.map((i) => ({ cantidad: i.cantidad, precio_unitario: (ultimoPrecio(i.descripcion, i.unidad) || {}).precio_unitario || 0 })), 0).subtotal > 1000 ? `<span class="code">Por los últimos precios este pedido pasa de $ 1.000: conviene cotizar.</span>` : ""}</section>`;
    else h += htmlAprobar(r);
  }
  if (r.tipo === "cotizacion" && esAdmin() && ["cotizacion", "comparativo"].includes(et)) h += htmlCotizacion(r);
  const os = ocsDe(r.id);
  if (os.length) h += `<details class="sec" data-sec="ocs" open><summary><span class="num">${os.length}</span><h2>Órdenes de pedido</h2><span class="sum"></span></summary><div class="body"><div class="list">${os.map(tarjetaOC).join("")}</div></div></details>`;
  if (r.justificacion) h += `<span class="code">Justificación de la adjudicación: ${esc(r.justificacion)}</span>`;
  if (esAdmin() && !os.length && confirm !== "rech") h += confirm === "delR" ? `<div class="confirm"><span>¿Borrar ${esc(r.numero || "este proceso")}?</span><button class="btn sm danger" type="button" data-act="delROk">Sí, borrar</button><button class="btn sm" type="button" data-act="noConf">Cancelar</button></div>` : `<div><button class="btn sm ghost" type="button" data-act="delR">Borrar proceso</button></div>`;
  return h;
}
function selProv(id, val, extra = "") {
  return `<select id="${id}"${extra}><option value="">Elegir proveedor…</option>${provs.map((p) => `<option value="${esc(p.ruc)}"${p.ruc === val ? " selected" : ""}>${esc(p.razon_social)}</option>`).join("")}<option value="__nuevo">+ Nuevo proveedor…</option></select>
    ${provNuevo && provNuevo.para === id ? `<div class="newprov"><label class="fld"><span>RUC</span><input type="text" inputmode="numeric" maxlength="13" id="np_ruc" value="${esc(provNuevo.ruc)}"></label><label class="fld"><span>Razón social</span><input type="text" id="np_rs" value="${esc(provNuevo.razon_social)}"></label><label class="fld"><span>Teléfono</span><input type="tel" id="np_tel" value="${esc(provNuevo.telefono)}"></label><div class="acts"><button class="btn sm primary" type="button" data-act="npOk">Guardar proveedor</button><button class="btn sm ghost" type="button" data-act="npNo">Cancelar</button></div></div>` : ""}`;
}
function htmlAprobar(r) {
  const a = aprob, sub = r2(r.items.reduce((t, it) => t + num(it.cantidad) * num(a.precios[it.id]), 0)), iva = r2(sub * num(a.iva_pct) / 100);
  return `<details class="sec" open><summary><span class="num">✓</span><h2>Aprobar pedido</h2><span class="sum">${money(sub + iva)}</span></summary><div class="body">
    <label class="fld" for="a_prov"><span>Proveedor</span>${selProv("a_prov", a.proveedor_ruc)}</label>
    <div class="grid3"><label class="fld"><span>Fecha de entrega</span><input type="date" data-a="fecha_entrega" value="${esc(a.fecha_entrega)}"></label><label class="fld"><span>Forma de pago</span><input type="text" data-a="forma_pago" value="${esc(a.forma_pago)}" placeholder="Crédito 30 días"></label><label class="fld"><span>IVA %</span><input type="text" inputmode="decimal" data-a="iva_pct" value="${esc(dec(a.iva_pct))}"></label></div>
    <div class="rows">${r.items.map((it) => { const u = ultimoPrecio(it.descripcion, it.unidad); return `<div class="r r-pr2"><span class="ln1"><b>${qty(num(it.cantidad))} ${esc(it.unidad)}</b> ${esc(it.descripcion)}${u ? `<small class="code">Último: ${pu4(num(u.precio_unitario))} · ${esc(provDe(u.ruc).razon_social)} · ${fmtF(u.fecha)}</small>` : ""}</span>
      <label class="fld"><span>P. unit. sin IVA</span><input type="text" inputmode="decimal" data-ap="${esc(it.id)}" value="${esc(dec(a.precios[it.id]))}"></label><span class="nm b" id="ap_${esc(it.id)}">${money(num(it.cantidad) * num(a.precios[it.id]))}</span></div>`; }).join("")}</div>
    <div class="grid2"><label class="fld"><span>Cargar en costos como</span><select data-a="categoria">${Object.entries(CATS).map(([k, v]) => `<option value="${k}"${a.categoria === k ? " selected" : ""}>${v}</option>`).join("")}</select></label><label class="fld"><span>Capítulo (opcional)</span><input type="text" data-a="capitulo" value="${esc(a.capitulo)}"></label></div>
    <div class="sumgrid" id="apSum">${totHtml(sub, iva)}</div>
    <div class="acts"><button class="btn primary" type="button" data-act="aprobOk">Aprobar y emitir la orden</button><button class="btn ghost" type="button" data-act="aprobNo">Cancelar</button></div>
  </div></details>`;
}
const totHtml = (sub, iva) => `<div><span>Subtotal</span><b>${money(sub)}</b></div><div><span>IVA</span><b>${money(iva)}</b></div><div class="big tot"><span>Total</span><b>${money(sub + iva)}</b></div>`;
function htmlCotizacion(r) {
  const inv = invit.filter((x) => x.requerimiento_id === r.id), ps = profsDe(r.id);
  const txt = "*Solicitud de cotización " + (r.numero || "") + "*\nDLV Construcciones · Obra " + (obra().nombre || "") + "\n\n" + r.items.map((it, i) => (i + 1) + ") " + qty(num(it.cantidad)) + " " + it.unidad + " · " + it.descripcion + (it.especificacion ? " (" + it.especificacion + ")" : "")).join("\n") +
    "\n\nPor favor enviar proforma con precio unitario sin IVA, plazo de entrega, forma de pago y validez" + (r.fecha_limite ? " hasta el " + fmtF(r.fecha_limite) : "") + ". Entrega en " + (r.lugar_entrega || "obra " + (obra().nombre || "")) + ".";
  return `
  <details class="sec" data-sec="inv" open><summary><span class="num">1</span><h2>Proveedores invitados</h2><span class="sum">${inv.length}</span></summary><div class="body">
    <div class="mini">${inv.map((x) => { const p = provDe(x.proveedor_ruc), tel = String(p.telefono || "").replace(/\D/g, "").replace(/^0/, "593"); return `<div><span>${esc(p.razon_social)}</span>${ps.some((y) => y.proveedor_ruc === x.proveedor_ruc) ? `<span class="pill de-ok">Proforma recibida</span>` : `<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${/^5939\d{8}$/.test(tel) ? tel : ""}?text=${encodeURIComponent(txt)}">Pedir por WhatsApp</a>`}<button class="x" type="button" data-delinv="${esc(x.id)}" aria-label="Quitar">×</button></div>`; }).join("") || `<span class="code">Invita al menos a tres proveedores.</span>`}</div>
    <div class="grid2"><label class="fld"><span>Invitar</span>${selProv("inv_prov", "")}</label><div style="align-self:end"><button class="btn sm" type="button" data-act="invitar">Invitar</button></div></div>
    <details class="copybox"><summary>Texto de la solicitud</summary><textarea readonly rows="6">${esc(txt)}</textarea></details>
  </div></details>
  <details class="sec" data-sec="pf" open><summary><span class="num">2</span><h2>Proformas recibidas</h2><span class="sum">${ps.length}</span></summary><div class="body">
    <div class="mini">${ps.map((p) => { const t = totalProf(p, r); return `<div><button class="lnk" type="button" data-pf="${esc(p.id)}">${esc(provDe(p.proveedor_ruc).razon_social)}</button><b>${money(t.total)}</b><span class="code">${t.faltan ? t.faltan + " ítems sin precio" : p.plazo_entrega_dias ? p.plazo_entrega_dias + " días" : ""}</span></div>`; }).join("") || `<span class="code">Registra cada proforma con sus precios unitarios.</span>`}</div>
    ${pf ? htmlProforma(r) : `<div><button class="btn sm hivis" type="button" data-act="nuevaPf">+ Registrar proforma</button></div>`}
  </div></details>
  ${ps.length ? htmlComparativo(r) : ""}`;
}
function totalProf(p, r) {
  const pi = pitems.filter((x) => x.proforma_id === p.id); let sub = 0, faltan = 0;
  for (const it of r.items) { const x = pi.find((y) => y.req_item_id === it.id); if (x) sub += num(x.precio_unitario) * num(it.cantidad); else faltan++; }
  sub = r2(sub); const iva = r2(sub * num(p.iva_pct) / 100); return { subtotal: sub, iva, total: r2(sub + iva), faltan };
}
function htmlProforma(r) {
  const p = pf;
  return `<div class="pfbox">
    <label class="fld"><span>Proveedor</span>${selProv("pf_prov", p.proveedor_ruc, p.id ? " disabled" : "")}</label>
    <div class="grid3"><label class="fld"><span>N.° proforma</span><input type="text" data-pf2="numero_proforma" value="${esc(p.numero_proforma || "")}"></label><label class="fld"><span>Fecha</span><input type="date" data-pf2="fecha" value="${esc(p.fecha)}"></label><label class="fld"><span>Validez (días)</span><input type="text" inputmode="numeric" data-pf2="validez_dias" value="${esc(p.validez_dias ?? "")}"></label>
      <label class="fld"><span>Plazo de entrega (días)</span><input type="text" inputmode="numeric" data-pf2="plazo_entrega_dias" value="${esc(p.plazo_entrega_dias ?? "")}"></label><label class="fld"><span>Forma de pago</span><input type="text" data-pf2="forma_pago" value="${esc(p.forma_pago || "")}"></label><label class="fld"><span>IVA %</span><input type="text" inputmode="decimal" data-pf2="iva_pct" value="${esc(dec(p.iva_pct))}"></label></div>
    <label class="chk"><input type="checkbox" id="pf_transp"${p.transporte_incluido ? " checked" : ""}> Transporte incluido</label>
    <div class="rows">${r.items.map((it) => { const x = p.precios[it.id] || {}; return `<div class="r r-pf"><span class="ln1"><b>${qty(num(it.cantidad))} ${esc(it.unidad)}</b> ${esc(it.descripcion)}</span>
      <label class="fld"><span>P. unit.</span><input type="text" inputmode="decimal" data-pp="${esc(it.id)}" data-k="precio" value="${esc(dec(x.precio))}"></label>
      <label class="fld"><span>Marca</span><input type="text" data-pp="${esc(it.id)}" data-k="marca" value="${esc(x.marca || "")}"></label>
      <label class="chk sm"><input type="checkbox" data-ppc="${esc(it.id)}"${x.cumple === false ? "" : " checked"}> Cumple</label></div>`; }).join("")}</div>
    ${p._pegar ? `<div class="pastebox"><span class="code">Pega la columna de precios unitarios, uno por línea y en el orden de los ítems.</span><textarea id="ppTxt" rows="5"></textarea><div><button class="btn sm primary" type="button" data-act="ppOk">Poner precios</button> <button class="btn sm ghost" type="button" data-act="ppNo">Cancelar</button></div></div>`
      : `<button class="btn sm" type="button" data-act="pegarPrecios">Pegar precios desde Excel</button>`}
    <label class="fld"><span>Observaciones</span><textarea data-pf2="observaciones" rows="2">${esc(p.observaciones || "")}</textarea></label>
    <div class="acts"><button class="btn primary" type="button" data-act="pfOk">Guardar proforma</button><button class="btn ghost" type="button" data-act="pfNo">Cancelar</button>${p.id ? `<button class="btn sm danger" type="button" data-act="pfDel">Borrar proforma</button>` : ""}</div>
  </div>`;
}
function matrizComparativo(r) {
  const ps = profsDe(r.id);
  const filas = r.items.map((it) => {
    const celdas = ps.map((p) => { const x = pitems.find((y) => y.proforma_id === p.id && y.req_item_id === it.id); return x ? { p, x, pu: num(x.precio_unitario), tot: num(x.precio_unitario) * num(it.cantidad) } : null; });
    const validos = celdas.filter((c) => c && c.x.cumple !== false), min = validos.length ? Math.min(...validos.map((c) => c.pu)) : null;
    return { it, celdas, min };
  });
  return { ps, filas };
}
function htmlComparativo(r) {
  const { ps, filas } = matrizComparativo(r);
  if (!adj) { adj = { sel: {}, just: r.justificacion || "" }; for (const f of filas) { const best = f.celdas.filter((c) => c && c.x.cumple !== false).sort((a, b) => a.pu - b.pu)[0]; if (best) adj.sel[f.it.id] = best.x.id; } }
  const totAdj = {}; for (const f of filas) { const c = f.celdas.find((c) => c && c.x.id === adj.sel[f.it.id]); if (c) totAdj[c.p.proveedor_ruc] = (totAdj[c.p.proveedor_ruc] || 0) + c.tot; }
  return `<details class="sec" data-sec="cmp" open><summary><span class="num">3</span><h2>Comparativo y adjudicación</h2><span class="sum">${ps.length} proformas</span></summary><div class="body">
    <div class="cmpwrap"><table class="cmp"><thead><tr><th>Ítem</th>${ps.map((p) => `<th>${esc(provDe(p.proveedor_ruc).razon_social)}<br><button class="lnk" type="button" data-todo="${esc(p.id)}">Todo a este</button></th>`).join("")}</tr></thead><tbody>
      ${filas.map((f) => `<tr><td><b>${qty(num(f.it.cantidad))} ${esc(f.it.unidad)}</b> ${esc(f.it.descripcion)}</td>${f.celdas.map((c) => c ? `<td class="${c.pu === f.min && c.x.cumple !== false ? "min" : ""}${c.x.cumple === false ? " nc" : ""}"><label><input type="radio" name="adj_${esc(f.it.id)}" data-adj="${esc(f.it.id)}" value="${esc(c.x.id)}"${adj.sel[f.it.id] === c.x.id ? " checked" : ""}> ${pu4(c.pu)}</label><small>${money(c.tot)}${c.x.marca ? " · " + esc(c.x.marca) : ""}${c.x.cumple === false ? " · no cumple" : ""}</small></td>` : `<td class="na">—</td>`).join("")}</tr>`).join("")}
      </tbody><tfoot><tr><td>Total con IVA</td>${ps.map((p) => `<td><b>${money(totalProf(p, r).total)}</b><small>${[p.plazo_entrega_dias ? p.plazo_entrega_dias + " días" : "", p.forma_pago, p.transporte_incluido ? "con transporte" : "sin transporte"].filter(Boolean).map(esc).join(" · ")}</small></td>`).join("")}</tr>
      <tr><td>Adjudicado sin IVA</td>${ps.map((p) => `<td><b>${totAdj[p.proveedor_ruc] ? money(totAdj[p.proveedor_ruc]) : "—"}</b></td>`).join("")}</tr></tfoot></table></div>
    <span class="code">En verde el menor precio de cada ítem entre los que cumplen. Elige por ítem o "Todo a este" para un solo proveedor.</span>
    <label class="fld"><span>Justificación de la adjudicación (queda en el comparativo)</span><textarea id="adjJust" rows="2" placeholder="Ej.: menor precio total y entrega en 3 días">${esc(adj.just)}</textarea></label>
    <div class="acts"><button class="btn primary" type="button" data-act="adjudicar">Adjudicar y generar ${Object.keys(totAdj).length === 1 ? "la orden" : Object.keys(totAdj).length + " órdenes"}</button></div>
  </div></details>`;
}

/* ----- orden de pedido ----- */
function renderOC(m) {
  const o = oc, e = estadoOC(o), its = o.items, bor = esAdmin() && o.estado === "borrador", dis = bor ? "" : " disabled", p = provDe(o.proveedor_ruc);
  const t = calcOC(its, o.iva_pct), r = reqs.find((x) => x.id === o.requerimiento_id) || {};
  const vr = valorRecibido(o), fs = factsDe(o.id), vf = r2(fs.reduce((s, f) => s + num(f.subtotal), 0));
  const tel = String(p.telefono || "").replace(/\D/g, "").replace(/^0/, "593");
  const wa = "*Orden de pedido " + (o.numero || "") + "*\nDLV Construcciones Cía. Ltda.\nObra: " + obra(o.obra_id).nombre + "\nEntrega: " + (fmtF(o.fecha_entrega) || "a coordinar") + (o.lugar_entrega ? " en " + o.lugar_entrega : "") + "\n\n" +
    its.map((i, k) => (k + 1) + ") " + qty(num(i.cantidad)) + " " + i.unidad + " · " + i.descripcion + " · " + pu4(num(i.precio_unitario))).join("\n") + "\n\nTotal " + money(t.total) + " con IVA · Pago: " + (o.forma_pago || "—") + "\nEntregar con guía de remisión y facturar a DLV Construcciones Cía. Ltda. citando " + (o.numero || "la orden") + ".";
  m.innerHTML = `
  <details class="sec" open><summary><span class="num">OC</span><h2>${esc(o.numero || "Orden de pedido")}</h2><span class="sum">${EST_OC[e]}</span></summary><div class="body">
    <div class="kv"><span>Proveedor</span><b>${esc(p.razon_social)}${p.ruc ? " · " + esc(p.ruc) : ""}</b><span>Proceso</span><b>${esc([r.numero, r.titulo].filter(Boolean).join(" · "))}</b><span>Fecha</span><b>${fmtF(o.fecha)}</b>${o.emitida_en ? `<span>Emitida</span><b>${fmtF(String(o.emitida_en).slice(0, 10))}${o.emitida_por ? " · " + esc(o.emitida_por) : ""}</b>` : ""}</div>
    <div class="grid3"><label class="fld"><span>Fecha de entrega</span><input type="date" data-o="fecha_entrega" value="${esc(o.fecha_entrega || "")}"${dis}></label><label class="fld"><span>Lugar de entrega</span><input type="text" data-o="lugar_entrega" value="${esc(o.lugar_entrega || "")}"${dis}></label><label class="fld"><span>Forma de pago</span><input type="text" data-o="forma_pago" value="${esc(o.forma_pago || "")}"${dis}></label></div>
    ${esAdmin() ? `<div class="grid3"><label class="fld"><span>IVA %</span><input type="text" inputmode="decimal" data-o="iva_pct" value="${esc(dec(o.iva_pct))}"${dis}></label><label class="fld"><span>Cargar en costos como</span><select data-o="categoria"${dis}>${Object.entries(CATS).map(([k, v]) => `<option value="${k}"${(o.categoria || "materiales") === k ? " selected" : ""}>${v}</option>`).join("")}</select></label><label class="fld"><span>Capítulo</span><input type="text" data-o="capitulo" value="${esc(o.capitulo || "")}"${dis}></label></div>` : ""}
  </div></details>
  <details class="sec" open><summary><span class="num">${its.length}</span><h2>Ítems</h2><span class="sum">${money(t.total)}</span></summary><div class="body">
    <div class="rows">${its.map((i, k) => { const rc = i.id ? recibidoDe(i.id) : 0; return `<div class="r r-oc"><span class="ln1"><b>${qty(num(i.cantidad))} ${esc(i.unidad)}</b> ${esc(i.descripcion)}${e !== "borrador" ? `<small class="code">Recibido ${qty(rc)} de ${qty(num(i.cantidad))}</small>` : ""}</span>
      ${bor ? `<label class="fld"><span>Cant.</span><input type="text" inputmode="decimal" data-oi="${k}" data-k="cantidad" value="${esc(dec(i.cantidad))}"></label><label class="fld"><span>P. unit.</span><input type="text" inputmode="decimal" data-oi="${k}" data-k="precio_unitario" value="${esc(dec(i.precio_unitario))}"></label>` : `<span class="nm">${pu4(num(i.precio_unitario))}</span>`}
      <span class="nm b" id="oi_${k}">${money(num(i.cantidad) * num(i.precio_unitario))}</span></div>`; }).join("")}</div>
    <div class="sumgrid" id="ocSum">${totHtml(t.subtotal, t.iva)}</div>
    ${esAdmin() ? `<div class="acts">${bor ? `<button class="btn primary" type="button" data-act="emitir">Emitir orden</button>` : ""}${o.id && e !== "anulada" && e !== "borrador" ? `<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${/^5939\d{8}$/.test(tel) ? tel : ""}?text=${encodeURIComponent(wa)}">Enviar por WhatsApp</a>` : ""}
      ${o.id && e !== "anulada" && !gesDe(o.id).length && !fs.length ? (confirm === "anular" ? `<span class="confirm"><span>¿Anular la orden?</span><button class="btn sm danger" type="button" data-act="anularOk">Sí, anular</button><button class="btn sm" type="button" data-act="noConf">No</button></span>` : `<button class="btn ghost" type="button" data-act="anular">Anular</button>`) : ""}</div>` : ""}
  </div></details>
  ${o.id && !["borrador", "anulada"].includes(e) ? htmlRecepcion(o, e) : ""}
  ${o.id && esAdmin() && ["parcial", "recibida", "facturada"].includes(e) ? htmlFactura(o, e, vr, vf) : ""}`;
}
function htmlRecepcion(o, e) {
  const gs = gesDe(o.id);
  return `<details class="sec" data-sec="rec" open><summary><span class="num">GE</span><h2>Recepción en obra</h2><span class="sum">${gs.length} ${gs.length === 1 ? "entrega" : "entregas"}</span></summary><div class="body">
    <div class="mini">${gs.map((g) => `<div><span>${esc(g.numero || "GE")} · ${fmtF(g.fecha)}${g.guia_remision ? " · guía " + esc(g.guia_remision) : ""} · ${esc(g.recibido_por)}</span><button class="btn sm" type="button" data-gepdf="${esc(g.id)}">PDF</button></div>`).join("") || `<span class="code">Cuando llegue el material, registra lo recibido con la guía de remisión del proveedor.</span>`}</div>
    ${["emitida", "parcial"].includes(e) ? (rec ? `<div class="pfbox">
      <div class="grid3"><label class="fld"><span>Fecha</span><input type="date" data-g="fecha" value="${esc(rec.fecha)}"></label><label class="fld"><span>Recibido por</span><input type="text" data-g="recibido_por" value="${esc(rec.recibido_por)}"></label><label class="fld"><span>N.° guía de remisión</span><input type="text" data-g="guia_remision" value="${esc(rec.guia_remision)}" placeholder="001-001-000000123"></label>
        <label class="fld"><span>Transportista</span><input type="text" data-g="transportista" value="${esc(rec.transportista)}"></label><label class="fld"><span>Placa</span><input type="text" data-g="placa" value="${esc(rec.placa)}"></label><label class="fld"><span>Clave de acceso de la guía (opcional)</span><input type="text" inputmode="numeric" maxlength="49" data-g="guia_clave" value="${esc(rec.guia_clave)}"></label></div>
      <div class="rows">${o.items.map((i) => { const pend = r2(num(i.cantidad) - recibidoDe(i.id)), x = rec.q[i.id] || {}; return pend > 0 ? `<div class="r r-pf"><span class="ln1"><b>${esc(i.descripcion)}</b><small class="code">Pendiente ${qty(pend)} ${esc(i.unidad)}</small></span>
        <label class="fld"><span>Recibido</span><input type="text" inputmode="decimal" data-gq="${esc(i.id)}" data-k="rec" value="${esc(dec(x.rec))}"></label><label class="fld"><span>Rechazado</span><input type="text" inputmode="decimal" data-gq="${esc(i.id)}" data-k="rech" value="${esc(dec(x.rech))}"></label><label class="fld"><span>Nota</span><input type="text" data-gq="${esc(i.id)}" data-k="nota" value="${esc(x.nota || "")}"></label></div>` : ""; }).join("")}</div>
      <label class="fld"><span>Observaciones</span><textarea data-g="observaciones" rows="2">${esc(rec.observaciones)}</textarea></label>
      <div class="acts"><button class="btn primary" type="button" data-act="recOk">Registrar recepción</button><button class="btn ghost" type="button" data-act="recNo">Cancelar</button></div></div>`
      : `<div><button class="btn hivis" type="button" data-act="recibir">Registrar recepción</button></div>`) : ""}
  </div></details>`;
}
function htmlFactura(o, e, vr, vf) {
  const pedido = calcOC(o.items, o.iva_pct).subtotal, fs = factsDe(o.id), dif = r2(vf - vr), cuadra = Math.abs(dif) <= tolerancia(vr);
  const sug = (sri || []).filter((x) => x.ruc_emisor === o.proveedor_ruc && !facts.some((f) => f.clave_acceso === x.clave_acceso));
  return `<details class="sec" data-sec="fac" open><summary><span class="num">$</span><h2>Factura</h2><span class="sum">${fs.length ? (cuadra ? "Cuadra" : "No cuadra") : "Pendiente"}</span></summary><div class="body">
    <div class="tres"><div><small>Pedido</small><b>${money(pedido)}</b></div><div><small>Recibido</small><b>${money(vr)}</b></div><div><small>Facturado</small><b class="${fs.length && !cuadra ? "rojo" : ""}">${money(vf)}</b></div></div>
    ${fs.length ? `<span class="${cuadra ? "okline" : "warnline"}">${cuadra ? "✓ La factura cuadra con lo recibido (sin IVA)." : "Diferencia de " + money(dif) + " entre lo facturado y lo recibido. Revisa con el proveedor."}</span>` : ""}
    <div class="mini">${fs.map((f) => `<div><span>Fact. ${esc(f.numero || "")} · ${fmtF(f.fecha)}${f.clave_acceso ? " · SRI" : ""}</span><b>${money(num(f.total))}</b><span class="code">${f.gasto_id ? "en costos" : ""}</span></div>`).join("")}</div>
    ${e !== "facturada" || fac ? (fac ? `<div class="pfbox">
      ${sug.length ? `<label class="fld"><span>Facturas de este proveedor que llegaron por correo</span><select id="f_sri"><option value="">Registrar a mano…</option>${sug.map((x) => `<option value="${esc(x.clave_acceso)}"${fac.clave_acceso === x.clave_acceso ? " selected" : ""}>${esc(x.numero)} · ${fmtF(x.fecha_emision)} · ${money(num(x.total))}</option>`).join("")}</select></label>` : ""}
      <div class="grid3"><label class="fld"><span>N.° factura</span><input type="text" data-f="numero" value="${esc(fac.numero)}" placeholder="001-001-000004571"></label><label class="fld"><span>Fecha</span><input type="date" data-f="fecha" value="${esc(fac.fecha)}"></label><label class="fld"><span>Clave de acceso (opcional)</span><input type="text" inputmode="numeric" maxlength="49" data-f="clave_acceso" value="${esc(fac.clave_acceso)}"></label>
        <label class="fld"><span>Subtotal sin IVA</span><input type="text" inputmode="decimal" data-f="subtotal" value="${esc(dec(fac.subtotal))}"></label><label class="fld"><span>IVA</span><input type="text" inputmode="decimal" data-f="iva" value="${esc(dec(fac.iva))}"></label><label class="fld"><span>Total</span><input type="text" inputmode="decimal" data-f="total" value="${esc(dec(fac.total))}"></label></div>
      <span class="code">${conGastos ? "Al guardar, el subtotal sin IVA se carga como gasto de " + esc((CATS[o.categoria] || "materiales").toLowerCase()) + " de la obra en Control de costos." : "Activa Control de costos (costos.sql) para cargar el gasto a la obra."}</span>
      <div class="acts"><button class="btn primary" type="button" data-act="facOk">Guardar factura</button><button class="btn ghost" type="button" data-act="facNo">Cancelar</button></div></div>`
      : `<div><button class="btn hivis" type="button" data-act="facturar">Registrar factura</button></div>`) : ""}
  </div></details>`;
}
function renderProv(m) {
  const p = prov, nuevo = !p._orig;
  const h = hist.filter((x) => x.ruc === p.ruc).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 12);
  m.innerHTML = `<details class="sec" open><summary><span class="num">RUC</span><h2>${nuevo ? "Nuevo proveedor" : esc(p.razon_social)}</h2><span class="sum"></span></summary><div class="body">
    <div class="grid2"><label class="fld"><span>RUC</span><input type="text" inputmode="numeric" maxlength="13" data-pv="ruc" value="${esc(p.ruc)}"${nuevo ? "" : " disabled"}></label><label class="fld"><span>Razón social</span><input type="text" data-pv="razon_social" value="${esc(p.razon_social)}"></label>
      <label class="fld"><span>Nombre comercial</span><input type="text" data-pv="nombre_comercial" value="${esc(p.nombre_comercial || "")}"></label><label class="fld"><span>Categoría</span><input type="text" data-pv="categoria" value="${esc(p.categoria || "")}" placeholder="Ferretería, hormigón, acero…"></label>
      <label class="fld"><span>Contacto</span><input type="text" data-pv="contacto" value="${esc(p.contacto || "")}"></label><label class="fld"><span>Teléfono (celular para WhatsApp)</span><input type="tel" data-pv="telefono" value="${esc(p.telefono || "")}"></label>
      <label class="fld"><span>Correo</span><input type="email" data-pv="email" value="${esc(p.email || "")}"></label><label class="fld"><span>Obra por defecto de sus facturas</span><select data-pv="obra_sugerida_id"><option value="">—</option>${obras.map((o) => `<option value="${esc(o.id)}"${p.obra_sugerida_id === o.id ? " selected" : ""}>${esc(o.nombre)}</option>`).join("")}</select></label></div>
    <label class="fld"><span>Notas</span><textarea data-pv="notas" rows="2">${esc(p.notas || "")}</textarea></label>
  </div></details>
  ${h.length ? `<details class="sec" open><summary><span class="num">$</span><h2>Últimos precios</h2><span class="sum"></span></summary><div class="body"><div class="mini">${h.map((x) => `<div><span>${esc(x.descripcion)} · ${esc(x.unidad || "")}</span><b>${pu4(num(x.precio_unitario))}</b><span class="code">${esc(x.numero || "")} · ${fmtF(x.fecha)}</span></div>`).join("")}</div></div></details>` : ""}`;
}

/* ---------- acciones ---------- */
function abrirReq(r, tipo) {
  req = r ? { ...r, items: itemsDe(r.id).map((i) => ({ ...i })) } : { tipo, titulo: "", fecha_limite: tipo === "directo" ? masDias(2) : masDias(5), lugar_entrega: "", urgente: false, notas_pedido: "", etapa: tipo === "directo" ? "pedido" : "cotizacion", items: [{ id: uid(), descripcion: "", unidad: "u", cantidad: "", especificacion: "", _nuevo: true }] };
  aprob = pf = adj = provNuevo = null; pegar = false; confirm = null; view = "req"; dirty = !r; render(); window.scrollTo(0, 0);
}
async function guardarReq() {
  const r = req, nuevos = r.items.filter((i) => (i.descripcion || "").trim());
  if (!(r.titulo || "").trim()) return toast("Escribe qué se necesita.");
  if (!nuevos.length) return toast("Agrega al menos un ítem.");
  const mala = nuevos.find((i) => !(num(i.cantidad) > 0)); if (mala) return toast("Falta la cantidad de «" + mala.descripcion + "».");
  const row = { obra_id: obraId, titulo: r.titulo.trim(), fecha_limite: r.fecha_limite || null, lugar_entrega: (r.lugar_entrega || "").trim() || null, urgente: !!r.urgente, notas_pedido: (r.notas_pedido || "").trim() || null };
  let data, error;
  if (r.id) ({ data, error } = await sb.from("compras_requerimientos").update(row).eq("id", r.id).select().single());
  else ({ data, error } = await sb.from("compras_requerimientos").insert({ ...row, tipo: r.tipo, etapa: r.etapa, origen: "app", fecha: hoy(), creado_por: (perfil && perfil.nombre) || user.email, solicitado_por: (perfil && perfil.nombre) || user.email }).select().single());
  if (error) return toast("No se pudo guardar: " + error.message);
  // ítems: se reemplazan (solo mientras no hay proformas ni órdenes)
  if (r.id) { const { error: e1 } = await sb.from("compras_req_items").delete().eq("requerimiento_id", r.id); if (e1) return toast("No se pudieron actualizar los ítems: " + e1.message); }
  const rows = nuevos.map((i, k) => ({ requerimiento_id: data.id, linea: k + 1, descripcion: i.descripcion.trim(), unidad: (i.unidad || "u").trim(), cantidad: num(i.cantidad), especificacion: (i.especificacion || "").trim() || null }));
  const { data: its, error: e2 } = await sb.from("compras_req_items").insert(rows).select();
  if (e2) return toast("No se pudieron guardar los ítems: " + e2.message);
  items = items.filter((i) => i.requerimiento_id !== data.id).concat(its || []);
  const i = reqs.findIndex((x) => x.id === data.id); if (i > -1) reqs[i] = data; else reqs.unshift(data);
  const nuevo = !r.id; req = { ...data, items: itemsDe(data.id).map((x) => ({ ...x })) }; dirty = false; render();
  toast(nuevo ? (data.numero || "Pedido") + (r.tipo === "directo" ? " enviado para aprobación" : " creado · invita a los proveedores") : "Cambios guardados");
}
async function setEtapa(r, etapa, extra) {
  const { data, error } = await sb.from("compras_requerimientos").update({ etapa, ...(extra || {}) }).eq("id", r.id).select().single();
  if (error) { toast("No se pudo actualizar: " + error.message); return null; }
  const i = reqs.findIndex((x) => x.id === data.id); reqs[i] = data; req = { ...data, items: req.items }; return data;
}
async function crearOC(r, ruc, lineas, cab) {
  const t = calcOC(lineas, cab.iva_pct);
  const row = { requerimiento_id: r.id, obra_id: obraId, proveedor_ruc: ruc, proforma_id: cab.proforma_id || null, fecha: hoy(), fecha_entrega: cab.fecha_entrega || null, lugar_entrega: cab.lugar_entrega || r.lugar_entrega || null, forma_pago: cab.forma_pago || null,
    iva_pct: num(cab.iva_pct), ...t, estado: cab.estado || "borrador", categoria: cab.categoria || "materiales", capitulo: cab.capitulo || null, ...(cab.estado === "emitida" ? { emitida_por: (perfil && perfil.nombre) || user.email, emitida_en: new Date().toISOString() } : {}) };
  const { data: o, error } = await sb.from("compras_ordenes").insert(row).select().single();
  if (error) { toast("No se pudo crear la orden: " + error.message); return null; }
  const { data: its, error: e2 } = await sb.from("compras_orden_items").insert(lineas.map((l, k) => ({ orden_id: o.id, req_item_id: l.req_item_id || null, linea: k + 1, descripcion: l.descripcion, unidad: l.unidad, cantidad: num(l.cantidad), precio_unitario: num(l.precio_unitario) }))).select();
  if (e2) { toast("La orden quedó sin ítems: " + e2.message); }
  ocs.unshift(o); ocItems = ocItems.concat(its || []);
  for (const l of lineas) hist.push({ descripcion: l.descripcion, unidad: l.unidad, precio_unitario: num(l.precio_unitario), fecha: o.fecha, numero: o.numero, ruc });
  return o;
}
async function aprobar() {
  const r = req, a = aprob;
  if (!a.proveedor_ruc) return toast("Elige el proveedor.");
  const falta = r.items.find((it) => !(num(a.precios[it.id]) > 0)); if (falta) return toast("Falta el precio de «" + falta.descripcion + "».");
  const o = await crearOC(r, a.proveedor_ruc, r.items.map((it) => ({ req_item_id: it.id, descripcion: it.descripcion, unidad: it.unidad, cantidad: it.cantidad, precio_unitario: num(a.precios[it.id]) })), { ...a, estado: "emitida" });
  if (!o) return;
  await setEtapa(r, "entrega", { proveedor_sugerido: a.proveedor_ruc, adjudicado_en: new Date().toISOString() });
  aprob = null; render(); toast("Pedido aprobado · orden " + (o.numero || "") + " emitida");
}
async function guardarProforma() {
  const r = req, p = pf;
  if (!p.proveedor_ruc) return toast("Elige el proveedor de la proforma.");
  if (!p.id && profsDe(r.id).some((x) => x.proveedor_ruc === p.proveedor_ruc)) return toast("Ese proveedor ya tiene proforma: ábrela para corregirla.");
  const row = { requerimiento_id: r.id, proveedor_ruc: p.proveedor_ruc, numero_proforma: p.numero_proforma || null, fecha: p.fecha || hoy(), validez_dias: parseInt(p.validez_dias, 10) || null, plazo_entrega_dias: parseInt(p.plazo_entrega_dias, 10) || null,
    forma_pago: p.forma_pago || null, transporte_incluido: !!p.transporte_incluido, iva_pct: num(p.iva_pct), observaciones: p.observaciones || null };
  const { data, error } = p.id ? await sb.from("compras_proformas").update(row).eq("id", p.id).select().single() : await sb.from("compras_proformas").insert(row).select().single();
  if (error) return toast("No se pudo guardar: " + error.message);
  if (p.id) await sb.from("compras_proforma_items").delete().eq("proforma_id", p.id);
  const rows = r.items.filter((it) => String((p.precios[it.id] || {}).precio ?? "").trim() !== "").map((it) => { const x = p.precios[it.id]; return { proforma_id: data.id, req_item_id: it.id, precio_unitario: num(x.precio), marca: x.marca || null, cumple: x.cumple !== false }; });
  const { data: pis, error: e2 } = rows.length ? await sb.from("compras_proforma_items").insert(rows).select() : { data: [] };
  if (e2) return toast("No se guardaron los precios: " + e2.message);
  profs = profs.filter((x) => x.id !== data.id).concat([data]); pitems = pitems.filter((x) => x.proforma_id !== data.id).concat(pis || []);
  if (!invit.some((x) => x.requerimiento_id === r.id && x.proveedor_ruc === data.proveedor_ruc)) { const { data: iv } = await sb.from("compras_invitados").insert({ requerimiento_id: r.id, proveedor_ruc: data.proveedor_ruc }).select().single(); if (iv) invit.push(iv); }
  if (r.etapa === "cotizacion") await setEtapa(r, "comparativo");
  pf = null; adj = null; render(); toast("Proforma de " + provDe(data.proveedor_ruc).razon_social + " guardada");
}
async function adjudicar() {
  const r = req, { filas } = matrizComparativo(r), just = ($("#adjJust").value || "").trim();
  if (!just) return toast("Escribe la justificación de la adjudicación.");
  const sinAdj = filas.filter((f) => !adj.sel[f.it.id]); if (sinAdj.length) return toast("Falta adjudicar «" + sinAdj[0].it.descripcion + "».");
  const porProv = {};
  for (const f of filas) { const c = f.celdas.find((c) => c && c.x.id === adj.sel[f.it.id]); (porProv[c.p.id] = porProv[c.p.id] || { p: c.p, lineas: [] }).lineas.push({ req_item_id: f.it.id, descripcion: f.it.descripcion, unidad: f.it.unidad, cantidad: f.it.cantidad, precio_unitario: c.pu, xid: c.x.id }); }
  for (const f of filas) await sb.from("compras_req_items").update({ adjudicado_a: adj.sel[f.it.id] }).eq("id", f.it.id);
  const creadas = [];
  for (const { p, lineas } of Object.values(porProv)) {
    const o = await crearOC(r, p.proveedor_ruc, lineas, { proforma_id: p.id, iva_pct: p.iva_pct, forma_pago: p.forma_pago, fecha_entrega: p.plazo_entrega_dias ? masDias(p.plazo_entrega_dias) : r.fecha_limite, lugar_entrega: r.lugar_entrega, estado: "borrador" });
    if (o) creadas.push(o);
  }
  await setEtapa(r, "orden", { justificacion: just, adjudicado_en: new Date().toISOString() });
  adj = null; render(); toast(creadas.length + (creadas.length === 1 ? " orden creada en borrador" : " órdenes creadas en borrador") + ": revísalas y emítelas");
}
function abrirOC(o, desde) {
  oc = { ...o, items: ocItemsDe(o.id).map((i) => ({ ...i })) }; rec = fac = null; confirm = null; volverA = desde || "lista"; view = "oc"; dirty = false; render(); window.scrollTo(0, 0);
}
async function guardarOC(extra) {
  const o = oc, t = calcOC(o.items, o.iva_pct);
  const row = { fecha_entrega: o.fecha_entrega || null, lugar_entrega: o.lugar_entrega || null, forma_pago: o.forma_pago || null, iva_pct: num(o.iva_pct), categoria: o.categoria || "materiales", capitulo: o.capitulo || null, ...t, ...(extra || {}) };
  const { data, error } = await sb.from("compras_ordenes").update(row).eq("id", o.id).select().single();
  if (error) { toast("No se pudo guardar: " + error.message); return false; }
  if (o.estado === "borrador") for (const i of o.items) await sb.from("compras_orden_items").update({ cantidad: num(i.cantidad), precio_unitario: num(i.precio_unitario) }).eq("id", i.id);
  ocItems = ocItems.filter((x) => x.orden_id !== o.id).concat(o.items.map((i) => ({ ...i, cantidad: num(i.cantidad), precio_unitario: num(i.precio_unitario) })));
  const k = ocs.findIndex((x) => x.id === data.id); ocs[k] = data; oc = { ...data, items: ocItemsDe(data.id).map((i) => ({ ...i })) }; dirty = false;
  await sincronizar(data.requerimiento_id); render(); return true;
}
// Guarda la etapa calculada del proceso y el estado de la orden (solo el administrador puede escribirlos)
async function sincronizar(rid) {
  if (!esAdmin()) return;
  for (const o of ocsDe(rid)) { const e = estadoOC(o); if (e !== o.estado && !["borrador", "anulada"].includes(o.estado)) { const { data } = await sb.from("compras_ordenes").update({ estado: e }).eq("id", o.id).select().single(); if (data) { const i = ocs.findIndex((x) => x.id === o.id); ocs[i] = data; if (oc && oc.id === o.id) oc.estado = data.estado; } } }
  const r = reqs.find((x) => x.id === rid); if (!r) return; const et = etapaReq(r);
  if (et !== r.etapa && !(r.etapa === "comparativo" && et === "cotizacion")) { const { data } = await sb.from("compras_requerimientos").update({ etapa: et }).eq("id", rid).select().single(); if (data) { reqs[reqs.findIndex((x) => x.id === rid)] = data; } }
}
async function registrarRecepcion() {
  const o = oc, g = rec, lineas = [];
  if (!(g.recibido_por || "").trim()) return toast("Escribe quién recibe.");
  if (g.guia_clave && !/^\d{49}$/.test(g.guia_clave)) return toast("La clave de acceso de la guía tiene 49 dígitos.");
  for (const i of o.items) {
    const x = g.q[i.id] || {}, rc = num(x.rec), rj = num(x.rech), pend = r2(num(i.cantidad) - recibidoDe(i.id));
    if (rc > pend + 1e-9) return toast("De «" + i.descripcion + "» quedan " + qty(pend) + " por recibir.");
    if (rc > 0 || rj > 0 || (x.nota || "").trim()) lineas.push({ orden_item_id: i.id, cantidad_recibida: rc, cantidad_rechazada: rj, nota: (x.nota || "").trim() || null });
  }
  if (!lineas.some((l) => l.cantidad_recibida > 0 || l.cantidad_rechazada > 0)) return toast("Escribe las cantidades recibidas.");
  const { data: ge, error } = await sb.from("compras_entregas").insert({ orden_id: o.id, fecha: g.fecha || hoy(), recibido_por: g.recibido_por.trim(), guia_remision: (g.guia_remision || "").trim() || null, guia_clave: (g.guia_clave || "").trim() || null, transportista: (g.transportista || "").trim() || null, placa: (g.placa || "").trim().toUpperCase() || null, observaciones: (g.observaciones || "").trim() || null, origen: "app" }).select().single();
  if (error) return toast("No se pudo registrar: " + error.message);
  const { data: gi, error: e2 } = await sb.from("compras_entrega_items").insert(lineas.map((l) => ({ ...l, entrega_id: ge.id }))).select();
  if (e2) return toast("La recepción quedó sin cantidades: " + e2.message);
  ges.push(ge); geItems = geItems.concat(gi || []); rec = null;
  await sincronizar(o.requerimiento_id); render();
  toast((ge.numero || "Recepción") + " registrada · " + EST_OC[estadoOC(o)].toLowerCase());
}
async function guardarFactura() {
  const o = oc, f = fac;
  if (!(f.numero || "").trim()) return toast("Escribe el número de la factura.");
  if (f.clave_acceso && !/^\d{49}$/.test(f.clave_acceso)) return toast("La clave de acceso tiene 49 dígitos.");
  const sub = r2(num(f.subtotal)); if (!sub) return toast("Escribe el subtotal sin IVA.");
  const iva = r2(num(f.iva)), total = r2(num(f.total) || sub + iva);
  const { data, error } = await sb.from("compras_orden_facturas").insert({ orden_id: o.id, clave_acceso: (f.clave_acceso || "").trim() || null, numero: f.numero.trim(), fecha: f.fecha || hoy(), subtotal: sub, iva, total }).select().single();
  if (error) return toast(/duplicate|unique/i.test(error.message) ? "Esa factura ya está vinculada a otra orden." : "No se pudo guardar: " + error.message);
  facts.push(data);
  // gasto en Control de costos (sin IVA)
  const r = reqs.find((x) => x.id === o.requerimiento_id) || {}, p = provDe(o.proveedor_ruc);
  const g = { obra_id: o.obra_id, fecha: data.fecha, categoria: o.categoria || "materiales", proveedor: p.razon_social, documento: data.numero, descripcion: [o.numero, r.titulo].filter(Boolean).join(" · "), capitulo: o.capitulo || null, monto: sub, pagado: false, origen: "compra", orden_id: o.id };
  let { data: gs, error: e3 } = await sb.from("gastos").insert(g).select().single();
  if (e3 && /orden_id/.test(e3.message || "")) { delete g.orden_id; ({ data: gs, error: e3 } = await sb.from("gastos").insert(g).select().single()); }
  if (gs) { await sb.from("compras_orden_facturas").update({ gasto_id: gs.id }).eq("id", data.id); data.gasto_id = gs.id; }
  else conGastos = false;
  if (data.clave_acceso && sri && sri.some((x) => x.clave_acceso === data.clave_acceso)) await sb.from("facturas_proveedor").update({ obra_id: o.obra_id, asignada_por: (perfil && perfil.nombre) || user.email, asignada_en: new Date().toISOString() }).eq("clave_acceso", data.clave_acceso);
  fac = null;
  const e = estadoOC(o); if (e === "facturada") await sb.from("compras_ordenes").update({ estado: "facturada" }).eq("id", o.id).then(({ data: d }) => d);
  const k = ocs.findIndex((x) => x.id === o.id); if (e === "facturada") { ocs[k] = { ...ocs[k], estado: "facturada" }; oc.estado = "facturada"; }
  await sincronizar(o.requerimiento_id); render();
  toast("Factura " + data.numero + " registrada" + (gs ? " · gasto cargado a la obra" : ""));
}
async function guardarProv() {
  const p = prov;
  if (!rucOk(p.ruc) && !/^\d{10}$/.test(String(p.ruc || "").trim())) return toast("El RUC debe tener 13 dígitos y terminar en 001 (o una cédula de 10).");
  if (!(p.razon_social || "").trim()) return toast("Escribe la razón social.");
  const row = { ruc: p.ruc.trim(), razon_social: p.razon_social.trim(), nombre_comercial: p.nombre_comercial || null, categoria: p.categoria || null, contacto: p.contacto || null, telefono: p.telefono || null, email: p.email || null, obra_sugerida_id: p.obra_sugerida_id || null, notas: p.notas || null };
  const { data, error } = p._orig ? await sb.from("proveedores").update(row).eq("ruc", p.ruc).select().single() : await sb.from("proveedores").insert(row).select().single();
  if (error) return toast(/duplicate|unique/i.test(error.message) ? "Ya existe un proveedor con ese RUC." : "No se pudo guardar: " + error.message);
  const i = provs.findIndex((x) => x.ruc === data.ruc); if (i > -1) provs[i] = data; else provs.push(data);
  provs.sort((a, b) => a.razon_social.localeCompare(b.razon_social, "es"));
  prov = { ...data, _orig: true }; dirty = false; render(); toast("Proveedor guardado");
}
async function guardarProvNuevo() {
  const n = provNuevo, ruc = ($("#np_ruc").value || "").trim(), rs = ($("#np_rs").value || "").trim(), tel = ($("#np_tel").value || "").trim();
  if (!rucOk(ruc) && !/^\d{10}$/.test(ruc)) return toast("RUC de 13 dígitos terminado en 001.");
  if (!rs) return toast("Escribe la razón social.");
  const { data, error } = await sb.from("proveedores").insert({ ruc, razon_social: rs, telefono: tel || null }).select().single();
  if (error) return toast(/duplicate|unique/i.test(error.message) ? "Ese RUC ya está registrado." : "No se pudo guardar: " + error.message);
  provs.push(data); provs.sort((a, b) => a.razon_social.localeCompare(b.razon_social, "es"));
  if (n.para === "a_prov") aprob.proveedor_ruc = ruc; else if (n.para === "pf_prov") pf.proveedor_ruc = ruc; else if (n.para === "inv_prov") n.invitar = ruc;
  provNuevo = null; render(); const s = $("#" + n.para); if (s) s.value = ruc;
}

/* ---------- PDF ---------- */
function pdfBase(orient, titulo, sub, meta) {
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: orient }); { const _t = doc.text.bind(doc), _l = (s) => typeof s === "string" ? s.replace(/[−–]/g, "-").replace(/✓/g, "»").replace(/→/g, "->") : s; doc.text = (s, ...a) => _t(Array.isArray(s) ? s.map(_l) : _l(s), ...a); }
  const L = orient === "landscape", M = L ? 10 : 12, W = L ? 277 : 186, H = L ? 210 : 297, NAVY = [58, 61, 64], AMB = [169, 165, 157], GRID = [150, 150, 150], SUB = [232, 231, 227], LBL = [243, 242, 239];
  const fit = (x, w) => { x = String(x ?? ""); while (x && doc.getTextWidth(x) > w) x = x.slice(0, -2) + "…"; return x; };
  const P = { doc, M, W, H, NAVY, SUB, LBL, GRID, fit, pagina: 1, y: 0 };
  P.header = () => {
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.rect(M, M, W, 18); doc.line(M + 44, M, M + 44, M + 18); doc.line(M + W - 50, M, M + W - 50, M + 18);
    doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("DLV", M + 5, M + 9.5); doc.setFillColor(...AMB); doc.rect(M + 5, M + 10.8, 15, 1, "F");
    doc.setFontSize(6.2); doc.text("CONSTRUCCIONES CÍA. LTDA.", M + 5, M + 14.6);
    doc.setFontSize(12.5); doc.text(titulo, M + 44 + (W - 94) / 2, M + 8.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85, 85, 85); doc.text(fit(sub, W - 100), M + 44 + (W - 94) / 2, M + 13.2, { align: "center" });
    meta.concat([["PÁGINA", String(P.pagina)]]).slice(0, 3).forEach(([k, v], i) => { const x = M + W - 50, yy = M + i * 6; if (i) doc.line(x, yy, M + W, yy); doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4); doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(fit(v, 30), M + W - 1.5, yy + 4, { align: "right" }); });
    doc.setFontSize(5.6); doc.setTextColor(120, 120, 120); doc.text("DLV Construcciones Cía. Ltda. · Av. Primero de Mayo y Av. de las Américas, Cuenca", M, H - 7);
    P.y = M + 22; return P.y;
  };
  P.nueva = () => { doc.addPage("a4", orient); P.pagina++; return P.header(); };
  P.datos = (pares) => { doc.setFontSize(7); pares.forEach(([k, v], i) => { const x = M + (i % 2) * (W / 2), yy = P.y + Math.floor(i / 2) * 6; doc.setFillColor(...LBL); doc.rect(x, yy, 30, 6, "F"); doc.setDrawColor(...GRID); doc.rect(x, yy, W / 2, 6); doc.setFont("helvetica", "bold"); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4); doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(fit(v || "—", W / 2 - 34), x + 32, yy + 4); }); P.y += Math.ceil(pares.length / 2) * 6 + 4; };
  P.tabla = (cols, filas, opt = {}) => {
    const head = () => { let x = M; doc.setFillColor(...NAVY); doc.rect(M, P.y, W, 6, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(255, 255, 255); for (const [h, w, al] of cols) { doc.text(h, al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, P.y + 4, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; } P.y += 6; };
    head();
    for (const fr of filas) {
      const f = Array.isArray(fr) ? { vals: fr } : fr, vals = f.vals, h = 5.4; // ojo: un arreglo tiene .fill, por eso se envuelve
      if (P.y + h > H - 12) { P.nueva(); head(); }
      if (f.fill) { doc.setFillColor(...f.fill); doc.rect(M, P.y, W, h, "F"); }
      doc.setDrawColor(210, 210, 210); doc.line(M, P.y + h, M + W, P.y + h);
      let x = M; doc.setFont("helvetica", f.bold ? "bold" : "normal"); doc.setFontSize(opt.size || 6.8);
      cols.forEach(([, w, al], i) => { const v = vals[i]; doc.setTextColor(...((f.color && f.color[i]) || [30, 30, 30])); if (v != null && v !== "") doc.text(fit(v, w - 2.4), al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, P.y + 3.7, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; });
      P.y += h;
    }
    P.y += 3;
  };
  P.texto = (t) => { if (!t) return; doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(60, 60, 60); const ls = doc.splitTextToSize(t, W); if (P.y + ls.length * 3.4 > H - 12) P.nueva(); doc.text(ls, M, P.y + 2); P.y += ls.length * 3.4 + 3; };
  P.firmas = (lista) => { const fw = (W - 8 * (lista.length - 1)) / lista.length; if (P.y + 30 > H - 10) P.nueva(); const y = Math.max(P.y + 4, H - 48); lista.forEach(([t, n], i) => { const x = M + i * (fw + 8); doc.setFillColor(...NAVY); doc.rect(x, y, fw, 4.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.2); doc.setTextColor(255, 255, 255); doc.text(t, x + fw / 2, y + 3.1, { align: "center" }); doc.setDrawColor(...GRID); doc.rect(x, y + 4.5, fw, 22); doc.setFont("helvetica", "normal"); doc.setFontSize(6.4); doc.setTextColor(60, 60, 60); doc.text(fit(n || "Nombre / firma", fw - 4), x + 2, y + 24.5); }); };
  P.guardar = (name) => { const blob = doc.output("blob"), file = new File([blob], name, { type: "application/pdf" }); if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch((e) => { if (e.name !== "AbortError") doc.save(name); }); else doc.save(name); };
  P.header();
  return P;
}
const limpia = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "");
function pdfOC() {
  const o = oc, p = provDe(o.proveedor_ruc), t = calcOC(o.items, o.iva_pct), ob = obra(o.obra_id), r = reqs.find((x) => x.id === o.requerimiento_id) || {};
  const P = pdfBase("portrait", "ORDEN DE PEDIDO", ob.nombre || "", [["N.°", o.numero || "BORRADOR"], ["FECHA", fmtF(o.fecha)]]);
  P.datos([["PROVEEDOR", p.razon_social], ["RUC", p.ruc], ["CONTACTO", [p.contacto, p.telefono].filter(Boolean).join(" · ")], ["CORREO", p.email], ["OBRA", ob.nombre], ["PROCESO", [r.numero, r.titulo].filter(Boolean).join(" · ")], ["ENTREGA", fmtF(o.fecha_entrega) || "A coordinar"], ["LUGAR", o.lugar_entrega || "Obra " + (ob.nombre || "")], ["FORMA DE PAGO", o.forma_pago], ["ESTADO", EST_OC[estadoOC(o)]]]);
  P.tabla([["N.°", 9, "c"], ["DESCRIPCIÓN", 95, "l"], ["UND", 14, "c"], ["CANTIDAD", 20, "r"], ["P. UNIT.", 22, "r"], ["TOTAL", 26, "r"]],
    o.items.map((i, k) => [String(k + 1), i.descripcion, i.unidad, qty(num(i.cantidad)), pu4(num(i.precio_unitario)), money(num(i.cantidad) * num(i.precio_unitario))])
      .concat([{ vals: ["", "", "", "", "SUBTOTAL", money(t.subtotal)], bold: true }, { vals: ["", "", "", "", "IVA " + String(num(o.iva_pct)).replace(".", ",") + " %", money(t.iva)] }, { vals: ["", "", "", "", "TOTAL", money(t.total)], bold: true, fill: P.SUB }]));
  P.texto("Condiciones: entregar el material con guía de remisión en el lugar indicado. La factura electrónica se emite a nombre de DLV Construcciones Cía. Ltda. citando el número de esta orden. Las cantidades se pagan según lo recibido conforme en obra." + (r.justificacion ? " Adjudicación: " + r.justificacion : ""));
  P.firmas([["ELABORADO", (perfil && perfil.nombre) || ""], ["APROBADO · DLV", o.emitida_por || ""], ["ACEPTADO · PROVEEDOR", p.razon_social]]);
  P.guardar((o.numero || "Orden borrador") + " " + limpia(p.razon_social) + ".pdf");
}
function pdfComparativo() {
  const r = req, { ps, filas } = matrizComparativo(r), ob = obra();
  const P = pdfBase("landscape", "CUADRO COMPARATIVO DE PROFORMAS", (ob.nombre || "") + " · " + r.titulo, [["PROCESO", r.numero || ""], ["FECHA", fmtF(hoy())]]);
  const wItem = 277 - ps.length * 34 - 26, cols = [["ÍTEM", wItem, "l"], ["CANT.", 26, "r"]].concat(ps.map((p) => [P.fit(provDe(p.proveedor_ruc).razon_social.toUpperCase(), 32), 34, "r"]));
  const sel = adj ? adj.sel : {};
  P.tabla(cols, filas.map((f) => ({ vals: [f.it.descripcion, qty(num(f.it.cantidad)) + " " + f.it.unidad].concat(f.celdas.map((c) => c ? pu4(c.pu) + (sel[f.it.id] === c.x.id ? "  «" : "") + (c.x.cumple === false ? " (NC)" : "") : "—")),
    color: Object.fromEntries(f.celdas.map((c, i) => [i + 2, c && c.pu === f.min && c.x.cumple !== false ? [60, 110, 78] : [30, 30, 30]])) }))
    .concat([{ vals: ["SUBTOTAL SIN IVA", ""].concat(ps.map((p) => money(totalProf(p, r).subtotal))), bold: true }, { vals: ["TOTAL CON IVA", ""].concat(ps.map((p) => money(totalProf(p, r).total))), bold: true, fill: P.SUB },
      { vals: ["PLAZO DE ENTREGA", ""].concat(ps.map((p) => p.plazo_entrega_dias ? p.plazo_entrega_dias + " días" : "—")) }, { vals: ["FORMA DE PAGO", ""].concat(ps.map((p) => p.forma_pago || "—")) }, { vals: ["TRANSPORTE", ""].concat(ps.map((p) => p.transporte_incluido ? "Incluido" : "No incluido")) }]), { size: 6.4 });
  P.texto("En verde el menor precio por ítem entre las ofertas que cumplen; « = adjudicado; NC = no cumple especificación." + ((adj && adj.just) || r.justificacion ? " Justificación: " + ((adj && adj.just) || r.justificacion) : ""));
  P.firmas([["ELABORADO", (perfil && perfil.nombre) || ""], ["REVISADO", ""], ["APROBADO · GERENCIA", ""]]);
  P.guardar("Comparativo " + (r.numero || "") + " " + limpia(r.titulo) + ".pdf");
}
function pdfGE(gid) {
  const g = ges.find((x) => x.id === gid), o = oc, p = provDe(o.proveedor_ruc), ob = obra(o.obra_id), gi = geItems.filter((x) => x.entrega_id === gid);
  const P = pdfBase("portrait", "ACTA DE RECEPCIÓN DE MATERIALES", ob.nombre || "", [["N.°", g.numero || ""], ["FECHA", fmtF(g.fecha)]]);
  P.datos([["ORDEN", o.numero], ["PROVEEDOR", p.razon_social], ["GUÍA REMISIÓN", g.guia_remision], ["TRANSPORTISTA", [g.transportista, g.placa].filter(Boolean).join(" · ")], ["RECIBIDO POR", g.recibido_por], ["OBRA", ob.nombre]]);
  if (g.guia_clave) P.texto("Clave de acceso de la guía: " + g.guia_clave);
  P.tabla([["DESCRIPCIÓN", 92, "l"], ["UND", 14, "c"], ["PEDIDO", 20, "r"], ["RECIBIDO", 20, "r"], ["RECHAZADO", 20, "r"], ["NOTA", 20, "l"]],
    gi.map((x) => { const i = ocItems.find((y) => y.id === x.orden_item_id) || {}; return { vals: [i.descripcion, i.unidad, qty(num(i.cantidad)), qty(num(x.cantidad_recibida)), num(x.cantidad_rechazada) ? qty(num(x.cantidad_rechazada)) : "", x.nota || ""], color: { 4: [160, 70, 62] } }; }));
  P.texto(g.observaciones ? "Observaciones: " + g.observaciones : "");
  P.firmas([["RECIBE · DLV", g.recibido_por], ["ENTREGA · TRANSPORTISTA", g.transportista || ""]]);
  P.guardar((g.numero || "Recepcion") + " " + (o.numero || "") + ".pdf");
}

/* ---------- eventos ---------- */
function refrescarAprob() {
  const r = req, a = aprob; for (const it of r.items) { const el = document.getElementById("ap_" + it.id); if (el) el.textContent = money(num(it.cantidad) * num(a.precios[it.id])); }
  const sub = r2(r.items.reduce((t, it) => t + num(it.cantidad) * num(a.precios[it.id]), 0)); $("#apSum").innerHTML = totHtml(sub, r2(sub * num(a.iva_pct) / 100));
}
document.addEventListener("input", (e) => {
  const t = e.target;
  if (view === "req" && req) {
    if (t.dataset.r) { req[t.dataset.r] = t.value; setDirty(true); return; }
    if (t.dataset.i != null && t.dataset.k) { req.items[+t.dataset.i][t.dataset.k] = t.value; setDirty(true); return; }
    if (t.dataset.a && aprob) { aprob[t.dataset.a] = t.value; if (t.dataset.a === "iva_pct") refrescarAprob(); return; }
    if (t.dataset.ap && aprob) { aprob.precios[t.dataset.ap] = t.value; refrescarAprob(); return; }
    if (t.dataset.pf2 && pf) { pf[t.dataset.pf2] = t.value; return; }
    if (t.dataset.pp && pf) { (pf.precios[t.dataset.pp] = pf.precios[t.dataset.pp] || {})[t.dataset.k === "precio" ? "precio" : "marca"] = t.value; return; }
    if (t.id === "adjJust" && adj) { adj.just = t.value; return; }
  }
  if (view === "oc" && oc) {
    if (t.dataset.o) { oc[t.dataset.o] = t.value; setDirty(true); if (t.dataset.o === "iva_pct") { const x = calcOC(oc.items, oc.iva_pct); $("#ocSum").innerHTML = totHtml(x.subtotal, x.iva); } return; }
    if (t.dataset.oi != null) { const i = oc.items[+t.dataset.oi]; i[t.dataset.k] = t.value; setDirty(true); $("#oi_" + t.dataset.oi).textContent = money(num(i.cantidad) * num(i.precio_unitario)); const x = calcOC(oc.items, oc.iva_pct); $("#ocSum").innerHTML = totHtml(x.subtotal, x.iva); return; }
    if (t.dataset.g && rec) { rec[t.dataset.g] = t.value; return; }
    if (t.dataset.gq && rec) { (rec.q[t.dataset.gq] = rec.q[t.dataset.gq] || {})[t.dataset.k] = t.value; return; }
    if (t.dataset.f && fac) { fac[t.dataset.f] = t.value; if (t.dataset.f === "subtotal") { const s = num(t.value), iv = r2(s * num(oc.iva_pct) / 100); fac.iva = iv; fac.total = r2(s + iv); const a = document.querySelector('[data-f="iva"]'), b = document.querySelector('[data-f="total"]'); if (a) a.value = dec(iv); if (b) b.value = dec(fac.total); } return; }
  }
  if (view === "prov" && prov && t.dataset.pv) { prov[t.dataset.pv] = t.value; setDirty(true); }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "obraSel") { if (dirty) { t.value = obraId; return toast("Guarda primero los cambios."); } obraId = t.value; try { localStorage.setItem("dlv-obra", obraId); } catch (_) {} view = "lista"; req = oc = null; cargarObra(); return; }
  if (["a_prov", "pf_prov", "inv_prov"].includes(t.id)) {
    if (t.value === "__nuevo") { provNuevo = { para: t.id, ruc: "", razon_social: "", telefono: "" }; render(); const x = $("#np_ruc"); if (x) x.focus(); return; }
    if (t.id === "a_prov") aprob.proveedor_ruc = t.value; else if (t.id === "pf_prov") pf.proveedor_ruc = t.value;
    return;
  }
  if (t.id === "r_urg" && req) { req.urgente = t.checked; setDirty(true); return; }
  if (t.id === "pf_transp" && pf) { pf.transporte_incluido = t.checked; return; }
  if (t.dataset.ppc && pf) { (pf.precios[t.dataset.ppc] = pf.precios[t.dataset.ppc] || {}).cumple = t.checked; return; }
  if (t.dataset.adj && adj) { adj.sel[t.dataset.adj] = t.value; const y = window.scrollY; render(); window.scrollTo(0, y); return; }
  if (t.tagName === "SELECT" && t.dataset.a && aprob) { aprob[t.dataset.a] = t.value; return; }
  if (t.tagName === "SELECT" && t.dataset.o && oc) { oc[t.dataset.o] = t.value; setDirty(true); return; }
  if (t.tagName === "SELECT" && t.dataset.pv && prov) { prov[t.dataset.pv] = t.value; setDirty(true); return; }
  if (t.id === "f_sri" && fac) { const x = (sri || []).find((y) => y.clave_acceso === t.value); if (x) Object.assign(fac, { clave_acceso: x.clave_acceso, numero: x.numero, fecha: x.fecha_emision, subtotal: num(x.subtotal), iva: num(x.iva), total: num(x.total) }); else fac.clave_acceso = ""; render(); return; }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
  if (b.dataset.foc) { fOC = b.dataset.foc; render(); return; }
  if (b.dataset.req) return abrirReq(reqs.find((x) => x.id === b.dataset.req));
  if (b.dataset.oc) return abrirOC(ocs.find((x) => x.id === b.dataset.oc), view === "req" ? "req" : "lista");
  if (b.dataset.prov) { prov = { ...provs.find((x) => x.ruc === b.dataset.prov), _orig: true }; view = "prov"; dirty = false; render(); window.scrollTo(0, 0); return; }
  if (b.dataset.delit && req) { req.items.splice(+b.dataset.delit, 1); setDirty(true); render(); return; }
  if (b.dataset.pf) { const p = profs.find((x) => x.id === b.dataset.pf); pf = { ...p, precios: Object.fromEntries(pitems.filter((x) => x.proforma_id === p.id).map((x) => [x.req_item_id, { precio: num(x.precio_unitario), marca: x.marca || "", cumple: x.cumple }])) }; render(); return; }
  if (b.dataset.todo && adj) { for (const it of req.items) { const x = pitems.find((y) => y.proforma_id === b.dataset.todo && y.req_item_id === it.id); if (x) adj.sel[it.id] = x.id; } render(); return; }
  if (b.dataset.delinv) { const { error } = await sb.from("compras_invitados").delete().eq("id", b.dataset.delinv); if (!error) invit = invit.filter((x) => x.id !== b.dataset.delinv); render(); return; }
  if (b.dataset.gepdf) { try { pdfGE(b.dataset.gepdf); } catch (err) { console.error(err); toast("No se pudo generar el PDF."); } return; }
  const a = b.dataset.act;
  if (a === "nuevoPD") return abrirReq(null, "directo");
  if (a === "nuevoSC") return abrirReq(null, "cotizacion");
  if (a === "nuevoProv") { prov = { ruc: "", razon_social: "" }; view = "prov"; dirty = true; render(); return; }
  if (a === "addIt") { req.items.push({ id: uid(), descripcion: "", unidad: "u", cantidad: "", especificacion: "" }); setDirty(true); render(); const ins = document.querySelectorAll('[data-k="descripcion"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
  if (a === "verPegar") { pegar = ""; render(); return; }
  if (a === "pegarNo") { pegar = false; render(); return; }
  if (a === "pegarOk") {
    const txt = $("#pegarTxt").value, modo = formatoNumeros(txt); let n = 0;
    req.items = req.items.filter((i) => (i.descripcion || "").trim());
    for (const raw of txt.split(/\r?\n/)) { const c = raw.split("\t").map((x) => x.trim()); if (c.length < 3 || !c[0]) continue; const cant = numCon(c[2], modo); if (!(cant > 0)) continue; req.items.push({ id: uid(), descripcion: c[0], unidad: c[1] || "u", cantidad: cant, especificacion: c[3] || "" }); n++; }
    pegar = false; setDirty(true); render(); toast(n ? n + " ítems agregados" : "No encontré filas con descripción, unidad y cantidad."); return;
  }
  if (a === "aprobar") { const pre = {}; let ruc = req.proveedor_sugerido || ""; for (const it of req.items) { const u = ultimoPrecio(it.descripcion, it.unidad); if (u) { pre[it.id] = num(u.precio_unitario); ruc = ruc || u.ruc; } } aprob = { proveedor_ruc: ruc, fecha_entrega: req.fecha_limite || masDias(2), forma_pago: "", iva_pct: 15, categoria: "materiales", capitulo: "", precios: pre }; render(); return; }
  if (a === "aprobNo") { aprob = null; provNuevo = null; render(); return; }
  if (a === "aprobOk") { b.disabled = true; try { await aprobar(); } finally { b.disabled = false; } return; }
  if (a === "aCotizar") { const d = await setEtapa(req, "cotizacion", { tipo: "cotizacion" }); if (d) { render(); toast("Pasó a cotización: invita a los proveedores"); } return; }
  if (a === "rechazar") { confirm = "rech"; render(); return; }
  if (a === "rechOk") { const mot = ($("#motivo").value || "").trim(); if (!mot) return toast("Escribe el motivo."); const d = await setEtapa(req, "rechazado", { motivo_rechazo: mot }); if (d) { confirm = null; render(); toast("Pedido rechazado"); } return; }
  if (a === "noConf") { confirm = null; render(); return; }
  if (a === "invitar") { const ruc = $("#inv_prov").value; if (!ruc || ruc === "__nuevo") return toast("Elige un proveedor."); if (invit.some((x) => x.requerimiento_id === req.id && x.proveedor_ruc === ruc)) return toast("Ya está invitado."); const { data, error } = await sb.from("compras_invitados").insert({ requerimiento_id: req.id, proveedor_ruc: ruc }).select().single(); if (error) return toast("No se pudo invitar: " + error.message); invit.push(data); render(); return; }
  if (a === "nuevaPf") { pf = { proveedor_ruc: "", fecha: hoy(), numero_proforma: "", validez_dias: 15, plazo_entrega_dias: "", forma_pago: "", transporte_incluido: true, iva_pct: 15, observaciones: "", precios: {} }; render(); return; }
  if (a === "pfNo") { pf = null; provNuevo = null; render(); return; }
  if (a === "pfOk") { b.disabled = true; try { await guardarProforma(); } finally { b.disabled = false; } return; }
  if (a === "pfDel") { const { error } = await sb.from("compras_proformas").delete().eq("id", pf.id); if (error) return toast("No se pudo borrar."); profs = profs.filter((x) => x.id !== pf.id); pitems = pitems.filter((x) => x.proforma_id !== pf.id); pf = null; adj = null; render(); toast("Proforma borrada"); return; }
  if (a === "pegarPrecios") { pf._pegar = true; render(); const x = $("#ppTxt"); if (x) x.focus(); return; }
  if (a === "ppNo") { pf._pegar = false; render(); return; }
  if (a === "ppOk") {
    const txt = $("#ppTxt").value; pf._pegar = false;
    const modo = formatoNumeros(txt), vals = txt.split(/\r?\n/).map((x) => x.split("\t").pop().trim()).filter((x) => x !== "");
    req.items.forEach((it, k) => { if (vals[k] != null) (pf.precios[it.id] = pf.precios[it.id] || {}).precio = numCon(vals[k], modo); }); render(); return;
  }
  if (a === "adjudicar") { b.disabled = true; try { await adjudicar(); } finally { b.disabled = false; } return; }
  if (a === "npOk") return guardarProvNuevo();
  if (a === "npNo") { const para = provNuevo && provNuevo.para; provNuevo = null; render(); const s = para && $("#" + para); if (s) s.value = ""; return; }
  if (a === "delR") { confirm = "delR"; render(); return; }
  if (a === "delROk") { const { error } = await sb.from("compras_requerimientos").delete().eq("id", req.id); if (error) return toast("No se pudo borrar: " + error.message); reqs = reqs.filter((x) => x.id !== req.id); items = items.filter((x) => x.requerimiento_id !== req.id); view = "lista"; req = null; dirty = false; render(); toast("Proceso borrado"); return; }
  if (a === "emitir") { if (!(await guardarOC({ estado: "emitida", emitida_por: (perfil && perfil.nombre) || user.email, emitida_en: new Date().toISOString() }))) return; toast("Orden " + (oc.numero || "") + " emitida"); return; }
  if (a === "anular") { confirm = "anular"; render(); return; }
  if (a === "anularOk") { const { data, error } = await sb.from("compras_ordenes").update({ estado: "anulada" }).eq("id", oc.id).select().single(); if (error) return toast("No se pudo anular."); ocs[ocs.findIndex((x) => x.id === data.id)] = data; oc.estado = "anulada"; confirm = null; await sincronizar(data.requerimiento_id); render(); toast("Orden anulada"); return; }
  if (a === "recibir") { const pend = {}; for (const i of oc.items) { const p = r2(num(i.cantidad) - recibidoDe(i.id)); if (p > 0) pend[i.id] = { rec: p, rech: "", nota: "" }; } rec = { fecha: hoy(), recibido_por: (perfil && perfil.nombre) || "", guia_remision: "", guia_clave: "", transportista: "", placa: "", observaciones: "", q: pend }; render(); return; }
  if (a === "recNo") { rec = null; render(); return; }
  if (a === "recOk") { b.disabled = true; try { await registrarRecepcion(); } finally { b.disabled = false; } return; }
  if (a === "facturar") { const vr = valorRecibido(oc) - factsDe(oc.id).reduce((t, f) => t + num(f.subtotal), 0), iv = r2(vr * num(oc.iva_pct) / 100); fac = { numero: "", fecha: hoy(), clave_acceso: "", subtotal: r2(vr), iva: iv, total: r2(vr + iv) }; render(); return; }
  if (a === "facNo") { fac = null; render(); return; }
  if (a === "facOk") { b.disabled = true; try { await guardarFactura(); } finally { b.disabled = false; } return; }
  if (b.id === "btnGuardar") return view === "req" ? guardarReq() : view === "oc" ? guardarOC().then((ok) => ok && toast("Orden guardada")) : guardarProv();
  if (b.id === "btnPDF") { try { view === "oc" ? pdfOC() : pdfComparativo(); } catch (err) { console.error(err); toast("No se pudo generar el PDF."); } return; }
  if (b.id === "btnVolver") {
    if (dirty && !b.dataset.sure) { b.dataset.sure = "1"; const prev = b.textContent; b.textContent = "¿Salir sin guardar?"; setTimeout(() => { if (b.dataset.sure) { b.dataset.sure = ""; b.textContent = prev; } }, 3000); return; }
    b.dataset.sure = ""; dirty = false;
    if (view === "oc" && volverA === "req") { const r = reqs.find((x) => x.id === oc.requerimiento_id); oc = null; if (r) return abrirReq(r); }
    if (view === "prov") tab = "proveedores";
    view = "lista"; req = oc = prov = null; aprob = pf = adj = rec = fac = provNuevo = null; render(); window.scrollTo(0, 0);
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
  const { data: pfl } = await sb.from("perfiles").select("*").eq("id", user.id).maybeSingle();
  perfil = pfl || { rol: "residente" }; $("#quien").textContent = perfil.nombre || user.email;
  const { data } = await sb.from("obras").select("*").eq("activa", true).order("nombre");
  obras = data || [];
  let saved = ""; try { saved = localStorage.getItem("dlv-obra") || ""; } catch (_) {}
  const qs = new URLSearchParams(location.search), want = qs.get("obra") || saved;
  obraId = (obras.find((o) => o.id === want) || obras[0] || {}).id || "";
  if (["procesos", "ordenes", "proveedores"].includes(qs.get("tab"))) tab = qs.get("tab");
  $("#obraSel").innerHTML = obras.length ? obras.map((o) => `<option value="${esc(o.id)}"${o.id === obraId ? " selected" : ""}>${esc(o.nombre)}</option>`).join("") : `<option value="">Sin obras asignadas</option>`;
  await cargarGlobal();
  await cargarObra();
})();
})();
