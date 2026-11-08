// DLV Plataforma — Estado de pago: presupuesto por obra (rubros) y planillas al mandante con PDF.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoy = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const fmtF = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
// números: acepta "1.234,56", "1,234.56", "1234.5" y "12,5"
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").trim().replace(/[$\s]/g, ""); if (!s) return 0;
  const c = s.lastIndexOf(","), d = s.lastIndexOf(".");
  if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (c > -1) s = s.match(/,/g).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (d > -1 && (s.match(/\./g).length > 1)) s = s.replace(/\./g, "");
  const n = parseFloat(s); return isFinite(n) ? n : 0;
}
const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => "$ " + (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n) => (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
const ESTADOS = { borrador: "Borrador", presentada: "Presentada", aprobada: "Aprobada", pagada: "Pagada" };
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

let sb = null, user = null, perfil = null;
let obras = [], obraId = "", rubros = [], planillas = [];
let view = "lista", draft = null, dirty = false, filtro = "", soloConCant = false, confirm = null, importTxt = "", importPrev = null, nuevoRubro = null;
const esAdmin = () => perfil && perfil.rol === "admin";
const obra = () => obras.find((o) => o.id === obraId) || {};

/* ---------- cálculo ---------- */
function cfgBase(n) {
  const prev = planillas.filter((p) => p.numero < n).sort((a, b) => b.numero - a.numero)[0];
  const c = prev ? prev.config || {} : {};
  return { anticipo_pct: c.anticipo_pct ?? 0, ret_pct: c.ret_pct ?? 0, iva_pct: c.iva_pct ?? 15, multas: 0, descuentos: 0, nota: "" };
}
// Calcula todas las planillas en orden (la amortización del anticipo depende de las anteriores)
function calcular(objetivo) {
  const lista = planillas.filter((p) => !objetivo || p.id !== objetivo.id).concat(objetivo ? [objetivo] : []).sort((a, b) => a.numero - b.numero);
  const contrato = rubros.filter((r) => !r.adicional).reduce((s, r) => s + num(r.cantidad) * num(r.precio), 0);
  const adicionales = rubros.filter((r) => r.adicional).reduce((s, r) => s + num(r.cantidad) * num(r.precio), 0);
  const acumCant = {}; let amortAcum = 0, brutoAcum = 0, res = null;
  for (const p of lista) {
    const cfg = p.config || {};
    const lineas = rubros.map((r) => {
      const ant = acumCant[r.id] || 0, per = num((p.cantidades || {})[r.id]), acu = ant + per, pu = num(r.precio), con = num(r.cantidad);
      return { r, ant, per, acu, con, pu, vCon: con * pu, vAnt: ant * pu, vPer: per * pu, vAcu: acu * pu, excede: acu > con + 1e-9 };
    });
    const bruto = lineas.reduce((s, l) => s + l.vPer, 0);
    const anticipo = contrato * num(cfg.anticipo_pct) / 100;
    const amort = Math.max(0, Math.min(bruto * num(cfg.anticipo_pct) / 100, anticipo - amortAcum));
    const ret = bruto * num(cfg.ret_pct) / 100, multas = num(cfg.multas), desc = num(cfg.descuentos), iva = bruto * num(cfg.iva_pct) / 100;
    const t = {
      contrato: r2(contrato), adicionales: r2(adicionales), total: r2(contrato + adicionales),
      anterior: r2(brutoAcum), bruto: r2(bruto), acumulado: r2(brutoAcum + bruto), saldo: r2(contrato + adicionales - brutoAcum - bruto),
      avance: contrato + adicionales > 0 ? (brutoAcum + bruto) / (contrato + adicionales) * 100 : 0,
      anticipo: r2(anticipo), amort: r2(amort), amortAcum: r2(amortAcum + amort), saldoAnticipo: r2(anticipo - amortAcum - amort),
      ret: r2(ret), multas: r2(multas), descuentos: r2(desc), iva: r2(iva), liquido: r2(bruto - amort - ret - multas - desc + iva)
    };
    if (objetivo && p === objetivo) res = { lineas, t };
    for (const l of lineas) acumCant[l.r.id] = l.acu;
    amortAcum += amort; brutoAcum += bruto;
    if (!objetivo) res = { lineas, t };
  }
  if (!res) { const t = { contrato: r2(contrato), adicionales: r2(adicionales), total: r2(contrato + adicionales), acumulado: 0, avance: 0, saldo: r2(contrato + adicionales) }; res = { lineas: [], t }; }
  return res;
}

/* ---------- datos ---------- */
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await build().range(from, from + 999); if (error) throw error; out.push(...(data || [])); if (!data || data.length < 1000) break; }
  return out;
}
let sinTablas = false;
async function cargarObra() {
  rubros = []; planillas = []; sinTablas = false;
  if (obraId) {
    try {
      const [rs, ps] = await Promise.all([
        fetchAll(() => sb.from("rubros").select("*").eq("obra_id", obraId).order("orden").order("creado")),
        sb.from("planillas").select("*").eq("obra_id", obraId).order("numero")
      ]);
      if (ps.error) throw ps.error;
      rubros = rs; planillas = ps.data || [];
    } catch (e) { sinTablas = true; }
  }
  render();
}

