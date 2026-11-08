// DLV Plataforma — Control de costos por obra: gastos reales (manual o pegados desde Excel), subcontratos tomados de sus planillas,
// presupuesto meta por categoría, margen a la fecha y proyectado, flujo de caja aproximado e informe en PDF.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hoy = () => ymd(new Date());
const fmtF = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").trim().replace(/[$\s]/g, ""); if (!s) return 0;
  const c = s.lastIndexOf(","), d = s.lastIndexOf(".");
  if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (c > -1) s = s.match(/,/g).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (d > -1 && (s.match(/\./g).length > 1 || /^-?\d{1,3}(\.\d{3})+$/.test(s))) s = s.replace(/\./g, ""); // 3.096 = tres mil noventa y seis (formato es-EC)
  const n = parseFloat(s); return isFinite(n) ? n : 0;
}
function formatoNumeros(txt) {
  let coma = 0, punto = 0;
  for (const cel of txt.split(/[\t\r\n]+/)) {
    const v = cel.trim();
    if (/^-?[\d.]*,\d{1,2}$/.test(v) || /^-?\d{1,3}(\.\d{3})+,\d+$/.test(v)) coma++;
    else if (/^-?[\d,]*\.\d{1,2}$/.test(v) || /^-?\d{1,3}(,\d{3})+\.\d+$/.test(v)) punto++;
  }
  return coma > punto ? "coma" : punto > coma ? "punto" : "";
}
const numCon = (v, modo) => { const s = String(v ?? "").trim().replace(/[$\s]/g, ""); return modo === "coma" ? num(s.replace(/\./g, "").replace(",", ".")) : modo === "punto" ? num(s.replace(/,/g, "")) : num(s); };
const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => "$ " + (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyK = (n) => Math.abs(n) >= 100000 ? "$ " + (n / 1000).toLocaleString("es-EC", { maximumFractionDigits: 0 }) + " mil" : money(n);
const pct = (n, dec = 1) => n == null || !isFinite(n) ? "—" : n.toLocaleString("es-EC", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " %";
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3600); }

const CATS = { materiales: "Materiales", mano_obra: "Mano de obra", subcontratos: "Subcontratos", equipos: "Equipos y transporte", indirectos: "Indirectos de obra", otros: "Otros" };
const CATS_GASTO = ["materiales", "mano_obra", "equipos", "indirectos", "otros"]; // los subcontratos salen de sus planillas
const REPARTO = { materiales: 0.55, mano_obra: 0.25, subcontratos: 0.12, equipos: 0.06, otros: 0.02 }; // reparto inicial sugerido del costo directo
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesTxt = (k) => { const [y, m] = k.split("-"); return MESES[+m - 1] + " " + y.slice(2); };
function adivinaCat(txt) {
  const s = String(txt || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/mano|jornal|rol\b|roles|sueldo|salario|iess|obrer|maestro|albanil|peon|quincena|liquidacion/.test(s)) return "mano_obra";
  if (/equipo|alquiler|maquin|volquet|retro|excavad|grua|combustible|diesel|gasolina|transporte|flete|andamio|concretera|vibrador/.test(s)) return "equipos";
  if (/indirect|administ|oficina|guardia|seguridad|vigilan|seguro|poliza|garantia|servicio|luz|agua|internet|telefon|permiso|tasa|tramite|campamento|movilizacion|residente/.test(s)) return "indirectos";
  if (/material|cemento|hierro|acero|varilla|arena|ripio|piedra|bloque|ladrillo|ferret|hormigon|madera|tubo|tuberia|pintura|ceramic|porcelanato|cable|electric|sanitari|vidrio|alumin|perfil|malla|clavo|alambre|aditivo|impermeab|yeso|gypsum|cubierta|teja/.test(s)) return "materiales";
  return "";
}
function fechaDe(v) {
  const s = String(v || "").trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; if (+m[2] > 12) return null; return y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); }
  if (/^\d{5}$/.test(s) && +s > 30000 && +s < 70000) { const d = new Date(Date.UTC(1899, 11, 30) + +s * 86400000); return d.toISOString().slice(0, 10); } // número de serie de Excel
  return null;
}

let sb = null, user = null, perfil = null, obras = [], obraId = "";
let rubros = [], planillas = [], subs = [], subPls = [], gastos = [], roles = [], ocsC = [], factsC = [], meta = null, sinTablas = false;
const rolesOk = () => roles.filter((r) => r.estado === "aprobado" || r.estado === "pagado");
let view = "lista", tab = "resumen", gasto = null, metaEd = null, dirty = false, confirm = null, pegar = false;
let fCat = "", fMes = "", fBus = "", fPend = false;
const esAdmin = () => perfil && perfil.rol === "admin";
const obra = () => obras.find((o) => o.id === obraId) || {};
const puedeEditar = (g) => esAdmin() || !g.id || g.creado_por === user.id;

