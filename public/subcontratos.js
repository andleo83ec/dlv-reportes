// DLV Plataforma — Subcontratos y garantías: cuadro de contratos, rubros y checklist de cada contrato,
// planillas del subcontratista (con retenciones SRI) en PDF, evaluación al cierre y pólizas con vencimientos.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hoy = () => ymd(new Date());
const fmtF = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
const diasA = (f) => { if (!f) return null; const [y, m, d] = f.split("-").map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d) - t) / 86400000); };
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
const qty = (n) => (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pl2 = (v) => num(v).toLocaleString("es-EC", { maximumFractionDigits: 2 });
const pct = (n) => (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

const EST_SC = { borrador: "En preparación", vigente: "Vigente", terminado: "Terminado", anulado: "Anulado" };
const EST_PL = { borrador: "Borrador", presentada: "Presentada", aprobada: "Aprobada", pagada: "Pagada" };
const TIPOS = { buen_uso: "Buen uso del anticipo", fiel_cumplimiento: "Fiel cumplimiento", seriedad: "Seriedad de oferta", calidad: "Calidad / vicios ocultos", otra: "Otra" };
const EST_G = { vigente: "Vigente", devuelta: "Devuelta", ejecutada: "Ejecutada" };
const CHECK = [
  ["alcance", "Alcance y especificaciones definidos"], ["precios", "Rubros, cantidades y precios unitarios acordados"], ["plazo", "Plazo y cronograma de ejecución"],
  ["pago", "Forma de pago, anticipo y planillas"], ["polizas", "Pólizas de anticipo y fiel cumplimiento recibidas"], ["multas", "Multas por atraso y causales de terminación"],
  ["iess", "Personal afiliado al IESS y seguro de accidentes"], ["sso", "Plan de seguridad y EPP del personal"], ["ruc", "RUC vigente y facturación electrónica"], ["firma", "Contrato firmado por ambas partes"]
];
const CRIT = [["calidad", "Calidad del trabajo"], ["plazo", "Cumplimiento de plazos"], ["seguridad", "Seguridad y EPP"], ["orden", "Orden y limpieza"], ["documentos", "Documentación y facturación"]];

let sb = null, user = null, perfil = null, obras = [], obraId = "";
let subs = [], subPls = [], garantias = [], rubrosObra = null, sinTablas = false;
let view = "lista", tab = "contratos", sc = null, pl = null, gar = null, dirty = false, confirm = null, volverA = "lista";
let pegar = "", elegirRubros = false, filtro = "", soloConCant = false;
const esAdmin = () => perfil && perfil.rol === "admin";
const obra = () => obras.find((o) => o.id === obraId) || {};

/* ---------- cálculo ---------- */
const montoDe = (s) => (s.items || []).reduce((t, it) => t + num(it.cantidad) * num(it.precio), 0);
function calcular(s, lista, objetivo) {
  const c = s.condiciones || {}, monto = montoDe(s);
  const orden = lista.filter((p) => !objetivo || p.id !== objetivo.id).concat(objetivo ? [objetivo] : []).sort((a, b) => a.numero - b.numero);
  const acum = {}; let amortAcum = 0, brutoAcum = 0, res = null;
  for (const p of orden) {
    const cfg = p.config || {};
    const lineas = (s.items || []).map((it) => {
      const ant = acum[it.id] || 0, per = num((p.cantidades || {})[it.id]), acu = ant + per, pu = num(it.precio), con = num(it.cantidad);
      return { it, ant, per, acu, con, pu, vCon: con * pu, vAnt: ant * pu, vPer: per * pu, vAcu: acu * pu, excede: acu > con + 1e-9 };
    });
    const bruto = lineas.reduce((t, l) => t + l.vPer, 0);
    const anticipo = monto * num(c.anticipo_pct) / 100;
    const amort = Math.max(0, Math.min(bruto * num(c.anticipo_pct) / 100, anticipo - amortAcum));
    const ret = bruto * num(c.ret_pct) / 100, iva = bruto * num(c.iva_pct) / 100;
    const retRenta = bruto * num(c.ret_renta_pct) / 100, retIva = iva * num(c.ret_iva_pct) / 100;
    const multas = num(cfg.multas), desc = num(cfg.descuentos);
    const t = {
      monto: r2(monto), anterior: r2(brutoAcum), bruto: r2(bruto), acumulado: r2(brutoAcum + bruto), saldo: r2(monto - brutoAcum - bruto),
      avance: monto > 0 ? (brutoAcum + bruto) / monto * 100 : 0, anticipo: r2(anticipo), amort: r2(amort), saldoAnticipo: r2(anticipo - amortAcum - amort),
      ret: r2(ret), retAcum: r2((brutoAcum + bruto) * num(c.ret_pct) / 100), multas: r2(multas), descuentos: r2(desc), iva: r2(iva), retRenta: r2(retRenta), retIva: r2(retIva),
      liquido: r2(bruto + iva - amort - ret - multas - desc - retRenta - retIva)
    };
    if (p === objetivo) res = { lineas, t };
    for (const l of lineas) acum[l.it.id] = l.acu;
    amortAcum += amort; brutoAcum += bruto;
    if (!objetivo) res = { lineas, t };
  }
  return res || { lineas: [], t: { monto: r2(monto), acumulado: 0, saldo: r2(monto), avance: 0 } };
}
const plsDe = (id) => subPls.filter((p) => p.subcontrato_id === id);
const promedio = (ev) => { if (!ev) return 0; const v = CRIT.map(([k]) => num(ev[k])).filter(Boolean); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
function estadoGar(g) {
  if (g.estado !== "vigente") return { cls: "gris", txt: EST_G[g.estado] };
  const d = diasA(g.vencimiento);
  if (d == null) return { cls: "", txt: "Vigente · sin vencimiento" };
  if (d < 0) return { cls: "mal", txt: "Vencida hace " + -d + (d === -1 ? " día" : " días") };
  if (d <= 30) return { cls: "aviso", txt: d === 0 ? "Vence hoy" : "Vence en " + d + (d === 1 ? " día" : " días") };
  return { cls: "ok", txt: "Vigente hasta " + fmtF(g.vencimiento) };
}

/* ---------- datos ---------- */
async function cargarObra() {
  subs = []; subPls = []; garantias = []; rubrosObra = null; sinTablas = false;
  if (obraId) {
    const [a, b, c] = await Promise.all([
      sb.from("subcontratos").select("*").eq("obra_id", obraId).order("numero"),
      sb.from("subcontrato_planillas").select("*").eq("obra_id", obraId).order("numero"),
      sb.from("garantias").select("*").eq("obra_id", obraId).order("vencimiento")
    ]);
    if (a.error || b.error || c.error) sinTablas = true;
    else { subs = a.data || []; subPls = b.data || []; garantias = c.data || []; }
  }
  render();
}
async function cargarRubrosObra() {
  if (rubrosObra) return;
  const { data, error } = await sb.from("rubros").select("id,codigo,descripcion,unidad,cantidad,capitulo").eq("obra_id", obraId).order("orden");
  rubrosObra = error ? [] : data || [];
}

/* ---------- render ---------- */
function setDirty(v) { dirty = v; const e = $("#estado"); if (!["contrato", "planilla", "garantia"].includes(view)) return; e.className = "state" + (v ? " dirty" : ""); e.textContent = v ? "Sin guardar" : "Guardado"; }
// Recuerda qué secciones abrió o cerró el usuario para que no cambien al redibujar
const secAbierta = {};
document.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.sec) secAbierta[view + d.dataset.sec] = d.open; }, true);
function aplicarSecciones() { document.querySelectorAll("details[data-sec]").forEach((d) => { const k = view + d.dataset.sec; if (k in secAbierta) d.open = secAbierta[k]; }); }
function render() { renderBase(); aplicarSecciones(); }
function renderBase() {
  const m = $("#main");
  $("#top").hidden = !user;
  const conDock = ["contrato", "planilla", "garantia"].includes(view);
  $("#dock").hidden = !conDock;
  if (conDock) { $("#btnPDF").hidden = view !== "planilla"; $("#btnVolver").textContent = view === "lista" ? "" : view === "planilla" || (view === "garantia" && volverA === "contrato") ? "← Contrato" : "← Subcontratos"; }
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (!obraId) { m.innerHTML = `<div class="empty"><b>Sin obras asignadas.</b></div>`; return; }
  if (sinTablas) { m.innerHTML = `<div class="empty"><b>Falta activar subcontratos.</b><span>Ejecuta <b>supabase/subcontratos.sql</b> en Supabase → SQL Editor y recarga.</span></div>`; return; }
  if (view === "contrato") return renderContrato(m);
  if (view === "planilla") return renderPlanilla(m);
  if (view === "garantia") return renderGarantia(m);
  renderLista(m);
}
function garantiaFila(g) {
  const e = estadoGar(g), s = subs.find((x) => x.id === g.subcontrato_id);
  return `<button class="rep gar" type="button" data-gar="${esc(g.id)}"><span class="gdot ${e.cls}"></span>
    <span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${esc(TIPOS[g.tipo] || g.tipo)} · ${money(num(g.monto))}</span>
    <span class="d">${g.direccion === "entregada" ? "DLV → mandante" : esc(s ? s.contratista : "Subcontratista")} · ${esc(g.emisor || "")}${g.numero ? " N.° " + esc(g.numero) : ""}</span></span>
    <span class="pill gp-${e.cls}">${esc(e.txt)}</span></button>`;
}
function renderLista(m) {
  const vig = subs.filter((s) => s.estado !== "anulado");
  const monto = vig.reduce((t, s) => t + montoDe(s), 0), plan = vig.reduce((t, s) => t + calcular(s, plsDe(s.id), null).t.acumulado, 0);
  const alerta = garantias.filter((g) => { const e = estadoGar(g); return e.cls === "mal" || e.cls === "aviso"; });
  m.innerHTML = `
  <section class="obracard"><div class="listhead"><h1>${esc(obra().nombre)}</h1></div>
    <div class="kpis"><div><small>Subcontratos</small><b>${vig.length}</b></div><div><small>Monto contratado</small><b>${money(monto)}</b></div><div><small>Planillado</small><b>${money(plan)}</b></div><div><small>Por planillar</small><b>${money(monto - plan)}</b></div></div>
    ${alerta.length ? `<button class="alertbar" type="button" data-tab="garantias"><b>${alerta.length} ${alerta.length === 1 ? "garantía requiere" : "garantías requieren"} atención</b><span>${alerta.map((g) => esc(estadoGar(g).txt)).slice(0, 2).join(" · ")}</span></button>` : ""}
  </section>
  <div class="segtabs" role="tablist"><button type="button" role="tab" data-tab="contratos" aria-selected="${tab === "contratos"}">Contratos (${subs.length})</button><button type="button" role="tab" data-tab="garantias" aria-selected="${tab === "garantias"}">Garantías (${garantias.length})</button></div>
  ${tab === "contratos" ? `
  <div class="listhead"><h1>Cuadro de contratos</h1><button class="btn hivis" type="button" data-act="nuevoSc">+ Subcontrato</button></div>
  <div class="list">${subs.length ? subs.map((s) => { const t = calcular(s, plsDe(s.id), null).t, ev = promedio(s.evaluacion), ok = CHECK.filter(([k]) => (s.checklist || {})[k]).length; return `
    <button class="rep sc" type="button" data-sc="${esc(s.id)}"><span class="n">${String(s.numero).padStart(2, "0")}</span>
      <span style="min-width:0;display:flex;flex-direction:column;gap:3px"><span class="t">${esc(s.contratista)}</span><span class="d">${esc(s.alcance || "Sin alcance")}</span>
        <span class="d">${money(t.monto)} · planillado ${pct(t.avance)} · revisión ${ok}/${CHECK.length}${ev ? " · evaluación " + ev.toFixed(1) + "/5" : ""}</span>
        <span class="meter sm"><i style="width:${Math.min(100, t.avance).toFixed(1)}%"></i></span></span>
      <span class="pill sc-${esc(s.estado)}">${EST_SC[s.estado]}</span></button>`; }).join("")
    : `<div class="empty"><span>Aún no hay subcontratos en esta obra.</span><button class="btn hivis" type="button" data-act="nuevoSc">+ Primer subcontrato</button></div>`}</div>`
  : `
  <div class="listhead"><h1>Garantías y pólizas</h1><button class="btn hivis" type="button" data-act="nuevaGar">+ Garantía</button></div>
  <div class="list">${garantias.length ? garantias.slice().sort((a, b) => (a.estado === "vigente" ? 0 : 1) - (b.estado === "vigente" ? 0 : 1) || String(a.vencimiento || "9").localeCompare(String(b.vencimiento || "9"))).map(garantiaFila).join("")
    : `<div class="empty"><span>Registra las pólizas que te entregan los subcontratistas y las que DLV entrega al mandante, con su vencimiento.</span><button class="btn hivis" type="button" data-act="nuevaGar">+ Primera garantía</button></div>`}</div>`}`;
}
function inp(obj, path, label, type = "text", extra = "") {
  const v = path.split(".").reduce((a, k) => (a == null ? a : a[k]), obj) ?? "";
  const id = "f_" + path.replace(/\./g, "_");
  return `<label class="fld" for="${id}"><span>${label}</span><input id="${id}" type="${type}" data-p="${path}" value="${esc(v)}" ${type === "num" ? "" : ""}${extra}></label>`;
}
function renderContrato(m) {
  const s = sc, c = s.condiciones, pls = s.id ? plsDe(s.id) : [], usados = new Set(pls.flatMap((p) => Object.keys(p.cantidades || {}).filter((k) => num(p.cantidades[k]))));
  const t = calcular(s, pls, null).t, ok = CHECK.filter(([k]) => s.checklist[k]).length, gs = garantias.filter((g) => s.id && g.subcontrato_id === s.id);
  const N = (path, label) => inp(s, path, label, "text", ' inputmode="decimal"');
  m.innerHTML = `
  <details class="sec" data-sec="s1" open><summary><span class="num">SC</span><h2>${s.id ? "Subcontrato N.° " + esc(s.numero) : "Nuevo subcontrato"}</h2><span class="sum">${EST_SC[s.estado]}</span></summary><div class="body">
    ${inp(s, "contratista", "Subcontratista (razón social o nombre)")}
    <div class="grid2">${inp(s, "ruc", "RUC / cédula")}${inp(s, "contacto", "Contacto")}</div>
    <div class="grid2">${inp(s, "telefono", "Teléfono", "tel")}${inp(s, "email", "Correo", "email")}</div>
    <label class="fld" for="f_alcance"><span>Alcance del trabajo</span><textarea id="f_alcance" data-p="alcance" placeholder="Ej.: Mampostería de bloque y enlucidos, pisos 1 a 5">${esc(s.alcance || "")}</textarea></label>
    <div class="grid3">${inp(s, "numero", "Contrato N.°", "number", ' inputmode="numeric"')}${inp(s, "inicio", "Inicio", "date")}${inp(s, "fin", "Término", "date")}</div>
    <label class="fld" for="f_estado"><span>Estado</span><select id="f_estado" data-p="estado">${Object.entries(EST_SC).map(([k, v]) => `<option value="${k}"${s.estado === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
  </div></details>
  <details class="sec" data-sec="s2"${s.items.length ? "" : " open"}><summary><span class="num">${s.items.length}</span><h2>Rubros del contrato</h2><span class="sum">${money(montoDe(s))}</span></summary><div class="body">
    <div class="rows">${s.items.map((it, i) => `
      <div class="r r-it"><label class="fld"><span>Cód.</span><input type="text" data-p="items.${i}.codigo" value="${esc(it.codigo || "")}"></label>
        <label class="fld"><span>Descripción</span><input type="text" data-p="items.${i}.descripcion" value="${esc(it.descripcion || "")}"></label>
        ${usados.has(it.id) ? `<span class="x" title="Ya tiene planillas">·</span>` : `<button class="x" type="button" data-delit="${i}" aria-label="Quitar rubro">×</button>`}
        <div class="ext"><label class="fld"><span>Und</span><input type="text" data-p="items.${i}.unidad" value="${esc(it.unidad || "")}"></label>
          <label class="fld"><span>Cantidad</span><input type="text" inputmode="decimal" data-p="items.${i}.cantidad" value="${esc(it.cantidad ?? "")}"></label>
          <label class="fld"><span>P. unitario</span><input type="text" inputmode="decimal" data-p="items.${i}.precio" value="${esc(it.precio ?? "")}"></label>
          <div class="fld"><span>Total</span><div class="acum" id="tot_${i}">${money(num(it.cantidad) * num(it.precio))}</div></div></div></div>`).join("") || `<span class="code">Agrega los rubros que ejecutará el subcontratista con su precio.</span>`}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm add" type="button" data-act="addIt">+ Rubro</button><button class="btn sm" type="button" data-act="verPegar">Pegar desde Excel</button><button class="btn sm" type="button" data-act="verRubrosObra">Traer del presupuesto de la obra</button></div>
    ${pegar !== null && pegar !== false ? `<div class="pastebox"><span class="code">Columnas: Código · Descripción · Unidad · Cantidad · Precio unitario</span><textarea id="pegarTxt" rows="5">${esc(pegar)}</textarea><div><button class="btn sm primary" type="button" data-act="pegarOk">Agregar rubros</button> <button class="btn sm ghost" type="button" data-act="pegarNo">Cancelar</button></div></div>` : ""}
    ${elegirRubros ? `<div class="pastebox"><span class="code">${rubrosObra && rubrosObra.length ? "Marca los rubros del presupuesto que hará este subcontratista; luego pon su precio unitario." : "La obra no tiene presupuesto cargado en Estado de pago."}</span>
      <div class="pick">${(rubrosObra || []).map((r) => `<label class="chk" for="rp_${esc(r.id)}"><input type="checkbox" id="rp_${esc(r.id)}" data-rp="${esc(r.id)}"><span><span class="cod">${esc(r.codigo || "")}</span> ${esc(r.descripcion)} <span class="nm">${qty(num(r.cantidad))} ${esc(r.unidad || "")}</span></span></label>`).join("")}</div>
      <div>${rubrosObra && rubrosObra.length ? `<button class="btn sm primary" type="button" data-act="rubrosOk">Agregar marcados</button> ` : ""}<button class="btn sm ghost" type="button" data-act="rubrosNo">Cerrar</button></div></div>` : ""}
  </div></details>
  <details class="sec" data-sec="s3"><summary><span class="num">%</span><h2>Condiciones de pago</h2><span class="sum">anticipo ${esc(c.anticipo_pct)} % · garantía ${esc(c.ret_pct)} %</span></summary><div class="body">
    <div class="grid3">${N("condiciones.anticipo_pct", "Anticipo (%)")}${N("condiciones.ret_pct", "Fondo de garantía (%)")}${N("condiciones.iva_pct", "IVA (%)")}</div>
    <div class="grid2">${N("condiciones.ret_renta_pct", "Retención renta (%)")}${N("condiciones.ret_iva_pct", "Retención IVA (% del IVA)")}</div>
    <span class="code">DLV como agente de retención: renta sobre la base y retención del IVA según el tipo de contribuyente del subcontratista. El fondo de garantía se devuelve al recibir el trabajo.</span>
  </div></details>
  <details class="sec" data-sec="s4"><summary><span class="num">${ok}/${CHECK.length}</span><h2>Revisión antes de firmar</h2><span class="sum">${ok === CHECK.length ? "completa" : "pendiente"}</span></summary><div class="body">
    <div class="checks">${CHECK.map(([k, l]) => `<label class="chk" for="ck_${k}"><input type="checkbox" id="ck_${k}" data-ck="${k}"${s.checklist[k] ? " checked" : ""}>${l}</label>`).join("")}</div>
  </div></details>
  ${s.id ? `
  <details class="sec" data-sec="s5" open><summary><span class="num">${pls.length}</span><h2>Planillas del subcontratista</h2><span class="sum">${pct(t.avance)} · saldo ${money(t.saldo)}</span></summary><div class="body">
    <div class="meter"><i style="width:${Math.min(100, t.avance).toFixed(1)}%"></i></div>
    <div class="list">${pls.slice().reverse().map((p) => `<button class="rep" type="button" data-pl="${esc(p.id)}"><span class="n">${String(p.numero).padStart(2, "0")}</span>
      <span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${p.desde ? fmtF(p.desde) + " – " + fmtF(p.hasta) : fmtF(p.fecha)}</span><span class="d">${money((p.totales || {}).bruto)} · a pagar ${money((p.totales || {}).liquido)}</span></span>
      <span class="pill est-${esc(p.estado)}">${EST_PL[p.estado]}</span></button>`).join("") || `<span class="code">Sin planillas todavía.</span>`}</div>
    ${s.items.length ? `<div><button class="btn sm hivis" type="button" data-act="nuevaPl">+ Planilla</button></div>` : ""}
  </div></details>
  <details class="sec" data-sec="s6"${gs.length ? " open" : ""}><summary><span class="num">${gs.length}</span><h2>Pólizas de este contrato</h2></summary><div class="body">
    <div class="list">${gs.map(garantiaFila).join("") || `<span class="code">Registra la póliza de buen uso del anticipo (${money(t.anticipo)}) y la de fiel cumplimiento.</span>`}</div>
    <div><button class="btn sm" type="button" data-act="nuevaGarSc">+ Póliza</button></div>
  </div></details>
  <details class="sec" data-sec="s7"${s.estado === "terminado" ? " open" : ""}><summary><span class="num">★</span><h2>Evaluación al cierre</h2><span class="sum">${promedio(s.evaluacion) ? promedio(s.evaluacion).toFixed(1) + " / 5" : "sin evaluar"}</span></summary><div class="body">
    <span class="code">1 = deficiente · 5 = excelente. Sirve para decidir si se le vuelve a contratar.</span>
    ${CRIT.map(([k, l]) => `<div class="rate"><span>${l}</span><div class="stars" role="group" aria-label="${l}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-ev="${k}" data-n="${n}" aria-pressed="${num((s.evaluacion || {})[k]) >= n}" aria-label="${n}">${n}</button>`).join("")}</div></div>`).join("")}
    <label class="chk" for="evRec"><input type="checkbox" id="evRec" data-evrec="1"${(s.evaluacion || {}).recomendado ? " checked" : ""}>Lo volvería a contratar</label>
    <label class="fld" for="evCom"><span>Comentario</span><textarea id="evCom" data-evcom="1">${esc((s.evaluacion || {}).comentario || "")}</textarea></label>
  </div></details>` : `<span class="code">Guarda el contrato para registrar planillas y pólizas.</span>`}
  ${s.id && esAdmin() && !pls.length ? (confirm === "sc" ? `<div class="confirm"><span>¿Borrar este subcontrato?</span><button class="btn sm danger" type="button" data-act="delScOk">Sí, borrar</button><button class="btn sm" type="button" data-act="noDel">Cancelar</button></div>` : `<div><button class="btn sm danger" type="button" data-act="delSc">Borrar subcontrato</button></div>`) : ""}`;
  setDirty(dirty);
}
function renderPlanilla(m) {
  const s = sc, d = pl, bloq = d.estado !== "borrador";
  const { lineas, t } = calcular(s, plsDe(s.id), d);
  const q = filtro.trim().toLowerCase();
  const filas = lineas.map((l) => {
    const it = l.it;
    if (q && !((it.codigo || "") + " " + it.descripcion).toLowerCase().includes(q)) return "";
    if (soloConCant && !l.per) return "";
    return `<div class="pl${l.per ? " con" : ""}${l.excede ? " exc" : ""}">
      <div class="h"><span class="cod">${esc(it.codigo || "")}</span><span class="ds">${esc(it.descripcion)}</span></div>
      <div class="g"><div><small>Contratado</small><span>${qty(l.con)} ${esc(it.unidad || "")}</span></div><div><small>Anterior</small><span>${qty(l.ant)}</span></div>
        <label class="per" for="q_${esc(it.id)}"><small>Este período</small><input id="q_${esc(it.id)}" type="text" inputmode="decimal" data-q="${esc(it.id)}" value="${l.per ? esc(String(d.cantidades[it.id])) : ""}" placeholder="0" ${bloq ? "disabled" : ""}></label>
        <div><small>Acumulado</small><span id="ac_${esc(it.id)}">${qty(l.acu)} · ${pct(l.con > 0 ? l.acu / l.con * 100 : 0)}</span></div><div><small>Valor período</small><span id="vp_${esc(it.id)}" class="b">${money(l.vPer)}</span></div></div>
      ${l.excede ? `<span class="warnline">Supera la cantidad del contrato.</span>` : ""}</div>`;
  }).join("");
  m.innerHTML = `
  <details class="sec" data-sec="s8" open><summary><span class="num">PS</span><h2>${esc(s.contratista)} · Planilla ${esc(d.numero)}</h2><span class="sum">${EST_PL[d.estado]}</span></summary><div class="body">
    <div class="grid3">${inp(d, "numero", "Número", "number", bloq ? " disabled" : "")}${inp(d, "fecha", "Fecha", "date", bloq ? " disabled" : "")}
      <label class="fld" for="f_estado"><span>Estado</span><select id="f_estado" data-p="estado">${Object.entries(EST_PL).map(([k, v]) => `<option value="${k}"${d.estado === k ? " selected" : ""}${!esAdmin() && (k === "aprobada" || k === "pagada") && d.estado !== k ? " disabled" : ""}>${v}</option>`).join("")}</select></label></div>
    <div class="grid2">${inp(d, "desde", "Período desde", "date", bloq ? " disabled" : "")}${inp(d, "hasta", "Período hasta", "date", bloq ? " disabled" : "")}</div>
    <div class="grid2">${inp(d, "config.multas", "Multas ($)", "text", ' inputmode="decimal"' + (bloq ? " disabled" : ""))}${inp(d, "config.descuentos", "Otros descuentos ($)", "text", ' inputmode="decimal"' + (bloq ? " disabled" : ""))}</div>
    <label class="fld" for="f_config_nota"><span>Observaciones</span><textarea id="f_config_nota" data-p="config.nota" ${bloq ? "disabled" : ""}>${esc(d.config.nota || "")}</textarea></label>
  </div></details>
  <section class="sumcard" id="sumcard">${resumen(t, s.condiciones)}</section>
  <details class="sec" data-sec="s9" open><summary><span class="num">${lineas.filter((l) => l.per).length}</span><h2>Cantidades del período</h2></summary><div class="body">
    <div class="tools2"><label class="fld" for="fBus"><span class="vh">Buscar</span><input id="fBus" type="text" placeholder="Buscar rubro…" value="${esc(filtro)}" autocomplete="off"></label>
      <label class="chk" for="fSolo"><input type="checkbox" id="fSolo"${soloConCant ? " checked" : ""}>Solo con cantidad</label></div>
    <div class="pls">${filas || `<span class="code">Ningún rubro coincide.</span>`}</div>
  </div></details>
  ${d.id && esAdmin() && d.estado === "borrador" ? (confirm === "pl" ? `<div class="confirm"><span>¿Borrar esta planilla?</span><button class="btn sm danger" type="button" data-act="delPlOk">Sí, borrar</button><button class="btn sm" type="button" data-act="noDel">Cancelar</button></div>` : `<div><button class="btn sm danger" type="button" data-act="delPl">Borrar planilla</button></div>`) : ""}`;
  setDirty(dirty);
}
function resumen(t, c) {
  const row = (k, v, cls = "") => `<div class="${cls}"><span>${k}</span><b>${v}</b></div>`;
  return `<div class="sumgrid">${row("Valor de esta planilla", money(t.bruto), "big")}${row("Avance del contrato", pct(t.avance))}
    ${row("(−) Amortización anticipo", money(t.amort))}${t.ret ? row("(−) Fondo de garantía " + pl2(c.ret_pct) + " %", money(t.ret)) : ""}
    ${t.multas ? row("(−) Multas", money(t.multas)) : ""}${t.descuentos ? row("(−) Otros descuentos", money(t.descuentos)) : ""}
    ${row("(+) IVA " + pl2(c.iva_pct) + " %", money(t.iva))}${t.retRenta ? row("(−) Retención renta " + pl2(c.ret_renta_pct) + " %", money(t.retRenta)) : ""}${t.retIva ? row("(−) Retención IVA " + pl2(c.ret_iva_pct) + " %", money(t.retIva)) : ""}
    ${row("A pagar al subcontratista", money(t.liquido), "big tot")}</div>
    <span class="code">Anterior ${money(t.anterior)} · acumulado ${money(t.acumulado)} · saldo del contrato ${money(t.saldo)} · fondo de garantía retenido ${money(t.retAcum)}</span>`;
}
function renderGarantia(m) {
  const g = gar, sel = (path, label, opts) => { const v = path.split(".").reduce((a, k) => a[k], g); return `<label class="fld" for="f_${path}"><span>${label}</span><select id="f_${path}" data-p="${path}">${opts.map(([k, l]) => `<option value="${esc(k)}"${v === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`; };
  const s = subs.find((x) => x.id === g.subcontrato_id);
  const sug = s ? (g.tipo === "buen_uso" ? montoDe(s) * num(s.condiciones.anticipo_pct) / 100 : g.tipo === "fiel_cumplimiento" ? montoDe(s) * 0.05 : 0) : 0;
  m.innerHTML = `<details class="sec" data-sec="s10" open><summary><span class="num">G</span><h2>${g.id ? "Garantía" : "Nueva garantía"}</h2><span class="sum">${esc(estadoGar(g).txt)}</span></summary><div class="body">
    ${sel("direccion", "Quién la entrega", [["recibida", "Subcontratista → DLV"], ["entregada", "DLV → mandante"]])}
    ${g.direccion === "recibida" ? sel("subcontrato_id", "Subcontrato", [["", "—"], ...subs.map((x) => [x.id, String(x.numero).padStart(2, "0") + " · " + x.contratista])]) : ""}
    <div class="grid2">${sel("tipo", "Tipo", Object.entries(TIPOS))}${sel("estado", "Estado", Object.entries(EST_G))}</div>
    <div class="grid2">${inp(g, "emisor", "Aseguradora o banco")}${inp(g, "numero", "N.° de póliza")}</div>
    ${inp(g, "monto", "Monto asegurado ($)", "text", ' inputmode="decimal"')}
    ${sug ? `<span class="code">Sugerido para este contrato: ${money(sug)}${g.tipo === "fiel_cumplimiento" ? " (5 % del monto)" : " (100 % del anticipo)"}</span>` : ""}
    <div class="grid2">${inp(g, "emision", "Emisión", "date")}${inp(g, "vencimiento", "Vencimiento", "date")}</div>
    <label class="fld" for="f_notas"><span>Notas</span><textarea id="f_notas" data-p="notas" placeholder="Ej.: renovar 15 días antes; original en archivo de obra">${esc(g.notas || "")}</textarea></label>
    ${g.id && esAdmin() ? (confirm === "g" ? `<div class="confirm"><span>¿Borrar esta garantía?</span><button class="btn sm danger" type="button" data-act="delGOk">Sí, borrar</button><button class="btn sm" type="button" data-act="noDel">Cancelar</button></div>` : `<div><button class="btn sm danger" type="button" data-act="delG">Borrar garantía</button></div>`) : ""}
  </div></details>`;
  setDirty(dirty);
}

/* ---------- acciones ---------- */
function abrirSc(s) {
  sc = s ? JSON.parse(JSON.stringify(s)) : { obra_id: obraId, numero: subs.reduce((m, x) => Math.max(m, x.numero), 0) + 1, contratista: "", items: [], condiciones: {}, checklist: {}, estado: "borrador", inicio: hoy() };
  sc.condiciones = { anticipo_pct: 0, ret_pct: 5, iva_pct: 15, ret_renta_pct: 1.75, ret_iva_pct: 30, ...(sc.condiciones || {}) };
  sc.checklist = sc.checklist || {}; sc.items = sc.items || [];
  for (const k in secAbierta) delete secAbierta[k];
  pegar = false; elegirRubros = false; confirm = null; view = "contrato"; dirty = !s; render(); window.scrollTo(0, 0);
}
async function guardarSc() {
  const s = sc;
  if (!(s.contratista || "").trim()) return toast("Escribe el nombre del subcontratista.");
  const items = s.items.filter((it) => (it.descripcion || "").trim()).map((it) => ({ id: it.id || uid(), codigo: it.codigo || "", descripcion: it.descripcion.trim(), unidad: it.unidad || "", cantidad: num(it.cantidad), precio: num(it.precio) }));
  const cond = {}; for (const [k, v] of Object.entries(s.condiciones)) cond[k] = num(v);
  const row = { obra_id: obraId, numero: parseInt(s.numero, 10) || 1, contratista: s.contratista.trim(), ruc: s.ruc || null, contacto: s.contacto || null, telefono: s.telefono || null, email: s.email || null,
    alcance: s.alcance || null, items, monto: r2(items.reduce((t, it) => t + it.cantidad * it.precio, 0)), condiciones: cond, checklist: s.checklist, evaluacion: s.evaluacion || null,
    inicio: s.inicio || null, fin: s.fin || null, estado: s.estado, notas: s.notas || null, actualizado: new Date().toISOString() };
  const btn = $("#btnGuardar"); btn.disabled = true;
  try {
    const { data, error } = s.id ? await sb.from("subcontratos").update(row).eq("id", s.id).select().single() : await sb.from("subcontratos").insert(row).select().single();
    if (error) throw error;
    const i = subs.findIndex((x) => x.id === data.id); if (i >= 0) subs[i] = data; else subs.push(data); subs.sort((a, b) => a.numero - b.numero);
    sc = JSON.parse(JSON.stringify(data)); sc.condiciones = { ...cond }; sc.checklist = sc.checklist || {};
    setDirty(false); render(); toast("Subcontrato guardado");
  } catch (err) { toast(String(err.code) === "23505" ? "Ya existe un subcontrato con ese número en la obra." : "No se pudo guardar: " + (err.message || "revisa tu conexión")); }
  finally { btn.disabled = false; }
}
function nuevaPl() {
  const ps = plsDe(sc.id), n = ps.reduce((m, p) => Math.max(m, p.numero), 0) + 1, prev = ps.find((p) => p.numero === n - 1);
  let desde = ""; if (prev && prev.hasta) { const [y, m, d] = prev.hasta.split("-").map(Number); desde = ymd(new Date(y, m - 1, d + 1)); }
  pl = { subcontrato_id: sc.id, obra_id: obraId, numero: n, fecha: hoy(), desde, hasta: desde && desde > hoy() ? "" : hoy(), estado: "borrador", cantidades: {}, config: { multas: "", descuentos: "", nota: "" } };
  filtro = ""; soloConCant = false; confirm = null; view = "planilla"; dirty = true; render(); window.scrollTo(0, 0);
}
async function guardarPl() {
  const d = pl; d.numero = parseInt(d.numero, 10) || 1;
  const cant = {}; for (const [k, v] of Object.entries(d.cantidades || {})) if (num(v)) cant[k] = num(v);
  const cfg = { multas: num(d.config.multas), descuentos: num(d.config.descuentos), nota: d.config.nota || "" };
  const { t } = calcular(sc, plsDe(sc.id), { ...d, cantidades: cant, config: cfg });
  const row = { subcontrato_id: sc.id, obra_id: obraId, numero: d.numero, fecha: d.fecha || hoy(), desde: d.desde || null, hasta: d.hasta || null, estado: d.estado, cantidades: cant, config: cfg, totales: t, actualizado: new Date().toISOString() };
  const btn = $("#btnGuardar"); btn.disabled = true;
  try {
    const { data, error } = d.id ? await sb.from("subcontrato_planillas").update(row).eq("id", d.id).select().single() : await sb.from("subcontrato_planillas").insert(row).select().single();
    if (error) throw error;
    const i = subPls.findIndex((x) => x.id === data.id); if (i >= 0) subPls[i] = data; else subPls.push(data);
    pl = JSON.parse(JSON.stringify(data)); setDirty(false); render(); toast("Planilla guardada");
  } catch (err) { toast(String(err.code) === "23505" ? "Ya existe una planilla con ese número." : "No se pudo guardar: " + (err.message || "revisa tu conexión")); }
  finally { btn.disabled = false; }
}
function abrirGar(g, desdeContrato) {
  gar = g ? JSON.parse(JSON.stringify(g)) : { obra_id: obraId, direccion: "recibida", subcontrato_id: desdeContrato && sc ? sc.id : "", tipo: "fiel_cumplimiento", estado: "vigente", emisor: "", numero: "", monto: "", emision: hoy(), vencimiento: "", notas: "" };
  volverA = desdeContrato ? "contrato" : "lista"; confirm = null; view = "garantia"; dirty = !g; render(); window.scrollTo(0, 0);
}
async function guardarGar() {
  const g = gar;
  if (!num(g.monto)) return toast("Escribe el monto asegurado.");
  if (!g.vencimiento) return toast("Pon la fecha de vencimiento para recibir el aviso.");
  const row = { obra_id: obraId, subcontrato_id: g.direccion === "recibida" && g.subcontrato_id ? g.subcontrato_id : null, direccion: g.direccion, tipo: g.tipo, emisor: g.emisor || null, numero: g.numero || null,
    monto: num(g.monto), emision: g.emision || null, vencimiento: g.vencimiento, estado: g.estado, notas: g.notas || null };
  const { data, error } = g.id ? await sb.from("garantias").update(row).eq("id", g.id).select().single() : await sb.from("garantias").insert(row).select().single();
  if (error) return toast("No se pudo guardar: " + error.message);
  const i = garantias.findIndex((x) => x.id === data.id); if (i >= 0) garantias[i] = data; else garantias.push(data);
  toast("Garantía guardada"); dirty = false; volver();
}
function volver() {
  if (view === "planilla") { view = "contrato"; pl = null; }
  else if (view === "garantia" && volverA === "contrato" && sc) { view = "contrato"; gar = null; }
  else { view = "lista"; sc = null; gar = null; if (volverA === "lista" && gar === null && tab === "garantias") tab = "garantias"; }
  dirty = false; confirm = null; render(); window.scrollTo(0, 0);
}
async function borrar(tabla, id) {
  const { error } = await sb.from(tabla).delete().eq("id", id);
  if (error) { toast("No se pudo borrar."); return false; }
  return true;
}

/* ---------- PDF de la planilla del subcontratista ---------- */
function generarPDF() {
  if (!window.jspdf) return toast("No se cargó el generador de PDF. Revisa tu conexión y recarga.");
  const s = sc, d = pl, o = obra(), c = s.condiciones, { lineas, t } = calcular(s, plsDe(s.id), d);
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "landscape" }); { const _t = doc.text.bind(doc), _l = (s) => typeof s === "string" ? s.replace(/[\u2212\u2013]/g, "-").replace(/\u2713/g, "»").replace(/\u2610/g, "[  ]").replace(/[\u2605\u2606]/g, "*").replace(/\u2197/g, ">").replace(/\u2199/g, "<").replace(/\u2192/g, "->") : s; doc.text = (s, ...a) => _t(Array.isArray(s) ? s.map(_l) : _l(s), ...a); }
  const M = 10, W = 277, NAVY = [29, 53, 87], AMB = [232, 163, 23], GRID = [150, 150, 150], LBL = [236, 235, 227], SUB = [217, 222, 230];
  const fit = (x, w) => { x = String(x ?? ""); while (x && doc.getTextWidth(x) > w) x = x.slice(0, -2) + "…"; return x; };
  let pagina = 1;
  const header = (sub) => {
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.rect(M, M, W, 18); doc.line(M + 48, M, M + 48, M + 18); doc.line(M + W - 52, M, M + W - 52, M + 18);
    doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("DLV", M + 5, M + 9.5); doc.setFillColor(...AMB); doc.rect(M + 5, M + 10.8, 15, 1, "F");
    doc.setFontSize(6.4); doc.text("CONSTRUCCIONES CÍA. LTDA.", M + 5, M + 14.6);
    doc.setFontSize(12.5); doc.text("PLANILLA DE SUBCONTRATO N.° " + String(d.numero).padStart(2, "0"), M + 48 + (W - 100) / 2, M + 8.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85, 85, 85); doc.text(sub, M + 48 + (W - 100) / 2, M + 13.2, { align: "center" });
    [["FECHA", fmtF(d.fecha)], ["PERÍODO", d.desde ? fmtF(d.desde) + " – " + fmtF(d.hasta) : "—"], ["CONTRATO", "SC-" + String(s.numero).padStart(2, "0")]].forEach(([k, v], i) => {
      const x = M + W - 52, yy = M + i * 6; if (i) doc.line(x, yy, M + W, yy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4);
      doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(v, M + W - 1.5, yy + 4, { align: "right" });
    });
    return M + 21;
  };
  const footer = () => { doc.setFont("helvetica", "normal"); doc.setFontSize(5.6); doc.setTextColor(120, 120, 120); doc.text("DLV Construcciones Cía. Ltda. · " + (o.nombre || "") + " · " + s.contratista, M, 203); doc.text("Página " + pagina, M + W, 203, { align: "right" }); };
  let y = header("Carátula, balance del contrato y liquidación");
  doc.setFontSize(7);
  [["OBRA", o.nombre], ["SUBCONTRATISTA", s.contratista], ["RUC / CÉDULA", s.ruc], ["ALCANCE", s.alcance], ["CONTACTO", [s.contacto, s.telefono].filter(Boolean).join(" · ")], ["PLAZO", (s.inicio ? fmtF(s.inicio) : "") + (s.fin ? " – " + fmtF(s.fin) : "")]].forEach(([k, v], i) => {
    const x = M + (i % 2) * (W / 2), yy = y + Math.floor(i / 2) * 6;
    doc.setFillColor(...LBL); doc.rect(x, yy, 30, 6, "F"); doc.setDrawColor(...GRID); doc.rect(x, yy, W / 2, 6);
    doc.setFont("helvetica", "bold"); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4);
    doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(fit(v || "—", W / 2 - 34), x + 32, yy + 4);
  });
  y += 23;
  const box = (x, w, title, rows) => {
    doc.setFillColor(...NAVY); doc.rect(x, y, w, 5.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(7.2); doc.setTextColor(255, 255, 255); doc.text(title, x + 2, y + 3.8);
    rows.forEach(([k, v, strong], i) => { const yy = y + 5.5 + i * 5.8; if (strong) { doc.setFillColor(...SUB); doc.rect(x, yy, w, 5.8, "F"); } doc.setDrawColor(...GRID); doc.rect(x, yy, w, 5.8);
      doc.setFont("helvetica", strong ? "bold" : "normal"); doc.setFontSize(7.2); doc.setTextColor(30, 30, 30); doc.text(k, x + 2, yy + 4); doc.text(money(v), x + w - 2, yy + 4, { align: "right" }); });
    return y + 5.5 + rows.length * 5.8;
  };
  const w2 = (W - 8) / 2;
  const liq = [["Valor de esta planilla", t.bruto], ["(−) Amortización anticipo (" + pl2(c.anticipo_pct) + " %)", -t.amort], ["(−) Fondo de garantía (" + pl2(c.ret_pct) + " %)", -t.ret], ["(−) Multas", -t.multas], ["(−) Otros descuentos", -t.descuentos],
    ["(+) IVA " + pl2(c.iva_pct) + " %", t.iva], ["(−) Retención renta " + pl2(c.ret_renta_pct) + " %", -t.retRenta], ["(−) Retención IVA " + pl2(c.ret_iva_pct) + " %", -t.retIva], ["A PAGAR AL SUBCONTRATISTA", t.liquido, true]];
  const y1 = box(M, w2, "BALANCE DEL CONTRATO", [["Monto del contrato", t.monto], ["Planillado anterior", t.anterior], ["ESTA PLANILLA", t.bruto, true], ["Planillado acumulado", t.acumulado], ["Saldo del contrato", t.saldo], ["Anticipo entregado", t.anticipo], ["Saldo de anticipo", t.saldoAnticipo], ["Fondo de garantía retenido", t.retAcum]]);
  const y2 = box(M + w2 + 8, w2, "LIQUIDACIÓN", liq);
  y = Math.max(y1, y2) + 4;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(60, 60, 60); doc.text("Avance del contrato: " + pct(t.avance), M, y);
  if (d.config.nota) { const ls = doc.splitTextToSize("Observaciones: " + d.config.nota, W); doc.text(ls.slice(0, 2), M, y + 4); }
  const fy = 170, fw = (W - 16) / 3;
  [["SUBCONTRATISTA", s.contratista], ["RESIDENTE DE OBRA · DLV", o.residente || ""], ["GERENTE DE PROYECTO · DLV", o.gerente || ""]].forEach(([tt, n], i) => {
    const x = M + i * (fw + 8); doc.setFillColor(...NAVY); doc.rect(x, fy, fw, 4, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); doc.setTextColor(255, 255, 255); doc.text(tt, x + fw / 2, fy + 2.8, { align: "center" });
    doc.setDrawColor(...GRID); doc.rect(x, fy + 4, fw, 20); doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(60, 60, 60); doc.text(fit(n || "Nombre / firma", fw - 26), x + 2, fy + 22); doc.text("___/___/______", x + fw - 2, fy + 22, { align: "right" });
  });
  footer();
  const cols = [["CÓD.", 14, "l"], ["DESCRIPCIÓN", 80, "l"], ["UND", 10, "c"], ["CANT. CONTR.", 18, "r"], ["P. UNIT.", 18, "r"], ["TOTAL CONTR.", 24, "r"], ["CANT. ANT.", 18, "r"], ["CANT. PERÍODO", 18, "r"], ["CANT. ACUM.", 18, "r"], ["VALOR PERÍODO", 24, "r"], ["VALOR ACUM.", 24, "r"], ["% AV.", 11, "r"]];
  const head = (yy) => { let x = M; doc.setFillColor(...NAVY); doc.rect(M, yy, W, 6, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(255, 255, 255);
    for (const [h, w, al] of cols) { doc.text(h, al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, yy + 4, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; } return yy + 6; };
  const nueva = () => { doc.addPage("a4", "landscape"); pagina++; const yy = header("Detalle por rubro"); footer(); return head(yy); };
  y = nueva();
  const linea = (vals, opt = {}) => {
    if (y + 4.6 > 198) y = nueva();
    if (opt.fill) { doc.setFillColor(...opt.fill); doc.rect(M, y, W, 4.6, "F"); }
    doc.setDrawColor(210, 210, 210); doc.line(M, y + 4.6, M + W, y + 4.6);
    let x = M; doc.setFont("helvetica", opt.bold ? "bold" : "normal"); doc.setFontSize(6.2); doc.setTextColor(30, 30, 30);
    cols.forEach(([, w, al], i) => { const v = vals[i]; if (v != null && v !== "") doc.text(fit(v, w - 2.4), al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, y + 3.2, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; });
    y += 4.6;
  };
  for (const l of lineas) linea([l.it.codigo, l.it.descripcion, l.it.unidad, qty(l.con), money(l.pu), money(l.vCon), qty(l.ant), l.per ? qty(l.per) : "", qty(l.acu), l.per ? money(l.vPer) : "", money(l.vAcu), pct(l.con > 0 ? l.acu / l.con * 100 : 0)], l.per ? { fill: [255, 247, 224] } : {});
  linea(["", "TOTALES", "", "", "", money(t.monto), "", "", "", money(t.bruto), money(t.acumulado), pct(t.avance)], { bold: true, fill: SUB });
  const name = `PS-${String(s.numero).padStart(2, "0")}-${String(d.numero).padStart(2, "0")} ${s.contratista.replace(/[\\/:*?"<>|]/g, "")} ${d.fecha}.pdf`;
  const blob = doc.output("blob"), file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch((e) => { if (e.name !== "AbortError") doc.save(name); });
  else doc.save(name);
}

/* ---------- eventos ---------- */
const setP = (o, p, v) => { const ks = p.split("."); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]] = a[ks[i]] ?? {}; a[ks[ks.length - 1]] = v; };
const objActual = () => view === "contrato" ? sc : view === "planilla" ? pl : view === "garantia" ? gar : null;
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.q && pl) {
    pl.cantidades[t.dataset.q] = t.value; setDirty(true); t.closest(".pl").classList.toggle("con", !!num(t.value));
    const { lineas, t: tt } = calcular(sc, plsDe(sc.id), pl), l = lineas.find((x) => x.it.id === t.dataset.q);
    if (l) { $("#ac_" + CSS.escape(l.it.id)).textContent = qty(l.acu) + " · " + pct(l.con > 0 ? l.acu / l.con * 100 : 0); $("#vp_" + CSS.escape(l.it.id)).textContent = money(l.vPer); t.closest(".pl").classList.toggle("exc", l.excede); }
    $("#sumcard").innerHTML = resumen(tt, sc.condiciones); return;
  }
  if (t.id === "fBus") { filtro = t.value; const p = t.selectionStart; render(); const b = $("#fBus"); b.focus(); b.setSelectionRange(p, p); return; }
  if (t.id === "pegarTxt") { pegar = t.value; return; }
  if (t.dataset.evcom && sc) { sc.evaluacion = { ...(sc.evaluacion || {}), comentario: t.value }; setDirty(true); return; }
  if (t.dataset.p) {
    const o = objActual(); if (!o) return; setP(o, t.dataset.p, t.value); setDirty(true);
    const mm = t.dataset.p.match(/^items\.(\d+)\.(cantidad|precio)$/);
    if (mm) { const it = sc.items[+mm[1]], el = $("#tot_" + mm[1]); if (el) el.textContent = money(num(it.cantidad) * num(it.precio)); }
    if (t.dataset.p === "config.multas" || t.dataset.p === "config.descuentos") $("#sumcard").innerHTML = resumen(calcular(sc, plsDe(sc.id), pl).t, sc.condiciones);
  }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "obraSel") { obraId = t.value; try { localStorage.setItem("dlv-obra", obraId); } catch (_) {} view = "lista"; sc = pl = gar = null; cargarObra(); return; }
  if (t.id === "fSolo") { soloConCant = t.checked; render(); return; }
  if (t.dataset.ck && sc) { sc.checklist[t.dataset.ck] = t.checked; setDirty(true); return; }
  if (t.dataset.evrec && sc) { sc.evaluacion = { ...(sc.evaluacion || {}), recomendado: t.checked }; setDirty(true); return; }
  if (t.tagName === "SELECT" && t.dataset.p) { const o = objActual(); setP(o, t.dataset.p, t.value); setDirty(true); render(); }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
  if (b.dataset.sc) return abrirSc(subs.find((x) => x.id === b.dataset.sc));
  if (b.dataset.pl) { const p = subPls.find((x) => x.id === b.dataset.pl); pl = JSON.parse(JSON.stringify(p)); pl.config = pl.config || {}; filtro = ""; soloConCant = p.estado !== "borrador"; confirm = null; view = "planilla"; dirty = false; render(); window.scrollTo(0, 0); return; }
  if (b.dataset.gar) return abrirGar(garantias.find((x) => x.id === b.dataset.gar), view === "contrato");
  if (b.dataset.delit && sc) { sc.items.splice(+b.dataset.delit, 1); setDirty(true); render(); return; }
  if (b.dataset.ev && sc) { sc.evaluacion = { ...(sc.evaluacion || {}), [b.dataset.ev]: +b.dataset.n, fecha: hoy() }; setDirty(true); render(); return; }
  const a = b.dataset.act;
  if (a === "nuevoSc") return abrirSc(null);
  if (a === "nuevaGar") return abrirGar(null, false);
  if (a === "nuevaGarSc") return abrirGar(null, true);
  if (a === "addIt") { sc.items.push({ id: uid(), codigo: "", descripcion: "", unidad: "", cantidad: "", precio: "" }); setDirty(true); render(); return; }
  if (a === "verPegar") { pegar = ""; elegirRubros = false; render(); return; }
  if (a === "pegarNo") { pegar = false; render(); return; }
  if (a === "pegarOk") {
    const txt = $("#pegarTxt").value, modo = formatoNumeros(txt); let n = 0;
    for (const raw of txt.split(/\r?\n/)) {
      const c = raw.split("\t").map((x) => x.trim()); if (c.length < 4) continue;
      const [codigo, descripcion, unidad, cantidad, precio] = c.length >= 5 ? c : ["", ...c];
      if (!descripcion || !(numCon(cantidad, modo) || numCon(precio, modo))) continue;
      sc.items.push({ id: uid(), codigo, descripcion, unidad, cantidad: numCon(cantidad, modo), precio: numCon(precio, modo) }); n++;
    }
    pegar = false; setDirty(true); render(); toast(n ? n + " rubros agregados" : "No encontré rubros con cantidad o precio."); return;
  }
  if (a === "verRubrosObra") { secAbierta["contratos2"] = true; pegar = false; await cargarRubrosObra(); elegirRubros = true; render(); return; }
  if (a === "rubrosNo") { elegirRubros = false; render(); return; }
  if (a === "rubrosOk") {
    const ids = [...document.querySelectorAll("[data-rp]:checked")].map((x) => x.dataset.rp); let n = 0;
    for (const r of rubrosObra.filter((x) => ids.includes(x.id))) { sc.items.push({ id: uid(), codigo: r.codigo || "", descripcion: r.descripcion, unidad: r.unidad || "", cantidad: num(r.cantidad), precio: "" }); n++; }
    elegirRubros = false; setDirty(true); render(); toast(n + " rubros agregados: pon el precio del subcontratista."); return;
  }
  if (a === "nuevaPl") { if (dirty) return toast("Guarda primero los cambios del contrato."); return nuevaPl(); }
  if (a === "delSc") { confirm = "sc"; render(); return; }
  if (a === "delPl") { confirm = "pl"; render(); return; }
  if (a === "delG") { confirm = "g"; render(); return; }
  if (a === "noDel") { confirm = null; render(); return; }
  if (a === "delScOk") { if (await borrar("subcontratos", sc.id)) { subs = subs.filter((x) => x.id !== sc.id); dirty = false; view = "lista"; sc = null; render(); toast("Subcontrato borrado"); } return; }
  if (a === "delPlOk") { if (await borrar("subcontrato_planillas", pl.id)) { subPls = subPls.filter((x) => x.id !== pl.id); dirty = false; view = "contrato"; pl = null; render(); toast("Planilla borrada"); } return; }
  if (a === "delGOk") { if (await borrar("garantias", gar.id)) { garantias = garantias.filter((x) => x.id !== gar.id); dirty = false; volver(); toast("Garantía borrada"); } return; }
  if (b.id === "btnGuardar") return view === "contrato" ? guardarSc() : view === "planilla" ? guardarPl() : guardarGar();
  if (b.id === "btnPDF") { try { generarPDF(); } catch (err) { toast("No se pudo generar el PDF."); } return; }
  if (b.id === "btnVolver") {
    if (dirty && !b.dataset.sure) { b.dataset.sure = "1"; const prev = b.textContent; b.textContent = "¿Salir sin guardar?"; setTimeout(() => { if (b.dataset.sure) { b.dataset.sure = ""; b.textContent = prev; } }, 3000); return; }
    b.dataset.sure = ""; volver();
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
  if (qs.get("tab") === "garantias") tab = "garantias";
  $("#obraSel").innerHTML = obras.length ? obras.map((o) => `<option value="${esc(o.id)}"${o.id === obraId ? " selected" : ""}>${esc(o.nombre)}</option>`).join("") : `<option value="">Sin obras asignadas</option>`;
  await cargarObra();
})();
})();