/* ---------- render ---------- */
function setDirty(v) { dirty = v; const e = $("#estado"); if (view !== "editor") return; e.className = "state" + (v ? " dirty" : ""); e.textContent = v ? "Sin guardar" : draft && draft.id ? "Guardado" : "Nueva"; }
function render() {
  const m = $("#main");
  $("#top").hidden = !user; $("#dock").hidden = view !== "editor";
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (!obraId) { m.innerHTML = `<div class="empty"><b>Sin obras asignadas.</b><span>Pide al gerente de proyecto que te agregue a una obra.</span></div>`; return; }
  if (sinTablas) { m.innerHTML = `<div class="empty"><b>Falta activar el estado de pago.</b><span>Ejecuta <b>supabase/planillas.sql</b> en Supabase → SQL Editor y recarga.</span></div>`; return; }
  if (view === "presupuesto") return renderPresupuesto(m);
  if (view === "editor") return renderEditor(m);
  renderLista(m);
}
function renderLista(m) {
  const { t } = calcular(null);
  m.innerHTML = `
  <section class="obracard">
    <div class="listhead"><h1>${esc(obra().nombre)}</h1></div>
    <div class="kpis">
      <div><small>Contrato</small><b>${money(t.contrato)}</b></div>
      <div><small>Adicionales</small><b>${money(t.adicionales)}</b></div>
      <div><small>Planillado</small><b>${money(t.acumulado)}</b></div>
      <div><small>Saldo por planillar</small><b>${money(t.saldo)}</b></div>
    </div>
    <div class="meter" role="img" aria-label="Avance económico ${pct(t.avance)}"><i style="width:${Math.min(100, t.avance).toFixed(2)}%"></i></div>
    <span class="code">Avance económico ${pct(t.avance)} · ${rubros.length} rubros en el presupuesto</span>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" type="button" data-act="presupuesto">Presupuesto y adicionales</button></div>
  </section>
  <div class="listhead"><h1>Planillas</h1>${rubros.length ? `<button class="btn hivis" type="button" data-act="nueva">+ Nueva planilla</button>` : ""}</div>
  <div class="list">${!rubros.length ? `<div class="empty"><b>Primero carga el presupuesto de la obra.</b><span>Copia los rubros desde tu sábana de Excel y pégalos aquí.</span>${esAdmin() ? `<button class="btn primary" type="button" data-act="presupuesto">Cargar presupuesto</button>` : `<span>Solo el administrador puede cargarlo.</span>`}</div>`
    : planillas.length ? planillas.slice().reverse().map((p) => `
      <button class="rep" type="button" data-open="${esc(p.id)}">
        <span class="n">${String(p.numero).padStart(2, "0")}</span>
        <span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${p.desde ? fmtF(p.desde) + " – " + fmtF(p.hasta) : fmtF(p.fecha)}</span>
        <span class="d">${money((p.totales || {}).bruto)} · líquido ${money((p.totales || {}).liquido)}</span></span>
        <span class="pill est-${esc(p.estado)}">${ESTADOS[p.estado] || p.estado}</span></button>`).join("")
    : `<div class="empty"><span>Aún no hay planillas de esta obra.</span><button class="btn hivis" type="button" data-act="nueva">+ Primera planilla</button></div>`}</div>`;
}
function renderPresupuesto(m) {
  const usados = new Set(planillas.flatMap((p) => Object.keys(p.cantidades || {}).filter((k) => num(p.cantidades[k]))));
  const { t } = calcular(null);
  let cap = null;
  const filas = rubros.map((r) => {
    let h = "";
    if ((r.capitulo || "") !== cap) { cap = r.capitulo || ""; if (cap) h += `<div class="capt">${esc(cap)}</div>`; }
    return h + `<div class="rub${r.adicional ? " adic" : ""}"><span class="cod">${esc(r.codigo || "")}</span><span class="ds">${esc(r.descripcion)}${r.adicional ? ' <span class="pill ex">Adicional</span>' : ""}</span>
      <span class="nm">${qty(num(r.cantidad))} ${esc(r.unidad || "")} × ${money(num(r.precio))}</span><span class="nm b">${money(num(r.cantidad) * num(r.precio))}</span>
      ${esAdmin() && !usados.has(r.id) ? `<button class="x" type="button" data-delrub="${esc(r.id)}" aria-label="Quitar rubro">×</button>` : "<span></span>"}</div>`;
  }).join("");
  const nr = nuevoRubro;
  m.innerHTML = `
  <div class="listhead"><h1>Presupuesto</h1><button class="btn ghost" type="button" data-act="volver">← Planillas</button></div>
  <section class="obracard"><div class="kpis"><div><small>Contrato</small><b>${money(t.contrato)}</b></div><div><small>Adicionales</small><b>${money(t.adicionales)}</b></div><div><small>Total</small><b>${money(t.total)}</b></div><div><small>Rubros</small><b>${rubros.length}</b></div></div></section>
  ${esAdmin() ? `
  <details class="sec"${rubros.length ? "" : " open"}><summary><h2>Pegar desde Excel</h2><span class="sum">${rubros.length ? "agrega al final" : "presupuesto inicial"}</span></summary><div class="body">
    <span class="code">Copia en Excel las columnas <b>Código · Descripción · Unidad · Cantidad · Precio unitario</b> y pégalas aquí. Las filas sin cantidad ni precio se toman como capítulos.</span>
    <textarea id="impTxt" rows="7" placeholder="1.01	Replanteo y nivelación	m2	250	1,85">${esc(importTxt)}</textarea>
    <label class="chk" for="impAdic"><input type="checkbox" id="impAdic"${importPrev && importPrev.adicional ? " checked" : ""}>Son obras adicionales (fuera del contrato)</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-act="previsualizar">Revisar</button>${importPrev && importPrev.filas.length ? `<button class="btn primary" type="button" data-act="importar">Agregar ${importPrev.filas.length} rubros</button>` : ""}</div>
    ${importPrev ? `<span class="code">${importPrev.filas.length} rubros · ${importPrev.caps} capítulos · ${money(importPrev.total)}${importPrev.malas ? ` · ${importPrev.malas} filas sin descripción se omitieron` : ""}</span>
      <div class="prev">${importPrev.filas.slice(0, 8).map((f) => `<div><span class="cod">${esc(f.codigo)}</span> ${esc(f.descripcion)} <span class="nm">${qty(f.cantidad)} ${esc(f.unidad)} × ${money(f.precio)}</span></div>`).join("")}${importPrev.filas.length > 8 ? `<div class="code">… y ${importPrev.filas.length - 8} más</div>` : ""}</div>` : ""}
  </div></details>
  <details class="sec"${nr ? " open" : ""}><summary><h2>Agregar rubro</h2><span class="sum">obra adicional o faltante</span></summary><div class="body">
    <div class="grid3"><label class="fld" for="nrCod"><span>Código</span><input id="nrCod" type="text" data-nr="codigo" value="${esc(nr ? nr.codigo : "")}"></label>
      <label class="fld" for="nrUnd"><span>Unidad</span><input id="nrUnd" type="text" data-nr="unidad" value="${esc(nr ? nr.unidad : "")}"></label>
      <label class="fld" for="nrCap"><span>Capítulo</span><input id="nrCap" type="text" data-nr="capitulo" value="${esc(nr ? nr.capitulo : "")}"></label></div>
    <label class="fld" for="nrDesc"><span>Descripción</span><input id="nrDesc" type="text" data-nr="descripcion" value="${esc(nr ? nr.descripcion : "")}"></label>
    <div class="grid2"><label class="fld" for="nrCant"><span>Cantidad</span><input id="nrCant" type="text" inputmode="decimal" data-nr="cantidad" value="${esc(nr ? nr.cantidad : "")}"></label>
      <label class="fld" for="nrPu"><span>Precio unitario</span><input id="nrPu" type="text" inputmode="decimal" data-nr="precio" value="${esc(nr ? nr.precio : "")}"></label></div>
    <label class="chk" for="nrAdic"><input type="checkbox" id="nrAdic" data-nrc="adicional"${!nr || nr.adicional ? " checked" : ""}>Obra adicional (fuera del contrato)</label>
    <div><button class="btn primary" type="button" data-act="agregarRubro">Agregar rubro</button></div>
  </div></details>` : ""}
  <div class="rubros">${filas || `<div class="empty"><span>Sin rubros todavía.</span></div>`}</div>`;
}
function renderEditor(m) {
  const d = draft, cfg = d.config, bloqueada = d.estado !== "borrador";
  const { lineas, t } = calcular(d);
  const q = filtro.trim().toLowerCase();
  let cap = null;
  const filas = lineas.map((l) => {
    const r = l.r;
    if (q && !((r.codigo || "") + " " + r.descripcion + " " + (r.capitulo || "")).toLowerCase().includes(q)) return "";
    if (soloConCant && !l.per) return "";
    let h = "";
    if ((r.capitulo || "") !== cap) { cap = r.capitulo || ""; if (cap) h += `<div class="capt">${esc(cap)}</div>`; }
    const av = l.con > 0 ? l.acu / l.con * 100 : 0;
    return h + `<div class="pl${l.per ? " con" : ""}${l.excede ? " exc" : ""}${r.adicional ? " adic" : ""}">
      <div class="h"><span class="cod">${esc(r.codigo || "")}</span><span class="ds">${esc(r.descripcion)}${r.adicional ? ' <span class="pill ex">Adicional</span>' : ""}</span></div>
      <div class="g">
        <div><small>Contratado</small><span>${qty(l.con)} ${esc(r.unidad || "")}</span></div>
        <div><small>Anterior</small><span>${qty(l.ant)}</span></div>
        <label class="per" for="q_${esc(r.id)}"><small>Este período</small><input id="q_${esc(r.id)}" type="text" inputmode="decimal" data-q="${esc(r.id)}" value="${l.per ? esc(String((d.cantidades || {})[r.id])) : ""}" placeholder="0" ${bloqueada ? "disabled" : ""}></label>
        <div><small>Acumulado</small><span id="ac_${esc(r.id)}">${qty(l.acu)} · ${pct(av)}</span></div>
        <div><small>Valor período</small><span id="vp_${esc(r.id)}" class="b">${money(l.vPer)}</span></div>
      </div>
      ${l.excede ? `<span class="warnline">El acumulado supera la cantidad contratada. Registra el excedente como obra adicional.</span>` : ""}
    </div>`;
  }).join("");
  m.innerHTML = `
  <details class="sec" open><summary><span class="num">EP</span><h2>Planilla N.° ${esc(d.numero)}</h2><span class="sum">${ESTADOS[d.estado]}</span></summary><div class="body">
    <div class="grid3"><label class="fld" for="fNum"><span>Número</span><input id="fNum" type="number" inputmode="numeric" data-f="numero" value="${esc(d.numero)}" ${bloqueada ? "disabled" : ""}></label>
      <label class="fld" for="fFecha"><span>Fecha</span><input id="fFecha" type="date" data-f="fecha" value="${esc(d.fecha)}" ${bloqueada ? "disabled" : ""}></label>
      <label class="fld" for="fEst"><span>Estado</span><select id="fEst" data-f="estado">${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}"${d.estado === k ? " selected" : ""}${!esAdmin() && k !== "borrador" && k !== "presentada" && d.estado !== k ? " disabled" : ""}>${v}</option>`).join("")}</select></label></div>
    <div class="grid2"><label class="fld" for="fDesde"><span>Período desde</span><input id="fDesde" type="date" data-f="desde" value="${esc(d.desde || "")}" ${bloqueada ? "disabled" : ""}></label>
      <label class="fld" for="fHasta"><span>Período hasta</span><input id="fHasta" type="date" data-f="hasta" value="${esc(d.hasta || "")}" ${bloqueada ? "disabled" : ""}></label></div>
    ${bloqueada ? `<span class="code">Planilla ${ESTADOS[d.estado].toLowerCase()}: las cantidades están bloqueadas. Vuelve a «Borrador» para corregirla.</span>` : ""}
  </div></details>
  <section class="sumcard" id="sumcard">${resumenHTML(t)}</section>
  <details class="sec"><summary><span class="num">%</span><h2>Anticipo, retenciones e IVA</h2><span class="sum">anticipo ${esc(cfg.anticipo_pct)} % · IVA ${esc(cfg.iva_pct)} %</span></summary><div class="body">
    <div class="grid3"><label class="fld" for="cAnt"><span>Anticipo (% del contrato)</span><input id="cAnt" type="text" inputmode="decimal" data-c="anticipo_pct" value="${esc(cfg.anticipo_pct)}" ${bloqueada ? "disabled" : ""}></label>
      <label class="fld" for="cRet"><span>Fondo de garantía (%)</span><input id="cRet" type="text" inputmode="decimal" data-c="ret_pct" value="${esc(cfg.ret_pct)}" ${bloqueada ? "disabled" : ""}></label>
      <label class="fld" for="cIva"><span>IVA (%)</span><input id="cIva" type="text" inputmode="decimal" data-c="iva_pct" value="${esc(cfg.iva_pct)}" ${bloqueada ? "disabled" : ""}></label></div>
    <div class="grid2"><label class="fld" for="cMul"><span>Multas ($)</span><input id="cMul" type="text" inputmode="decimal" data-c="multas" value="${esc(cfg.multas || "")}" ${bloqueada ? "disabled" : ""}></label>
      <label class="fld" for="cDes"><span>Otros descuentos ($)</span><input id="cDes" type="text" inputmode="decimal" data-c="descuentos" value="${esc(cfg.descuentos || "")}" ${bloqueada ? "disabled" : ""}></label></div>
    <label class="fld" for="cNota"><span>Observaciones (salen en el PDF)</span><textarea id="cNota" data-c="nota" ${bloqueada ? "disabled" : ""}>${esc(cfg.nota || "")}</textarea></label>
    <span class="code">La amortización del anticipo es el % del anticipo sobre el valor de cada planilla, hasta completar el anticipo entregado.</span>
  </div></details>
  <details class="sec" open><summary><span class="num">${lineas.filter((l) => l.per).length}</span><h2>Cantidades del período</h2><span class="sum">${rubros.length} rubros</span></summary><div class="body">
    <div class="tools2"><label class="fld" for="fBus"><span class="vh">Buscar rubro</span><input id="fBus" type="text" placeholder="Buscar rubro o capítulo…" value="${esc(filtro)}" autocomplete="off"></label>
      <label class="chk" for="fSolo"><input type="checkbox" id="fSolo"${soloConCant ? " checked" : ""}>Solo con cantidad</label></div>
    <div class="pls">${filas || `<span class="code">Ningún rubro coincide.</span>`}</div>
  </div></details>
  ${draft.id && esAdmin() && draft.estado === "borrador" ? (confirm === "del" ? `<div class="confirm"><span>¿Borrar la planilla N.° ${esc(d.numero)}? No se puede deshacer.</span><button class="btn sm danger" type="button" data-act="borrarOk">Sí, borrar</button><button class="btn sm" type="button" data-act="noBorrar">Cancelar</button></div>` : `<div><button class="btn sm danger" type="button" data-act="borrar">Borrar esta planilla</button></div>`) : ""}`;
  setDirty(dirty);
}
function resumenHTML(t) {
  const row = (k, v, cls = "") => `<div class="${cls}"><span>${k}</span><b>${v}</b></div>`;
  return `<div class="sumgrid">
    ${row("Valor de esta planilla", money(t.bruto), "big")}
    ${row("Avance económico acumulado", pct(t.avance))}
    ${row("(−) Amortización del anticipo", money(t.amort))}
    ${t.ret ? row("(−) Fondo de garantía", money(t.ret)) : ""}
    ${t.multas ? row("(−) Multas", money(t.multas)) : ""}
    ${t.descuentos ? row("(−) Otros descuentos", money(t.descuentos)) : ""}
    ${row("(+) IVA", money(t.iva))}
    ${row("Líquido a pagar", money(t.liquido), "big tot")}
  </div><span class="code">Planillado anterior ${money(t.anterior)} · acumulado ${money(t.acumulado)} · saldo por planillar ${money(t.saldo)} · saldo de anticipo ${money(t.saldoAnticipo)}</span>`;
}
function refrescarLinea(id) {
  const { lineas, t } = calcular(draft);
  const l = lineas.find((x) => x.r.id === id);
  if (l) {
    const a = $("#ac_" + CSS.escape(id)), v = $("#vp_" + CSS.escape(id)); if (a) a.textContent = qty(l.acu) + " · " + pct(l.con > 0 ? l.acu / l.con * 100 : 0); if (v) v.textContent = money(l.vPer);
    const box = a && a.closest(".pl");
    if (box) { box.classList.toggle("exc", l.excede); let w = box.querySelector(".warnline"); if (l.excede && !w) { w = document.createElement("span"); w.className = "warnline"; w.textContent = "El acumulado supera la cantidad contratada. Registra el excedente como obra adicional."; box.appendChild(w); } else if (!l.excede && w) w.remove(); }
  }
  const s = $("#sumcard"); if (s) s.innerHTML = resumenHTML(t);
}

/* ---------- presupuesto: pegar desde Excel ---------- */
// Detecta si el Excel pegado usa coma decimal (1.234,56) o punto decimal (1,234.56)
function formatoNumeros(txt) {
  let coma = 0, punto = 0;
  for (const cel of txt.split(/[\t\r\n]+/)) {
    const v = cel.trim();
    if (/^-?[\d.]*,\d{1,2}$/.test(v) || /^-?\d{1,3}(\.\d{3})+,\d+$/.test(v)) coma++;
    else if (/^-?[\d,]*\.\d{1,2}$/.test(v) || /^-?\d{1,3}(,\d{3})+\.\d+$/.test(v)) punto++;
  }
  return coma > punto ? "coma" : punto > coma ? "punto" : "";
}
function numCon(v, modo) {
  const s = String(v ?? "").trim().replace(/[$\s]/g, "");
  if (modo === "coma") return num(s.replace(/\./g, "").replace(",", "."));
  if (modo === "punto") return num(s.replace(/,/g, ""));
  return num(s);
}
function parsePegado(txt, adicional) {
  const filas = []; let cap = "", caps = 0, malas = 0;
  const modo = formatoNumeros(txt);
  for (const raw of txt.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const c = raw.split("\t").map((x) => x.trim());
    let codigo = "", descripcion = "", unidad = "", cantidad = "", precio = "";
    if (c.length >= 5) [codigo, descripcion, unidad, cantidad, precio] = c;
    else if (c.length === 4) [descripcion, unidad, cantidad, precio] = c;
    else { descripcion = c.join(" "); }
    const tieneNum = numCon(cantidad, modo) || numCon(precio, modo);
    if (/^(c[oó]d|item|rubro|descrip)/i.test(codigo || descripcion) && !tieneNum) continue; // encabezado
    if (!tieneNum) { const t = [codigo, descripcion].filter(Boolean).join(" ").trim(); if (t) { cap = t; caps++; } continue; }
    if (!descripcion) { malas++; continue; }
    filas.push({ codigo, descripcion, unidad, cantidad: numCon(cantidad, modo), precio: numCon(precio, modo), capitulo: cap, adicional });
  }
  return { filas, caps, malas, adicional, total: filas.reduce((s, f) => s + f.cantidad * f.precio, 0) };
}
async function importar() {
  if (!importPrev || !importPrev.filas.length) return;
  const base = rubros.reduce((m, r) => Math.max(m, r.orden || 0), 0);
  const rows = importPrev.filas.map((f, i) => ({ ...f, obra_id: obraId, orden: base + (i + 1) * 10 }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("rubros").insert(rows.slice(i, i + 500));
    if (error) return toast("No se pudo cargar: " + error.message);
  }
  toast(rows.length + " rubros agregados"); importTxt = ""; importPrev = null; await cargarObra(); view = "presupuesto"; render();
}
async function agregarRubro() {
  const r = nuevoRubro || {};
  if (!(r.descripcion || "").trim()) return toast("Escribe la descripción del rubro.");
  const row = { obra_id: obraId, codigo: r.codigo || "", descripcion: r.descripcion.trim(), unidad: r.unidad || "", cantidad: num(r.cantidad), precio: num(r.precio),
    capitulo: r.capitulo || (r.adicional !== false ? "OBRAS ADICIONALES" : ""), adicional: r.adicional !== false, orden: rubros.reduce((m, x) => Math.max(m, x.orden || 0), 0) + 10 };
  const { error } = await sb.from("rubros").insert(row);
  if (error) return toast("No se pudo agregar: " + error.message);
  nuevoRubro = null; toast("Rubro agregado"); await cargarObra(); view = "presupuesto"; render();
}

/* ---------- planillas ---------- */
function nueva() {
  const n = planillas.reduce((m, p) => Math.max(m, p.numero), 0) + 1;
  const prev = planillas.find((p) => p.numero === n - 1);
  const desde = prev && prev.hasta ? (() => { const [y, m, d] = prev.hasta.split("-").map(Number); const x = new Date(y, m - 1, d + 1); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); })() : "";
  draft = { obra_id: obraId, numero: n, fecha: hoy(), desde, hasta: desde && desde > hoy() ? "" : hoy(), estado: "borrador", cantidades: {}, config: cfgBase(n) };
  filtro = ""; soloConCant = false; confirm = null; view = "editor"; setDirty(true); render(); window.scrollTo(0, 0);
}
function abrir(id) {
  const p = planillas.find((x) => x.id === id); if (!p) return;
  draft = JSON.parse(JSON.stringify(p)); draft.config = { ...cfgBase(p.numero), ...(p.config || {}) };
  filtro = ""; soloConCant = !!Object.keys(p.cantidades || {}).length && p.estado !== "borrador"; confirm = null; view = "editor"; dirty = false; render(); window.scrollTo(0, 0);
}
async function guardar() {
  const d = draft; d.numero = parseInt(d.numero, 10) || 1;
  const cant = {}; for (const [k, v] of Object.entries(d.cantidades || {})) if (num(v)) cant[k] = num(v);
  const { t } = calcular({ ...d, cantidades: cant });
  const cfg = { ...d.config }; for (const k of ["anticipo_pct", "ret_pct", "iva_pct", "multas", "descuentos"]) cfg[k] = num(cfg[k]);
  const row = { obra_id: obraId, numero: d.numero, fecha: d.fecha || hoy(), desde: d.desde || null, hasta: d.hasta || null, estado: d.estado, cantidades: cant, config: cfg, totales: t, actualizado: new Date().toISOString() };
  const btn = $("#btnGuardar"); btn.disabled = true; btn.textContent = "Guardando…";
  try {
    const { data, error } = d.id ? await sb.from("planillas").update(row).eq("id", d.id).select().single() : await sb.from("planillas").insert(row).select().single();
    if (error) throw error;
    draft = { ...JSON.parse(JSON.stringify(data)), config: { ...cfg } };
    const i = planillas.findIndex((p) => p.id === data.id); if (i >= 0) planillas[i] = data; else planillas.push(data);
    planillas.sort((a, b) => a.numero - b.numero);
    setDirty(false); render(); toast("Planilla guardada");
  } catch (err) { toast(String(err.code) === "23505" ? "Ya existe una planilla con ese número en esta obra." : "No se pudo guardar: " + (err.message || "revisa tu conexión")); }
  finally { btn.disabled = false; btn.textContent = "Guardar"; }
}
async function borrarPlanilla() {
  const { error } = await sb.from("planillas").delete().eq("id", draft.id);
  if (error) return toast("No se pudo borrar.");
  planillas = planillas.filter((p) => p.id !== draft.id); draft = null; dirty = false; confirm = null; view = "lista"; toast("Planilla borrada"); render();
}

/* ---------- PDF (A4 horizontal) ---------- */
function generarPDF() {
  if (!window.jspdf) return toast("No se cargó el generador de PDF. Revisa tu conexión y recarga.");
  const d = draft, o = obra(), { lineas, t } = calcular(d);
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const M = 10, W = 277, NAVY = [29, 53, 87], AMB = [232, 163, 23], GRID = [150, 150, 150], LBL = [236, 235, 227], SUB = [217, 222, 230];
  const fit = (s, w) => { s = String(s ?? ""); while (s && doc.getTextWidth(s) > w) s = s.slice(0, -2) + "…"; return s; };
  let pagina = 1;
  function header(sub) {
    const hh = 18;
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.rect(M, M, W, hh); doc.line(M + 48, M, M + 48, M + hh); doc.line(M + W - 52, M, M + W - 52, M + hh);
    doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("DLV", M + 5, M + 9.5);
    doc.setFillColor(...AMB); doc.rect(M + 5, M + 10.8, 15, 1, "F");
    doc.setFontSize(6.4); doc.text("CONSTRUCCIONES CÍA. LTDA.", M + 5, M + 14.6);
    doc.setFontSize(13); doc.text("ESTADO DE PAGO N.° " + String(d.numero).padStart(2, "0"), M + 48 + (W - 100) / 2, M + 8.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85, 85, 85); doc.text(sub, M + 48 + (W - 100) / 2, M + 13.2, { align: "center" });
    const x = M + W - 52;
    [["FECHA", fmtF(d.fecha)], ["PERÍODO", d.desde ? fmtF(d.desde) + " – " + fmtF(d.hasta) : "—"], ["ESTADO", ESTADOS[d.estado].toUpperCase()]].forEach(([k, v], i) => {
      const yy = M + i * 6; if (i) doc.line(x, yy, M + W, yy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4);
      doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(v, M + W - 1.5, yy + 4, { align: "right" });
    });
    return M + hh + 3;
  }
  function footer() {
    doc.setFont("helvetica", "normal"); doc.setFontSize(5.6); doc.setTextColor(120, 120, 120);
    doc.text("DLV Construcciones Cía. Ltda. · Av. Primero de Mayo y Av. de las Américas, Cuenca · " + (o.nombre || ""), M, 203);
    doc.text("Página " + pagina, M + W, 203, { align: "right" });
  }
  // --- Hoja 1: carátula ---
  let y = header("Carátula y resumen económico");
  const datos = [["OBRA", o.nombre], ["CLIENTE / MANDANTE", o.cliente], ["CONTRATO", o.contrato], ["UBICACIÓN", o.ubicacion], ["FISCALIZACIÓN", o.fiscalizador], ["RESIDENTE", o.residente]];
  doc.setFontSize(7);
  datos.forEach(([k, v], i) => {
    const col = i % 2, row = Math.floor(i / 2), x = M + col * (W / 2), yy = y + row * 6;
    doc.setFillColor(...LBL); doc.rect(x, yy, 34, 6, "F"); doc.setDrawColor(...GRID); doc.rect(x, yy, W / 2, 6);
    doc.setFont("helvetica", "bold"); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4);
    doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(fit(v || "—", W / 2 - 38), x + 36, yy + 4);
  });
  y += 3 * 6 + 5;
  const res = [
    ["Monto del contrato", t.contrato], ["Obras adicionales", t.adicionales], ["Monto total", t.total],
    ["Planillado anterior", t.anterior], ["VALOR DE ESTA PLANILLA", t.bruto, true], ["Planillado acumulado", t.acumulado], ["Saldo por planillar", t.saldo]
  ];
  const liq = [
    ["Valor de esta planilla", t.bruto], ["(−) Amortización del anticipo (" + num(d.config.anticipo_pct) + " %)", -t.amort], ["(−) Fondo de garantía (" + num(d.config.ret_pct) + " %)", -t.ret],
    ["(−) Multas", -t.multas], ["(−) Otros descuentos", -t.descuentos], ["Subtotal", t.bruto - t.amort - t.ret - t.multas - t.descuentos], ["(+) IVA " + num(d.config.iva_pct) + " %", t.iva], ["LÍQUIDO A PAGAR", t.liquido, true]
  ];
  const box = (x, w, title, rows) => {
    doc.setFillColor(...NAVY); doc.rect(x, y, w, 5.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(7.2); doc.setTextColor(255, 255, 255); doc.text(title, x + 2, y + 3.8);
    rows.forEach(([k, v, strong], i) => {
      const yy = y + 5.5 + i * 6.2;
      if (strong) { doc.setFillColor(...SUB); doc.rect(x, yy, w, 6.2, "F"); }
      doc.setDrawColor(...GRID); doc.rect(x, yy, w, 6.2);
      doc.setFont("helvetica", strong ? "bold" : "normal"); doc.setFontSize(7.4); doc.setTextColor(30, 30, 30);
      doc.text(k, x + 2, yy + 4.2); doc.text(money(v), x + w - 2, yy + 4.2, { align: "right" });
    });
    return y + 5.5 + rows.length * 6.2;
  };
  const w2 = (W - 8) / 2;
  const y1 = box(M, w2, "RESUMEN DEL CONTRATO", res);
  const y2 = box(M + w2 + 8, w2, "LIQUIDACIÓN DE ESTA PLANILLA", liq);
  y = Math.max(y1, y2) + 3;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(60, 60, 60);
  doc.text(`Avance económico acumulado: ${pct(t.avance)}   ·   Anticipo entregado: ${money(t.anticipo)}   ·   Amortizado acumulado: ${money(t.amortAcum)}   ·   Saldo de anticipo: ${money(t.saldoAnticipo)}`, M, y + 2);
  y += 5;
  if (d.config.nota) { const ls = doc.splitTextToSize("Observaciones: " + d.config.nota, W); doc.text(ls.slice(0, 3), M, y + 2); y += ls.slice(0, 3).length * 3.4 + 1; }
  // firmas
  const fy = Math.max(y + 4, 168), fw = (W - 16) / 3;
  [["ELABORADO · DLV CONSTRUCCIONES", o.gerente || "Gerente de proyecto"], ["REVISADO · FISCALIZACIÓN", o.fiscalizador || ""], ["APROBADO · MANDANTE", o.cliente || ""]].forEach(([tt, n], i) => {
    const x = M + i * (fw + 8);
    doc.setFillColor(...NAVY); doc.rect(x, fy, fw, 4, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); doc.setTextColor(255, 255, 255); doc.text(tt, x + fw / 2, fy + 2.8, { align: "center" });
    doc.setDrawColor(...GRID); doc.rect(x, fy + 4, fw, 20);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(60, 60, 60); doc.text(fit(n || "Nombre / firma", fw - 26), x + 2, fy + 22); doc.text("___/___/______", x + fw - 2, fy + 22, { align: "right" });
  });
  footer();
  // --- Detalle ---
  const cols = [["CÓD.", 14, "l"], ["DESCRIPCIÓN", 70, "l"], ["UND", 10, "c"], ["CANT. CONTR.", 18, "r"], ["P. UNIT.", 18, "r"], ["TOTAL CONTR.", 24, "r"], ["CANT. ANT.", 18, "r"], ["CANT. PERÍODO", 18, "r"], ["CANT. ACUM.", 18, "r"], ["VALOR PERÍODO", 24, "r"], ["VALOR ACUM.", 24, "r"], ["% AV.", 21, "r"]];
  const RH = 4.6;
  const head = (yy) => {
    let x = M; doc.setFillColor(...NAVY); doc.rect(M, yy, W, 6, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(255, 255, 255);
    for (const [h, w, al] of cols) { doc.text(h, al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, yy + 4, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; }
    return yy + 6;
  };
  const nuevaHoja = () => { doc.addPage("a4", "landscape"); pagina++; const yy = header("Detalle de cantidades por rubro"); footer(); return head(yy); };
  y = nuevaHoja();
  let cap = null;
  const linea = (vals, opt = {}) => {
    if (y + RH > 198) y = nuevaHoja();
    if (opt.fill) { doc.setFillColor(...opt.fill); doc.rect(M, y, W, RH, "F"); }
    doc.setDrawColor(210, 210, 210); doc.line(M, y + RH, M + W, y + RH);
    let x = M; doc.setFont("helvetica", opt.bold ? "bold" : "normal"); doc.setFontSize(6.2); doc.setTextColor(30, 30, 30);
    cols.forEach(([, w, al], i) => { const v = vals[i]; if (v != null && v !== "") doc.text(fit(v, w - 2.4), al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, y + 3.2, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; });
    y += RH;
  };
  for (const l of lineas) {
    const r = l.r;
    if ((r.capitulo || "") !== cap) { cap = r.capitulo || ""; if (cap) linea(["", cap.toUpperCase()], { bold: true, fill: LBL }); }
    linea([r.codigo, r.descripcion + (r.adicional ? " (adicional)" : ""), r.unidad, qty(l.con), money(l.pu), money(l.vCon), qty(l.ant), l.per ? qty(l.per) : "", qty(l.acu), l.per ? money(l.vPer) : "", money(l.vAcu), pct(l.con > 0 ? l.acu / l.con * 100 : 0)], l.per ? { fill: [255, 247, 224] } : {});
  }
  linea(["", "TOTALES", "", "", "", money(t.total), "", "", "", money(t.bruto), money(t.acumulado), pct(t.avance)], { bold: true, fill: SUB });
  const name = `EP-${String(d.numero).padStart(2, "0")} ${(o.nombre || "Obra").replace(/[\\/:*?"<>|]/g, "")} ${d.fecha}.pdf`;
  const blob = doc.output("blob"), file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch((err) => { if (err.name !== "AbortError") doc.save(name); });
  else doc.save(name);
}

/* ---------- eventos ---------- */
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.q && draft) { draft.cantidades = draft.cantidades || {}; draft.cantidades[t.dataset.q] = t.value; setDirty(true); t.closest(".pl").classList.toggle("con", !!num(t.value)); refrescarLinea(t.dataset.q); return; }
  if (t.dataset.c && draft) { draft.config[t.dataset.c] = t.value; setDirty(true); const s = $("#sumcard"); if (s) s.innerHTML = resumenHTML(calcular(draft).t); return; }
  if (t.dataset.f && draft) { draft[t.dataset.f] = t.value; setDirty(true); return; }
  if (t.id === "fBus") { filtro = t.value; const pos = t.selectionStart; render(); const b = $("#fBus"); if (b) { b.focus(); b.setSelectionRange(pos, pos); } return; }
  if (t.id === "impTxt") { importTxt = t.value; importPrev = null; return; }
  if (t.dataset.nr) { nuevoRubro = nuevoRubro || { adicional: true }; nuevoRubro[t.dataset.nr] = t.value; }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "obraSel") { obraId = t.value; try { localStorage.setItem("dlv-obra", obraId); } catch (_) {} view = "lista"; draft = null; cargarObra(); return; }
  if (t.id === "fSolo") { soloConCant = t.checked; render(); return; }
  if (t.id === "fEst" && draft) { draft.estado = t.value; setDirty(true); render(); return; }
  if (t.dataset.nrc) { nuevoRubro = nuevoRubro || {}; nuevoRubro.adicional = t.checked; }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.open) return abrir(b.dataset.open);
  if (b.dataset.delrub) {
    const { error } = await sb.from("rubros").delete().eq("id", b.dataset.delrub);
    if (error) return toast("No se pudo quitar el rubro."); await cargarObra(); view = "presupuesto"; render(); return;
  }
  const a = b.dataset.act;
  if (a === "presupuesto") { view = "presupuesto"; render(); window.scrollTo(0, 0); return; }
  if (a === "volver") { view = "lista"; render(); return; }
  if (a === "nueva") return nueva();
  if (a === "previsualizar") { importTxt = $("#impTxt").value; importPrev = parsePegado(importTxt, $("#impAdic").checked); if (!importPrev.filas.length) toast("No encontré rubros. Revisa que copiaste las columnas desde Excel."); render(); return; }
  if (a === "importar") return importar();
  if (a === "agregarRubro") return agregarRubro();
  if (a === "borrar") { confirm = "del"; render(); return; }
  if (a === "noBorrar") { confirm = null; render(); return; }
  if (a === "borrarOk") return borrarPlanilla();
  if (b.id === "btnGuardar") return guardar();
  if (b.id === "btnPDF") { try { generarPDF(); } catch (err) { toast("No se pudo generar el PDF."); } return; }
  if (b.id === "btnVolver") {
    if (dirty && !b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "¿Salir sin guardar?"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "← Planillas"; }, 3000); return; }
    b.dataset.sure = ""; b.textContent = "← Planillas"; draft = null; dirty = false; view = "lista"; render(); window.scrollTo(0, 0);
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
  const want = new URLSearchParams(location.search).get("obra") || saved;
  obraId = (obras.find((o) => o.id === want) || obras[0] || {}).id || "";
  $("#obraSel").innerHTML = obras.length ? obras.map((o) => `<option value="${esc(o.id)}"${o.id === obraId ? " selected" : ""}>${esc(o.nombre)}</option>`).join("") : `<option value="">Sin obras asignadas</option>`;
  await cargarObra();
})();
})();