/* ---------- cálculo ---------- */
const montoSc = (s) => num(s.monto) || (s.items || []).reduce((t, it) => t + num(it.cantidad) * num(it.precio), 0);
const metaTotal = (mt) => mt ? Object.keys(CATS).reduce((t, k) => t + num(mt[k]), 0) : 0;
function sugerida() {
  const venta = rubros.reduce((t, r) => t + num(r.cantidad) * num(r.precio), 0);
  const conCosto = rubros.some((r) => num(r.costo) > 0);
  const directo = conCosto ? rubros.reduce((t, r) => t + num(r.cantidad) * num(r.costo), 0) : venta / 1.298; // 18 % indirectos y 10 % utilidad
  const s = { indirectos: r2(directo * 0.18) };
  for (const [k, f] of Object.entries(REPARTO)) s[k] = r2(directo * f);
  return { meta: s, conCosto, directo };
}
function calc() {
  const venta = rubros.reduce((t, r) => t + num(r.cantidad) * num(r.precio), 0);
  const pls = planillas.filter((p) => p.estado !== "borrador").sort((a, b) => a.numero - b.numero), ult = pls[pls.length - 1];
  const ventaT = venta || (ult && ult.totales ? num(ult.totales.total) : 0);
  const planillado = ult && ult.totales && ult.totales.acumulado != null ? num(ult.totales.acumulado) : pls.reduce((t, p) => t + num((p.totales || {}).bruto), 0);
  const cobrado = pls.filter((p) => p.estado === "pagada").reduce((t, p) => t + num((p.totales || {}).bruto), 0);
  const real = {}; for (const k of Object.keys(CATS)) real[k] = 0;
  for (const g of gastos) real[CATS[g.categoria] ? g.categoria : "otros"] += num(g.monto);
  const splOk = subPls.filter((p) => p.estado === "aprobada" || p.estado === "pagada");
  real.subcontratos = splOk.reduce((t, p) => t + num((p.totales || {}).bruto), 0);
  real.mano_obra += rolesOk().reduce((t, r) => t + num((r.totales || {}).costo), 0); // roles de pago del módulo Personal
  const costo = Object.values(real).reduce((a, b) => a + b, 0);
  const subsVig = subs.filter((s) => s.estado !== "anulado" && s.estado !== "borrador");
  const comprometido = Math.max(0, subsVig.reduce((t, s) => t + montoSc(s), 0) - real.subcontratos);
  // órdenes de compra emitidas que aún no se facturan (la factura ya entra como gasto)
  const compras = ocsC.filter((o) => !["borrador", "anulada"].includes(o.estado)).reduce((t, o) => t + Math.max(0, num(o.subtotal) - factsC.filter((f) => f.orden_id === o.id).reduce((a, f) => a + num(f.subtotal), 0)), 0);
  const avance = ventaT > 0 ? Math.min(1, planillado / ventaT) : 0;
  const mt = meta && metaTotal(meta) > 0 ? meta : null, mTot = metaTotal(mt);
  const eac = avance >= 0.05 ? costo / avance : mTot || null; // con menos de 5 % planillado la proyección no es confiable: se usa la meta
  const rolCaja = (r) => { const t = r.totales || {}; return num(t.liquido) + num(t.anticipos) + num(t.desc) + num(t.iess) + num(t.patronal); }; // sueldos + aportes al IESS (las provisiones se pagan después)
  const pagado = gastos.filter((g) => g.pagado).reduce((t, g) => t + num(g.monto), 0) + subPls.filter((p) => p.estado === "pagada").reduce((t, p) => t + num((p.totales || {}).bruto), 0) + roles.filter((r) => r.estado === "pagado").reduce((t, r) => t + rolCaja(r), 0);
  const porPagar = gastos.filter((g) => !g.pagado).reduce((t, g) => t + num(g.monto), 0) + subPls.filter((p) => p.estado === "aprobada").reduce((t, p) => t + num((p.totales || {}).bruto), 0) + roles.filter((r) => r.estado === "aprobado").reduce((t, r) => t + rolCaja(r), 0);
  const cats = Object.keys(CATS).map((k) => {
    const m = mt ? num(mt[k]) : 0, ganado = m * avance, v = real[k];
    const sem = !mt || !m ? (v > 0 && mt ? "mal" : "") : v > ganado * 1.05 + 1 ? "mal" : v > ganado + 1 ? "aviso" : "ok";
    return { k, nombre: CATS[k], meta: m, ganado, real: v, consumo: m ? v / m * 100 : null, sem };
  });
  return {
    venta: ventaT, planillado, cobrado, costo, real, cats, comprometido, compras, avance, meta: mt, metaTotal: mTot, eac,
    margen: planillado - costo, margenPct: planillado > 0 ? (planillado - costo) / planillado * 100 : null,
    margenProy: eac != null ? ventaT - eac : null, margenProyPct: eac != null && ventaT > 0 ? (ventaT - eac) / ventaT * 100 : null,
    margenMeta: mt ? ventaT - mTot : null, margenMetaPct: mt && ventaT > 0 ? (ventaT - mTot) / ventaT * 100 : null,
    pagado, porPagar, caja: cobrado - pagado, nPls: pls.length
  };
}
function porMes() {
  const M = {};
  const add = (f, k, v) => { if (!f) return; const key = String(f).slice(0, 7); (M[key] = M[key] || { costo: 0, venta: 0 })[k] += v; };
  for (const g of gastos) add(g.fecha, "costo", num(g.monto));
  for (const p of subPls) if (p.estado === "aprobada" || p.estado === "pagada") add(p.fecha, "costo", num((p.totales || {}).bruto));
  for (const r of rolesOk()) add(r.hasta, "costo", num((r.totales || {}).costo));
  for (const p of planillas) if (p.estado !== "borrador") add(p.fecha, "venta", num((p.totales || {}).bruto));
  const keys = Object.keys(M).sort();
  if (!keys.length) return [];
  const out = []; let [y, m] = keys[0].split("-").map(Number); const last = keys[keys.length - 1];
  for (let i = 0; i < 60; i++) { const k = y + "-" + String(m).padStart(2, "0"); out.push({ k, ...(M[k] || { costo: 0, venta: 0 }) }); if (k >= last) break; m++; if (m > 12) { m = 1; y++; } }
  return out.slice(-12);
}

/* ---------- datos ---------- */
async function cargarObra() {
  rubros = []; planillas = []; subs = []; subPls = []; gastos = []; roles = []; ocsC = []; factsC = []; meta = null; sinTablas = false;
  if (obraId) {
    const q = async (fn) => { try { const { data, error } = await fn(); return error ? null : data || []; } catch (_) { return null; } };
    const [g, r, p, s, sp, mt, rl, oc] = await Promise.all([
      q(() => sb.from("gastos").select("*").eq("obra_id", obraId).order("fecha", { ascending: false })),
      q(() => sb.from("rubros").select("id,codigo,descripcion,unidad,cantidad,precio,costo,capitulo,adicional").eq("obra_id", obraId).order("orden")),
      q(() => sb.from("planillas").select("id,numero,fecha,estado,totales").eq("obra_id", obraId).order("numero")),
      q(() => sb.from("subcontratos").select("id,numero,contratista,estado,monto,items").eq("obra_id", obraId).order("numero")),
      q(() => sb.from("subcontrato_planillas").select("id,subcontrato_id,numero,fecha,estado,totales").eq("obra_id", obraId).order("numero")),
      esAdmin() ? q(() => sb.from("costos_meta").select("*").eq("obra_id", obraId)) : Promise.resolve([]),
      q(() => sb.from("roles_pago").select("id,numero,desde,hasta,estado,totales").eq("obra_id", obraId).order("numero")),
      q(() => sb.from("compras_ordenes").select("id,numero,estado,subtotal").eq("obra_id", obraId))
    ]);
    ocsC = oc || [];
    if (ocsC.length && esAdmin()) factsC = (await q(() => sb.from("compras_orden_facturas").select("orden_id,subtotal").in("orden_id", ocsC.map((x) => x.id)))) || [];
    if (g === null) sinTablas = true;
    gastos = g || []; rubros = r || []; planillas = p || []; subs = s || []; subPls = sp || []; meta = (mt || [])[0] || null; roles = rl || [];
  }
  render();
}

/* ---------- render ---------- */
function setDirty(v) { dirty = v; const e = $("#estado"); if (view !== "gasto") return; e.className = "state" + (v ? " dirty" : ""); e.textContent = v ? "Sin guardar" : "Guardado"; }
const secAbierta = {};
document.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.sec) secAbierta[view + d.dataset.sec] = d.open; }, true);
function aplicarSecciones() { document.querySelectorAll("details[data-sec]").forEach((d) => { const k = view + d.dataset.sec; if (k in secAbierta) d.open = secAbierta[k]; }); }
function render() { renderBase(); aplicarSecciones(); }
function renderBase() {
  const m = $("#main");
  $("#top").hidden = !user;
  $("#dock").hidden = view !== "gasto";
  if (view === "gasto") { $("#btnPDF").hidden = true; $("#btnGuardar").hidden = !puedeEditar(gasto); $("#btnVolver").textContent = "← Gastos"; }
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (!obraId) { m.innerHTML = `<div class="empty"><b>Sin obras asignadas.</b></div>`; return; }
  if (sinTablas) { m.innerHTML = `<div class="empty"><b>Falta activar el control de costos.</b><span>Ejecuta <b>supabase/costos.sql</b> en Supabase → SQL Editor y recarga.</span></div>`; return; }
  if (view === "gasto") return renderGasto(m);
  if (!esAdmin()) tab = "gastos";
  const tabs = esAdmin() ? `<div class="segtabs tres" role="tablist">${[["resumen", "Resumen"], ["gastos", "Gastos (" + gastos.length + ")"], ["meta", "Presupuesto meta"]].map(([k, v]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${v}</button>`).join("")}</div>` : "";
  m.innerHTML = tabs + (tab === "resumen" ? htmlResumen() : tab === "meta" ? htmlMeta() : htmlGastos());
}
function kpi(label, v, cls = "", sub = "") { return `<div><small>${label}</small><b class="${cls}">${v}</b>${sub ? `<span class="code">${sub}</span>` : ""}</div>`; }
const clsMargen = (p) => p == null ? "" : p < 0 ? "rojo" : p < 5 ? "ambar" : "verde";
function htmlResumen() {
  const k = calc(), o = obra();
  const sinVenta = !k.venta;
  const meses = porMes();
  const caps = {};
  for (const g of gastos) if (g.capitulo) caps[g.capitulo] = (caps[g.capitulo] || 0) + num(g.monto);
  const capsL = Object.entries(caps).sort((a, b) => b[1] - a[1]);
  const provs = {};
  for (const g of gastos) { const p = (g.proveedor || "").trim(); if (p) provs[p] = (provs[p] || 0) + num(g.monto); }
  for (const p of subPls) if (p.estado === "aprobada" || p.estado === "pagada") { const s = subs.find((x) => x.id === p.subcontrato_id); if (s) provs[s.contratista] = (provs[s.contratista] || 0) + num((p.totales || {}).bruto); }
  if (rolesOk().length) provs["Roles de pago (personal DLV)"] = rolesOk().reduce((t, r) => t + num((r.totales || {}).costo), 0);
  const top = Object.entries(provs).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return `
  <section class="obracard"><div class="listhead"><h1>${esc(o.nombre)}</h1><button class="btn sm" type="button" data-act="pdf">Informe PDF</button></div>
    ${sinVenta ? `<div class="alertbar"><b>Esta obra no tiene presupuesto contractual.</b><span>Carga los rubros en Estado de pago para calcular el margen.</span></div>` : ""}
    <div class="kpis">
      ${kpi("Venta (contrato + adicionales)", money(k.venta))}
      ${kpi("Planillado al cliente", money(k.planillado), "", pct(k.avance * 100, 0) + " del contrato")}
      ${kpi("Costo real a la fecha", money(k.costo), "", [gastos.length + " gastos", subPls.filter((p) => p.estado === "aprobada" || p.estado === "pagada").length + " planillas de subcontratos", rolesOk().length ? rolesOk().length + " roles de pago" : ""].filter(Boolean).join(" · "))}
      ${kpi("Margen a la fecha", money(k.margen), clsMargen(k.margenPct), pct(k.margenPct) + " de lo planillado")}
    </div>
  </section>
  <section class="obracard">
    <div class="listhead"><h2 class="h2">Proyección al cierre</h2></div>
    <div class="kpis">
      ${kpi("Costo meta", k.meta ? money(k.metaTotal) : "Sin meta", "", k.meta ? "margen previsto " + pct(k.margenMetaPct) : `<button class="lnk" type="button" data-tab="meta">Definir meta →</button>`)}
      ${kpi("Costo proyectado al cierre", k.eac != null ? money(k.eac) : "—", "", k.avance >= 0.05 ? "costo real ÷ avance planillado" : k.meta ? "avance menor a 5 %: se usa la meta" : "avance menor a 5 %")}
      ${kpi("Margen proyectado", k.margenProy != null ? money(k.margenProy) : "—", clsMargen(k.margenProyPct), pct(k.margenProyPct) + " de la venta")}
      ${kpi("Comprometido", money(k.comprometido + k.compras), "", "subcontratos por planillar " + money(k.comprometido) + " · órdenes de compra por facturar " + money(k.compras))}
    </div>
    ${k.meta && k.eac != null && k.eac > k.metaTotal * 1.02 ? `<div class="alertbar mal"><b>El costo proyectado supera la meta en ${money(k.eac - k.metaTotal)}.</b><span>Revisa abajo qué categoría se está pasando.</span></div>` : ""}
  </section>
  <details class="sec" data-sec="cat" open><summary><span class="num">1</span><h2>Meta vs real por categoría</h2><span class="sum">${k.meta ? pct(k.metaTotal ? k.costo / k.metaTotal * 100 : 0, 0) + " consumido" : "sin meta"}</span></summary><div class="body">
    ${k.meta ? `<span class="code">«Ganado» es la meta de cada categoría por el avance planillado (${pct(k.avance * 100, 0)}). Si el gasto real pasa lo ganado, esa categoría va por encima del presupuesto.</span>` : `<span class="code">Define el presupuesto meta para comparar. Por ahora solo se muestra el gasto real.</span>`}
    <div class="ctab">
      <div class="ch"><span>Categoría</span><span>Meta</span><span>Ganado</span><span>Real</span><span>Consumo</span></div>
      ${k.cats.filter((c) => c.meta || c.real).map((c) => `<div class="cr s-${c.sem}"><span><i class="dot s-${c.sem}"></i>${c.nombre}</span><span>${c.meta ? money(c.meta) : "—"}</span><span>${c.meta ? money(c.ganado) : "—"}</span><b>${money(c.real)}</b>
        <span class="cons">${c.consumo != null ? `<span class="meter sm ${c.sem}"><i style="width:${Math.min(100, c.consumo).toFixed(1)}%"></i></span>${pct(c.consumo, 0)}` : "—"}</span></div>`).join("") || `<span class="code">Aún no hay gastos ni meta.</span>`}
      <div class="cr tot"><span>Total</span><span>${k.meta ? money(k.metaTotal) : "—"}</span><span>${k.meta ? money(k.metaTotal * k.avance) : "—"}</span><b>${money(k.costo)}</b><span>${k.meta ? pct(k.costo / k.metaTotal * 100, 0) : ""}</span></div>
    </div>
  </div></details>
  <details class="sec" data-sec="mes" open><summary><span class="num">2</span><h2>Costo vs planillado por mes</h2><span class="sum">${meses.length} meses</span></summary><div class="body">
    ${grafico(meses)}
  </div></details>
  <details class="sec" data-sec="caja"><summary><span class="num">3</span><h2>Flujo de caja</h2><span class="sum">${money(k.caja)}</span></summary><div class="body">
    <div class="sumgrid">
      <div><span>Cobrado al cliente (planillas pagadas)</span><b>${money(k.cobrado)}</b></div>
      <div><span>Pagado (gastos y subcontratos)</span><b>${money(k.pagado)}</b></div>
      <div class="big tot"><span>Saldo de caja de la obra</span><b class="${k.caja < 0 ? "rojo" : ""}">${money(k.caja)}</b></div>
      <div><span>Planillado por cobrar</span><b>${money(k.planillado - k.cobrado)}</b></div>
      <div><span>Por pagar (gastos y planillas aprobadas)</span><b>${money(k.porPagar)}</b></div>
    </div>
    <span class="code">Valores sin IVA ni retenciones: es la caja de la obra, no la contable. Lo cobrado es el valor bruto de las planillas pagadas.</span>
  </div></details>
  ${capsL.length ? `<details class="sec" data-sec="cap"><summary><span class="num">4</span><h2>Gasto por capítulo</h2><span class="sum">${capsL.length}</span></summary><div class="body"><div class="mini">${capsL.map(([c, v]) => `<div><span>${esc(c)}</span><b>${money(v)}</b></div>`).join("")}</div></div></details>` : ""}
  ${top.length ? `<details class="sec" data-sec="prov"><summary><span class="num">${capsL.length ? 5 : 4}</span><h2>Principales proveedores</h2><span class="sum">${Object.keys(provs).length}</span></summary><div class="body"><div class="mini">${top.map(([p, v]) => `<div><span>${esc(p)}</span><b>${money(v)}</b><span class="code">${pct(k.costo ? v / k.costo * 100 : 0, 0)}</span></div>`).join("")}</div></div></details>` : ""}`;
}
function grafico(meses) {
  if (!meses.length) return `<span class="code">Cuando registres gastos y planillas verás aquí cada mes.</span>`;
  const W = 600, H = 220, L = 50, B = 26, T = 12, R = 8, w = W - L - R, h = H - B - T;
  const max = Math.max(1, ...meses.map((x) => Math.max(x.costo, x.venta)));
  const paso = Math.pow(10, Math.floor(Math.log10(max))), tope = Math.ceil(max / paso) * paso;
  const y = (v) => T + h - v / tope * h, bw = w / meses.length, b = Math.min(22, bw * 0.34);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${L + w}" y1="${y(tope * f)}" y2="${y(tope * f)}" class="grid"/><text x="${L - 6}" y="${y(tope * f) + 3}" class="ax" text-anchor="end">${(tope * f / 1000).toLocaleString("es-EC", { maximumFractionDigits: 1 })}k</text>`).join("");
  const barras = meses.map((x, i) => { const cx = L + bw * i + bw / 2; return `
    <rect x="${(cx - b - 1).toFixed(1)}" y="${y(x.venta).toFixed(1)}" width="${b}" height="${(T + h - y(x.venta)).toFixed(1)}" class="bv"><title>Planillado ${mesTxt(x.k)}: ${money(x.venta)}</title></rect>
    <rect x="${(cx + 1).toFixed(1)}" y="${y(x.costo).toFixed(1)}" width="${b}" height="${(T + h - y(x.costo)).toFixed(1)}" class="bc"><title>Costo ${mesTxt(x.k)}: ${money(x.costo)}</title></rect>
    <text x="${cx.toFixed(1)}" y="${H - 8}" class="ax" text-anchor="middle">${mesTxt(x.k)}</text>`; }).join("");
  return `<div class="leyenda"><span><i class="bv"></i>Planillado</span><span><i class="bc"></i>Costo real</span></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Costo real y planillado por mes">${ticks}${barras}</svg>`;
}
function filtrados() {
  const q = fBus.trim().toLowerCase();
  return gastos.filter((g) => (!fCat || g.categoria === fCat) && (!fMes || String(g.fecha).slice(0, 7) === fMes) && (!fPend || !g.pagado)
    && (!q || [g.proveedor, g.documento, g.descripcion, g.capitulo].some((x) => String(x || "").toLowerCase().includes(q))));
}
function htmlGastos() {
  const lista = filtrados(), tot = lista.reduce((t, g) => t + num(g.monto), 0);
  const mesesG = [...new Set(gastos.map((g) => String(g.fecha).slice(0, 7)))].sort().reverse();
  const MAX = 300;
  return `
  <div class="listhead"><h1>Gastos de la obra</h1><div class="acts"><button class="btn sm" type="button" data-act="verPegar">Pegar desde Excel</button><button class="btn hivis" type="button" data-act="nuevo">+ Gasto</button></div></div>
  ${pegar !== false ? `<div class="pastebox">
    <span class="code">Copia desde Excel las columnas <b>Fecha · Proveedor · N.° documento · Descripción · Categoría · Monto sin IVA</b> y pégalas aquí. Si tu hoja no tiene alguna, también sirve <b>Fecha · Proveedor · Descripción · Categoría · Monto</b> o <b>Fecha · Descripción · Categoría · Monto</b>. Si la categoría está vacía, se deduce de la descripción (cemento → materiales, jornales → mano de obra…). Las filas sin fecha válida, como los títulos, se saltan.</span>
    <textarea id="pegarTxt" rows="7" placeholder="15/10/2026&#9;Ferretería El Arco&#9;001-002-4567&#9;Cemento 50 kg x 80&#9;Materiales&#9;624,00"></textarea>
    <label class="chk"><input type="checkbox" id="pegarPag" checked> Ya están pagados</label>
    <div><button class="btn sm primary" type="button" data-act="pegarOk">Agregar gastos</button> <button class="btn sm ghost" type="button" data-act="pegarNo">Cancelar</button></div></div>` : ""}
  <div class="filtros">
    <label class="fld"><span>Buscar</span><input id="fBus" type="search" placeholder="Proveedor, factura, descripción…" value="${esc(fBus)}"></label>
    <label class="fld"><span>Categoría</span><select id="fCat"><option value="">Todas</option>${CATS_GASTO.map((k) => `<option value="${k}"${fCat === k ? " selected" : ""}>${CATS[k]}</option>`).join("")}</select></label>
    <label class="fld"><span>Mes</span><select id="fMes"><option value="">Todos</option>${mesesG.map((k) => `<option value="${k}"${fMes === k ? " selected" : ""}>${mesTxt(k)}</option>`).join("")}</select></label>
    <label class="chk"><input type="checkbox" id="fPend"${fPend ? " checked" : ""}> Solo por pagar</label>
  </div>
  <div class="totline"><span>${lista.length} ${lista.length === 1 ? "gasto" : "gastos"}</span><b>${money(tot)}</b>${lista.length ? `<button class="lnk" type="button" data-act="csv">Descargar CSV</button>` : ""}</div>
  <div class="list">${lista.length ? lista.slice(0, MAX).map((g) => `
    <button class="rep gs" type="button" data-g="${esc(g.id)}"><span class="fe">${fmtF(g.fecha).slice(0, 5)}<small>${String(g.fecha).slice(0, 4)}</small></span>
      <span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${esc(g.proveedor || g.descripcion || "Sin proveedor")}</span>
        <span class="d">${esc([g.proveedor ? g.descripcion : "", g.documento, g.capitulo].filter(Boolean).join(" · ") || "—")}</span>
        <span><span class="pill cat-${esc(g.categoria)}">${CATS[g.categoria] || g.categoria}</span>${g.pagado ? "" : ` <span class="pill gp-aviso">Por pagar</span>`}</span></span>
      <b class="mt">${money(num(g.monto))}</b></button>`).join("") + (lista.length > MAX ? `<span class="code">Mostrando ${MAX} de ${lista.length}. Usa los filtros para ver el resto.</span>` : "")
    : gastos.length ? `<div class="empty"><span>Ningún gasto coincide con el filtro.</span></div>`
    : `<div class="empty"><span>Registra aquí las facturas, roles de pago, alquileres y caja chica de la obra. Los subcontratos se suman solos desde sus planillas aprobadas y los roles de pago desde Personal.</span><button class="btn hivis" type="button" data-act="nuevo">+ Primer gasto</button></div>`}</div>`;
}
function htmlMeta() {
  const m = metaEd || (metaEd = meta ? { ...meta } : { ...sugerida().meta, _nueva: true });
  const sug = sugerida(), k = calc(), tot = metaTotal(m);
  return `
  <section class="obracard"><div class="listhead"><h1>Presupuesto meta</h1></div>
    <span class="code">Es lo que DLV espera gastar en la obra, por categoría y sin IVA. Contra esto se mide el gasto real y se proyecta el margen.</span>
    ${m._nueva ? `<div class="alertbar"><b>Valores sugeridos, aún sin guardar.</b><span>${sug.conCosto ? "Costo directo del estudio de propuesta (" + money(sug.directo) + ")" : "Sin costos del estudio: costo directo = venta ÷ 1,298 (18 % indirectos y 10 % utilidad)"}, repartido 55 % materiales, 25 % mano de obra, 12 % subcontratos, 6 % equipos, 2 % otros, más 18 % de indirectos. Ajústalos con tu presupuesto real.</span></div>` : ""}
    <div class="metas">${Object.keys(CATS).map((c) => `<label class="fld"><span>${CATS[c]}</span><input type="text" inputmode="decimal" data-m="${c}" value="${esc(m[c] ?? "")}"></label>`).join("")}</div>
    <div class="sumgrid" id="metaSum">${metaResumen(tot, k.venta)}</div>
    <div class="acts"><button class="btn primary" type="button" data-act="guardarMeta">Guardar meta</button>${meta ? `<button class="btn sm ghost" type="button" data-act="sugerir">Volver a la sugerencia</button>` : ""}</div>
  </section>`;
}
const metaResumen = (tot, venta) => `<div class="big tot"><span>Costo meta total</span><b>${money(tot)}</b></div><div><span>Venta</span><b>${money(venta)}</b></div><div><span>Margen previsto</span><b class="${clsMargen(venta ? (venta - tot) / venta * 100 : null)}">${money(venta - tot)} · ${pct(venta ? (venta - tot) / venta * 100 : null)}</b></div>`;
function renderGasto(m) {
  const g = gasto, ed = puedeEditar(g), dis = ed ? "" : " disabled";
  const provs = [...new Set(gastos.map((x) => (x.proveedor || "").trim()).filter(Boolean))].sort();
  const caps = [...new Set(rubros.map((r) => (r.capitulo || "").trim()).concat(gastos.map((x) => (x.capitulo || "").trim())).filter(Boolean))];
  const f = (p, label, type = "text", extra = "") => `<label class="fld" for="g_${p}"><span>${label}</span><input id="g_${p}" type="${type}" data-p="${p}" value="${esc(g[p] ?? "")}"${extra}${dis}></label>`;
  m.innerHTML = `
  <details class="sec" open><summary><span class="num">$</span><h2>${g.id ? "Gasto" : "Nuevo gasto"}</h2><span class="sum">${esc(obra().nombre)}</span></summary><div class="body">
    ${ed ? "" : `<span class="code">Este gasto lo registró otra persona: solo puedes verlo.</span>`}
    <div class="grid2">${f("fecha", "Fecha", "date")}
      <label class="fld" for="g_cat"><span>Categoría</span><select id="g_cat" data-p="categoria"${dis}>${CATS_GASTO.map((k) => `<option value="${k}"${g.categoria === k ? " selected" : ""}>${CATS[k]}</option>`).join("")}</select></label></div>
    ${f("proveedor", "Proveedor", "text", ' list="dlProv" autocomplete="off"')}<datalist id="dlProv">${provs.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
    <div class="grid2">${f("documento", "N.° factura / documento")}${f("monto", "Monto sin IVA", "text", ' inputmode="decimal"')}</div>
    <label class="fld" for="g_descripcion"><span>Descripción</span><textarea id="g_descripcion" data-p="descripcion" rows="2"${dis}>${esc(g.descripcion || "")}</textarea></label>
    ${f("capitulo", "Capítulo o rubro (opcional)", "text", ' list="dlCap" autocomplete="off"')}<datalist id="dlCap">${caps.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
    <div class="grid2"><label class="chk"><input type="checkbox" id="g_pag"${g.pagado ? " checked" : ""}${dis}> Pagado</label>${g.pagado ? f("fecha_pago", "Fecha de pago", "date") : ""}</div>
    ${g.id && g.origen === "excel" ? `<span class="code">Importado desde Excel.</span>` : ""}
  </div></details>
  ${g.id && esAdmin() ? (confirm === "g" ? `<div class="confirm"><span>¿Borrar este gasto?</span><button class="btn sm danger" type="button" data-act="delOk">Sí, borrar</button><button class="btn sm" type="button" data-act="noDel">Cancelar</button></div>` : `<div><button class="btn sm danger" type="button" data-act="del">Borrar gasto</button></div>`) : ""}`;
  setDirty(dirty);
}

/* ---------- acciones ---------- */
function abrir(g) {
  const ult = gastos[0];
  gasto = g ? { ...g } : { fecha: hoy(), categoria: (ult && ult.categoria) || "materiales", proveedor: "", documento: "", descripcion: "", capitulo: "", monto: "", pagado: true, fecha_pago: hoy() };
  confirm = null; view = "gasto"; dirty = !g; render(); window.scrollTo(0, 0);
  if (!g) { const i = $("#g_proveedor"); if (i) i.focus(); }
}
async function guardar() {
  const g = gasto;
  if (!g.fecha) return toast("Pon la fecha del gasto.");
  if (!num(g.monto)) return toast("Escribe el monto.");
  if (!(g.proveedor || "").trim() && !(g.descripcion || "").trim()) return toast("Escribe el proveedor o una descripción.");
  const row = { obra_id: obraId, fecha: g.fecha, categoria: g.categoria, proveedor: (g.proveedor || "").trim() || null, documento: (g.documento || "").trim() || null, descripcion: (g.descripcion || "").trim() || null,
    capitulo: (g.capitulo || "").trim() || null, monto: r2(num(g.monto)), pagado: !!g.pagado, fecha_pago: g.pagado ? g.fecha_pago || g.fecha : null };
  const { data, error } = g.id ? await sb.from("gastos").update(row).eq("id", g.id).select().single() : await sb.from("gastos").insert(row).select().single();
  if (error) return toast("No se pudo guardar: " + error.message);
  const i = gastos.findIndex((x) => x.id === data.id); if (i > -1) gastos[i] = data; else gastos.push(data);
  gastos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const nuevo = !g.id; gasto = { ...data }; dirty = false;
  if (nuevo) { toast("Gasto guardado · " + money(num(data.monto))); view = "lista"; gasto = null; render(); } else { render(); toast("Cambios guardados"); }
}
async function importar() {
  const txt = $("#pegarTxt").value, modo = formatoNumeros(txt), pag = $("#pegarPag").checked, rows = []; let malas = 0;
  for (const raw of txt.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const c = raw.split("\t").map((x) => x.trim());
    const fecha = fechaDe(c[0]); if (!fecha || c.length < 4) { malas++; continue; }
    let proveedor = "", documento = "", descripcion = "", cat = "", monto = c[c.length - 1];
    if (c.length >= 6) [, proveedor, documento, descripcion, cat] = c;
    else if (c.length === 5) [, proveedor, descripcion, cat] = c;
    else [, descripcion, cat] = c;
    const v = r2(numCon(monto, modo)); if (!v) { malas++; continue; }
    const categoria = adivinaCat(cat) || (CATS_GASTO.includes(cat) ? cat : "") || adivinaCat(descripcion + " " + proveedor) || "otros";
    rows.push({ obra_id: obraId, fecha, categoria, proveedor: proveedor || null, documento: documento || null, descripcion: descripcion || null, monto: v, pagado: pag, fecha_pago: pag ? fecha : null, origen: "excel" });
  }
  if (!rows.length) return toast("No encontré filas con fecha y monto. Revisa el orden de las columnas.");
  const nuevos = [];
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await sb.from("gastos").insert(rows.slice(i, i + 500)).select();
    if (error) { toast("Se cortó la importación: " + error.message); break; }
    nuevos.push(...(data || []));
  }
  gastos = gastos.concat(nuevos).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  pegar = false; render();
  if (nuevos.length) toast(nuevos.length + " gastos agregados · " + money(nuevos.reduce((t, g) => t + num(g.monto), 0)) + (malas ? " · " + malas + " filas saltadas" : ""));
}
async function guardarMeta() {
  const row = { obra_id: obraId, actualizado: new Date().toISOString() };
  for (const k of Object.keys(CATS)) row[k] = r2(num(metaEd[k]));
  const { data, error } = await sb.from("costos_meta").upsert(row, { onConflict: "obra_id" }).select().single();
  if (error) return toast("No se pudo guardar: " + error.message);
  meta = data; metaEd = { ...data }; render(); toast("Meta guardada");
}
function csv() {
  const q = (v) => { const s = String(v ?? ""); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lin = [["Fecha", "Proveedor", "Documento", "Descripción", "Categoría", "Capítulo", "Monto sin IVA", "Pagado", "Fecha pago"].join(";")];
  for (const g of filtrados()) lin.push([fmtF(g.fecha), g.proveedor, g.documento, g.descripcion, CATS[g.categoria], g.capitulo, num(g.monto).toFixed(2).replace(".", ","), g.pagado ? "Sí" : "No", fmtF(g.fecha_pago)].map(q).join(";"));
  const blob = new Blob(["﻿" + lin.join("\r\n")], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "Gastos " + (obra().nombre || "obra").replace(/[\\/:*?"<>|]/g, "") + " " + hoy() + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- PDF ---------- */
function pdf() {
  const k = calc(), o = obra(), meses = porMes();
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" }); { const _t = doc.text.bind(doc), _l = (s) => typeof s === "string" ? s.replace(/[−–]/g, "-").replace(/✓/g, "»").replace(/☐/g, "[  ]").replace(/[★☆]/g, "*").replace(/↗/g, ">").replace(/↙/g, "<").replace(/→/g, "->") : s; doc.text = (s, ...a) => _t(Array.isArray(s) ? s.map(_l) : _l(s), ...a); }
  const M = 12, W = 186, NAVY = [58, 61, 64], AMB = [169, 165, 157], GRID = [150, 150, 150], SUB = [232, 231, 227], ROJO = [160, 70, 62], VERDE = [60, 110, 78];
  const fit = (x, w) => { x = String(x ?? ""); while (x && doc.getTextWidth(x) > w) x = x.slice(0, -2) + "…"; return x; };
  let pagina = 1, y;
  const header = (sub) => {
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.rect(M, M, W, 18); doc.line(M + 44, M, M + 44, M + 18); doc.line(M + W - 46, M, M + W - 46, M + 18);
    doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("DLV", M + 5, M + 9.5); doc.setFillColor(...AMB); doc.rect(M + 5, M + 10.8, 15, 1, "F");
    doc.setFontSize(6.2); doc.text("CONSTRUCCIONES CÍA. LTDA.", M + 5, M + 14.6);
    doc.setFontSize(12.5); doc.text("INFORME DE COSTOS DE OBRA", M + 44 + (W - 90) / 2, M + 8.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85, 85, 85); doc.text(fit(o.nombre + " · " + sub, W - 96), M + 44 + (W - 90) / 2, M + 13.2, { align: "center" });
    [["FECHA", fmtF(hoy())], ["AVANCE PLANILLADO", pct(k.avance * 100, 1)], ["PÁGINA", String(pagina)]].forEach(([kk, v], i) => {
      const x = M + W - 46, yy = M + i * 6; if (i) doc.line(x, yy, M + W, yy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(kk, x + 1.5, yy + 4);
      doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(v, M + W - 1.5, yy + 4, { align: "right" });
    });
    doc.setFont("helvetica", "normal"); doc.setFontSize(5.6); doc.setTextColor(120, 120, 120); doc.text("DLV Construcciones Cía. Ltda. · Control de costos · valores en USD sin IVA · uso interno", M, 289);
    return M + 22;
  };
  const titulo = (t) => { if (y + 12 > 280) { doc.addPage(); pagina++; y = header("continuación"); } doc.setFillColor(...NAVY); doc.rect(M, y, W, 5.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(7.4); doc.setTextColor(255, 255, 255); doc.text(t, M + 2, y + 3.8); y += 5.5; };
  const fila = (cols, vals, opt = {}) => {
    if (y + 5.4 > 282) { doc.addPage(); pagina++; y = header("continuación"); if (opt.head) { opt.head(); } }
    if (opt.fill) { doc.setFillColor(...opt.fill); doc.rect(M, y, W, 5.4, "F"); }
    doc.setDrawColor(210, 210, 210); doc.line(M, y + 5.4, M + W, y + 5.4);
    let x = M; doc.setFont("helvetica", opt.bold ? "bold" : "normal"); doc.setFontSize(opt.size || 7);
    cols.forEach(([, w, al], i) => { const v = vals[i]; doc.setTextColor(...((opt.color && opt.color[i]) || [30, 30, 30])); if (v != null && v !== "") doc.text(fit(v, w - 2.4), al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, y + 3.7, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; });
    y += 5.4;
  };
  const cab = (cols) => { let x = M; doc.setFillColor(...SUB); doc.rect(M, y, W, 5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6); doc.setTextColor(...NAVY);
    for (const [h, w, al] of cols) { doc.text(h, al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, y + 3.4, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; } y += 5; };
  y = header("Resumen económico");
  // tarjetas
  const cards = [["VENTA", money(k.venta)], ["PLANILLADO", money(k.planillado)], ["COSTO REAL", money(k.costo)], ["MARGEN A LA FECHA", money(k.margen) + "  (" + pct(k.margenPct) + ")"],
    ["COSTO META", k.meta ? money(k.metaTotal) : "—"], ["COSTO PROYECTADO", k.eac != null ? money(k.eac) : "—"], ["MARGEN PROYECTADO", k.margenProy != null ? money(k.margenProy) + "  (" + pct(k.margenProyPct) + ")" : "—"], ["SALDO DE CAJA", money(k.caja)]];
  const cw = (W - 6) / 4;
  cards.forEach(([t, v], i) => {
    const x = M + (i % 4) * (cw + 2), yy = y + Math.floor(i / 4) * 15;
    doc.setDrawColor(...GRID); doc.rect(x, yy, cw, 13); doc.setFillColor(...(i === 3 || i === 6 ? AMB : NAVY)); doc.rect(x, yy, 1.4, 13, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(t, x + 3.5, yy + 4.5);
    const neg = (i === 3 && k.margen < 0) || (i === 6 && k.margenProy < 0) || (i === 7 && k.caja < 0);
    doc.setFontSize(8.6); doc.setTextColor(...(neg ? ROJO : [30, 30, 30])); doc.text(fit(v, cw - 5), x + 3.5, yy + 10);
  });
  y += 33;
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(80, 80, 80);
  doc.text(doc.splitTextToSize("Costo real = gastos registrados + planillas de subcontratos aprobadas o pagadas. Costo proyectado = costo real ÷ avance planillado (" + pct(k.avance * 100, 1) + ")" + (k.avance < 0.05 ? "; con menos de 5 % de avance se usa la meta" : "") + ". Ganado = meta de la categoría × avance planillado.", W), M, y);
  y += 9;
  titulo("META VS REAL POR CATEGORÍA");
  const cc = [["CATEGORÍA", 58, "l"], ["META", 30, "r"], ["GANADO", 30, "r"], ["REAL", 30, "r"], ["DIFERENCIA", 22, "r"], ["CONSUMO", 16, "r"]];
  cab(cc);
  for (const c of k.cats.filter((x) => x.meta || x.real)) {
    const dif = c.meta ? c.ganado - c.real : null;
    fila(cc, [c.nombre, c.meta ? money(c.meta) : "—", c.meta ? money(c.ganado) : "—", money(c.real), dif != null ? money(dif) : "—", c.consumo != null ? pct(c.consumo, 0) : "—"], { color: { 4: dif != null && dif < 0 ? ROJO : VERDE } });
  }
  fila(cc, ["TOTAL", k.meta ? money(k.metaTotal) : "—", k.meta ? money(k.metaTotal * k.avance) : "—", money(k.costo), k.meta ? money(k.metaTotal * k.avance - k.costo) : "—", k.meta ? pct(k.costo / k.metaTotal * 100, 0) : ""], { bold: true, fill: SUB });
  y += 5;
  if (meses.length) {
    titulo("COSTO VS PLANILLADO POR MES");
    const cm = [["MES", 40, "l"], ["PLANILLADO", 36, "r"], ["COSTO REAL", 36, "r"], ["DIFERENCIA", 36, "r"], ["COSTO ACUMULADO", 38, "r"]];
    cab(cm); let acu = 0;
    for (const x of meses) { acu += x.costo; fila(cm, [mesTxt(x.k), money(x.venta), money(x.costo), money(x.venta - x.costo), money(acu)], { color: { 3: x.venta - x.costo < 0 ? ROJO : [30, 30, 30] } }); }
    y += 5;
  }
  titulo("FLUJO DE CAJA DE LA OBRA");
  const cf = [["CONCEPTO", 140, "l"], ["VALOR", 46, "r"]];
  [["Cobrado al cliente (planillas pagadas, valor bruto)", k.cobrado], ["Pagado en gastos y subcontratos", -k.pagado], ["SALDO DE CAJA", k.caja, true], ["Planillado por cobrar", k.planillado - k.cobrado], ["Por pagar (gastos pendientes y planillas de subcontratos aprobadas)", k.porPagar], ["Comprometido en subcontratos (saldo por planillar)", k.comprometido], ["Comprometido en órdenes de compra por facturar", k.compras]]
    .forEach(([t, v, b]) => fila(cf, [t, money(v)], b ? { bold: true, fill: SUB } : {}));
  // detalle de gastos
  if (gastos.length || k.costo > 0) {
    doc.addPage(); pagina++; y = header("Detalle de gastos");
    if (gastos.length) {
      const cg = [["FECHA", 17, "l"], ["PROVEEDOR", 42, "l"], ["DOCUMENTO", 24, "l"], ["DESCRIPCIÓN", 55, "l"], ["CATEGORÍA", 24, "l"], ["MONTO", 24, "r"]];
      cab(cg);
      const orden = gastos.slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
      for (const g of orden) fila(cg, [fmtF(g.fecha), g.proveedor || "", g.documento || "", g.descripcion || "", CATS[g.categoria] || g.categoria, money(num(g.monto))], { size: 6.4, head: () => cab(cg) });
      fila(cg, ["", "TOTAL GASTOS", "", gastos.length + " registros", "", money(gastos.reduce((t, g) => t + num(g.monto), 0))], { bold: true, fill: SUB });
    }
    const spl = subPls.filter((p) => p.estado === "aprobada" || p.estado === "pagada");
    if (spl.length) {
      y += 5; titulo("PLANILLAS DE SUBCONTRATOS INCLUIDAS");
      const cs = [["FECHA", 17, "l"], ["SUBCONTRATISTA", 80, "l"], ["PLANILLA", 30, "l"], ["ESTADO", 35, "l"], ["VALOR", 24, "r"]];
      cab(cs);
      for (const p of spl) { const s = subs.find((x) => x.id === p.subcontrato_id) || {}; fila(cs, [fmtF(p.fecha), s.contratista || "", "PS-" + String(s.numero || 0).padStart(2, "0") + "-" + String(p.numero).padStart(2, "0"), p.estado === "pagada" ? "Pagada" : "Aprobada", money(num((p.totales || {}).bruto))], { size: 6.4, head: () => cab(cs) }); }
      fila(cs, ["", "TOTAL SUBCONTRATOS", "", "", money(k.real.subcontratos)], { bold: true, fill: SUB });
    }
    if (rolesOk().length) {
      y += 5; titulo("ROLES DE PAGO INCLUIDOS (MANO DE OBRA)");
      const cr = [["ROL", 17, "l"], ["PERÍODO", 50, "l"], ["ESTADO", 25, "l"], ["LÍQUIDO", 30, "r"], ["APORTES Y PROVISIONES", 34, "r"], ["COSTO", 30, "r"]];
      cab(cr);
      for (const r of rolesOk()) { const t = r.totales || {}; fila(cr, ["ROL-" + String(r.numero).padStart(2, "0"), fmtF(r.desde) + " – " + fmtF(r.hasta), r.estado === "pagado" ? "Pagado" : "Aprobado", money(num(t.liquido)), money(num(t.iess) + num(t.patronal) + num(t.prov)), money(num(t.costo))], { size: 6.4, head: () => cab(cr) }); }
      fila(cr, ["", "TOTAL ROLES", "", "", "", money(rolesOk().reduce((a, r) => a + num((r.totales || {}).costo), 0))], { bold: true, fill: SUB });
    }
  }
  const name = "Costos " + (o.nombre || "obra").replace(/[\\/:*?"<>|]/g, "") + " " + hoy() + ".pdf";
  const blob = doc.output("blob"), file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch((e) => { if (e.name !== "AbortError") doc.save(name); });
  else doc.save(name);
}

/* ---------- eventos ---------- */
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "fBus") { fBus = t.value; const p = t.selectionStart; render(); const b = $("#fBus"); b.focus(); b.setSelectionRange(p, p); return; }
  if (t.dataset.m && metaEd) { metaEd[t.dataset.m] = t.value; $("#metaSum").innerHTML = metaResumen(metaTotal(Object.fromEntries(Object.keys(CATS).map((k) => [k, num(metaEd[k])]))), calc().venta); return; }
  if (t.dataset.p && gasto && view === "gasto") {
    gasto[t.dataset.p] = t.value; setDirty(true);
    if (t.dataset.p === "descripcion" || t.dataset.p === "proveedor") {
      // si el proveedor ya se usó, propone su categoría; si no, la deduce del texto (solo en gastos nuevos)
      if (!gasto.id && !gasto._catManual) {
        const prev = t.dataset.p === "proveedor" && gastos.find((x) => (x.proveedor || "").trim().toLowerCase() === t.value.trim().toLowerCase());
        const c = prev ? prev.categoria : adivinaCat(gasto.descripcion + " " + gasto.proveedor);
        if (c && c !== gasto.categoria) { gasto.categoria = c; const s = $("#g_cat"); if (s) s.value = c; }
      }
    }
  }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "obraSel") { obraId = t.value; try { localStorage.setItem("dlv-obra", obraId); } catch (_) {} view = "lista"; gasto = null; metaEd = null; fCat = fMes = fBus = ""; cargarObra(); return; }
  if (t.id === "fCat") { fCat = t.value; render(); return; }
  if (t.id === "fMes") { fMes = t.value; render(); return; }
  if (t.id === "fPend") { fPend = t.checked; render(); return; }
  if (t.id === "g_cat" && gasto) { gasto.categoria = t.value; gasto._catManual = true; setDirty(true); return; }
  if (t.id === "g_pag" && gasto) { gasto.pagado = t.checked; if (t.checked && !gasto.fecha_pago) gasto.fecha_pago = hoy(); setDirty(true); render(); return; }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; if (tab === "meta") metaEd = null; render(); window.scrollTo(0, 0); return; }
  if (b.dataset.g) return abrir(gastos.find((x) => x.id === b.dataset.g));
  const a = b.dataset.act;
  if (a === "nuevo") return abrir(null);
  if (a === "verPegar") { pegar = ""; render(); const t = $("#pegarTxt"); if (t) t.focus(); return; }
  if (a === "pegarNo") { pegar = false; render(); return; }
  if (a === "pegarOk") { b.disabled = true; try { await importar(); } finally { b.disabled = false; } return; }
  if (a === "csv") return csv();
  if (a === "pdf") { try { pdf(); } catch (err) { console.error(err); toast("No se pudo generar el PDF."); } return; }
  if (a === "guardarMeta") return guardarMeta();
  if (a === "sugerir") { metaEd = { ...sugerida().meta, _nueva: true }; render(); return; }
  if (a === "del") { confirm = "g"; render(); return; }
  if (a === "noDel") { confirm = null; render(); return; }
  if (a === "delOk") { const { error } = await sb.from("gastos").delete().eq("id", gasto.id); if (error) return toast("No se pudo borrar."); gastos = gastos.filter((x) => x.id !== gasto.id); dirty = false; view = "lista"; gasto = null; render(); toast("Gasto borrado"); return; }
  if (b.id === "btnGuardar") return guardar();
  if (b.id === "btnVolver") {
    if (dirty && !b.dataset.sure) { b.dataset.sure = "1"; const prev = b.textContent; b.textContent = "¿Salir sin guardar?"; setTimeout(() => { if (b.dataset.sure) { b.dataset.sure = ""; b.textContent = prev; } }, 3000); return; }
    b.dataset.sure = ""; view = "lista"; gasto = null; dirty = false; render();
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
  const { data } = await sb.from("obras").select("*").eq("activa", true).order("nombre");
  obras = data || [];
  let saved = ""; try { saved = localStorage.getItem("dlv-obra") || ""; } catch (_) {}
  const qs = new URLSearchParams(location.search);
  const want = qs.get("obra") || saved;
  obraId = (obras.find((o) => o.id === want) || obras[0] || {}).id || "";
  if (["resumen", "gastos", "meta"].includes(qs.get("tab"))) tab = qs.get("tab");
  $("#obraSel").innerHTML = obras.length ? obras.map((o) => `<option value="${esc(o.id)}"${o.id === obraId ? " selected" : ""}>${esc(o.nombre)}</option>`).join("") : `<option value="">Sin obras asignadas</option>`;
  await cargarObra();
})();
})();
