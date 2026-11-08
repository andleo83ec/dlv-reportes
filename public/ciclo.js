// DLV Plataforma — Inicio y cierre de obra: entrega de la obra adjudicada, análisis previo a la ejecución,
// desmovilización, recepción, certificados municipales y de servicios, balance final y encuesta al cliente.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hoy = () => ymd(new Date());
const pd = (f) => { const [y, m, d] = String(f).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const dias = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const fmtF = (f) => { if (!f) return "—"; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
const num = (v) => { if (typeof v === "number") return v; const n = parseFloat(String(v ?? "").replace(/\./g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const money = (n) => "$ " + (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n || 0).toLocaleString("es-EC", { maximumFractionDigits: 0 }) + " %";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

// Listas tomadas del manual de procesos (entrega de obra adjudicada, análisis previo, desmovilización, cierre y recepción),
// adaptadas a Cuenca. "auto" indica qué dato de la plataforma lo respalda.
const LISTAS = {
  inicio: [
    { id: "entrega", titulo: "Entrega de la obra adjudicada", items: [
      ["contrato", "Contrato firmado con el mandante"], ["presupuesto", "Presupuesto contractual cargado en Estado de pago", "rubros"],
      ["planos", "Planos aprobados en su última versión (arquitectura, estructura, instalaciones)"], ["especificaciones", "Especificaciones técnicas"],
      ["cronograma", "Cronograma valorado de obra"], ["polizas", "Pólizas entregadas al mandante (anticipo y fiel cumplimiento)", "polizas"],
      ["anticipo", "Anticipo recibido"], ["permiso", "Permiso de construcción municipal"], ["seguro", "Seguro todo riesgo y responsabilidad civil"],
      ["estudio", "Estudio de la propuesta y cotizaciones entregados al residente", "propuesta"], ["arranque", "Reunión de arranque con fiscalización (acta)", "acta"],
      ["equipo", "Residente y equipo de obra asignados"]] },
    { id: "previo", titulo: "Análisis previo a la ejecución", items: [
      ["revplanos", "Revisión de planos y compatibilidad entre disciplinas (RDI emitidos)", "rdi"], ["suelos", "Estudio de suelos revisado"],
      ["sso", "Plan de seguridad y salud ocupacional"], ["provisionales", "Instalaciones provisionales: agua, luz, bodega, oficina, baterías sanitarias"],
      ["cerramiento", "Cerramiento y señalización de obra"], ["contrataciones", "Programa de contrataciones de subcontratos", "subcontratos"],
      ["compras", "Programa de compras de materiales críticos"], ["calidad", "Plan de control de calidad y ensayos"],
      ["replanteo", "Topografía y replanteo"], ["iess", "Afiliación al IESS del personal"], ["libro", "Libro de obra abierto"],
      ["colindantes", "Acta fotográfica del estado de los colindantes"]] }
  ],
  cierre: [
    { id: "desmov", titulo: "Desmovilización", items: [
      ["equipos", "Retiro de equipos, andamios y encofrados"], ["provret", "Retiro de instalaciones provisionales"], ["limpieza", "Limpieza final de obra"],
      ["sobrantes", "Inventario y devolución de materiales sobrantes"], ["subcierre", "Subcontratos cerrados con planilla final y evaluación", "subterminados"],
      ["personal", "Liquidación del personal"]] },
    { id: "entrega", titulo: "Recepción y entrega al cliente", items: [
      ["punch", "Lista de observaciones levantada y corregida"], ["asbuilt", "Planos as-built"], ["manuales", "Manuales de uso y mantenimiento"],
      ["garequipos", "Garantías de equipos (ascensor, bombas, generador, calefones)"], ["llaves", "Entrega de llaves e inventario"],
      ["provisional", "Acta de recepción provisional firmada"], ["definitiva", "Acta de recepción definitiva firmada"],
      ["devgar", "Devolución de pólizas y del fondo de garantía"]] },
    { id: "cert", titulo: "Certificados municipales y de servicios", items: [
      ["inspeccion", "Inspección final municipal"], ["habitabilidad", "Permiso de habitabilidad / uso"], ["bomberos", "Certificado del Cuerpo de Bomberos"],
      ["centrosur", "Acometida eléctrica y medidores (Centrosur)"], ["etapa", "Agua potable y alcantarillado (ETAPA)"], ["telecom", "Telecomunicaciones"],
      ["ph", "Declaratoria de propiedad horizontal (si aplica)"]] }
  ]
};
const ENCUESTA = [["calidad", "Calidad de la obra terminada"], ["plazo", "Cumplimiento de plazos"], ["residente", "Atención del residente y del equipo"], ["comunicacion", "Comunicación e informes"], ["seguridad", "Orden, limpieza y seguridad"], ["postventa", "Atención después de la entrega"]];

let sb = null, user = null, perfil = null, obras = [], obraId = "", fase = "inicio";
let c = null, auto = {}, balance = null, sinTabla = false, dirty = false, extraNuevo = { inicio: "", cierre: "" };
const esAdmin = () => perfil && perfil.rol === "admin";
const obra = () => obras.find((o) => o.id === obraId) || {};

/* ---------- datos ---------- */
async function q(build) { const { data, error } = await build(); return error ? null : data || []; }
async function cargarObra() {
  c = null; auto = {}; balance = null; sinTabla = false; dirty = false;
  if (!obraId) return render();
  const { data, error } = await sb.from("ciclo_obra").select("*").eq("obra_id", obraId).maybeSingle();
  if (error) { sinTabla = true; return render(); }
  c = data || { obra_id: obraId, items: {}, extra: [], recepcion: {}, encuesta: null, lecciones: "" };
  c.items = c.items || {}; c.extra = c.extra || []; c.recepcion = c.recepcion || {};
  // lo que la plataforma ya sabe de esta obra
  const [rub, gar, prop, act, rdi, subs, pls, spl] = await Promise.all([
    q(() => sb.from("rubros").select("cantidad,precio,adicional").eq("obra_id", obraId)),
    q(() => sb.from("garantias").select("direccion,tipo,estado,monto").eq("obra_id", obraId)),
    q(() => sb.from("propuestas").select("codigo").eq("obra_id", obraId)),
    q(() => sb.from("actas").select("numero").eq("obra_id", obraId)),
    q(() => sb.from("rdis").select("numero,estado").eq("obra_id", obraId)),
    q(() => sb.from("subcontratos").select("estado,monto,evaluacion").eq("obra_id", obraId)),
    q(() => sb.from("planillas").select("numero,estado,totales").eq("obra_id", obraId).order("numero")),
    q(() => sb.from("subcontrato_planillas").select("totales").eq("obra_id", obraId))
  ]);
  const subVig = (subs || []).filter((s) => s.estado !== "anulado");
  auto = {
    rubros: rub && rub.length ? rub.length + " rubros" : null,
    polizas: gar && gar.some((g) => g.direccion === "entregada") ? gar.filter((g) => g.direccion === "entregada").length + " pólizas registradas" : null,
    propuesta: prop && prop.length ? "propuesta " + (prop[0].codigo || "") : null,
    acta: act && act.length ? act.length + " actas" : null,
    rdi: rdi && rdi.length ? rdi.length + " RDI" : null,
    subcontratos: subVig.length ? subVig.length + " subcontratos" : null,
    subterminados: subVig.length ? subVig.filter((s) => s.estado === "terminado").length + " de " + subVig.length + " terminados" : null
  };
  const ult = (pls || []).slice(-1)[0], t = (ult && ult.totales) || {};
  const contrato = (rub || []).filter((r) => !r.adicional).reduce((s, r) => s + num(r.cantidad) * num(r.precio), 0);
  const adic = (rub || []).filter((r) => r.adicional).reduce((s, r) => s + num(r.cantidad) * num(r.precio), 0);
  balance = { contrato, adic, planillado: num(t.acumulado), pagadas: (pls || []).filter((p) => p.estado === "pagada").reduce((s, p) => s + num((p.totales || {}).liquido), 0),
    pendientes: (pls || []).filter((p) => p.estado === "presentada" || p.estado === "aprobada").reduce((s, p) => s + num((p.totales || {}).liquido), 0), nPls: (pls || []).length,
    subMonto: subVig.reduce((s, x) => s + num(x.monto), 0), subPlan: (spl || []).reduce((s, p) => s + num((p.totales || {}).bruto), 0),
    garantiaMandante: (gar || []).filter((g) => g.direccion === "entregada" && g.estado === "vigente").reduce((s, g) => s + num(g.monto), 0) };
  render();
}

/* ---------- avance de las listas ---------- */
function itemsDe(f) { return LISTAS[f].flatMap((l) => l.items.map(([k]) => f + "." + l.id + "." + k)).concat(c.extra.filter((x) => x.fase === f).map((x) => "x." + x.id)); }
const avance = (f) => { const ks = itemsDe(f); const h = ks.filter((k) => (c.items[k] || {}).hecho).length; return { h, n: ks.length, p: ks.length ? h / ks.length * 100 : 0 }; };

/* ---------- render ---------- */
function setDirty(v) { dirty = v; const e = $("#estado"); e.className = "state" + (v ? " dirty" : ""); e.textContent = v ? "Sin guardar" : "Guardado"; }
function itemHTML(key, texto, autoKey, borrable) {
  const st = c.items[key] || {}, ok = !!st.hecho, det = autoKey && auto[autoKey];
  return `<div class="ck${ok ? " hecho" : ""}">
    <label class="chk" for="k_${esc(key)}"><input type="checkbox" id="k_${esc(key)}" data-k="${esc(key)}"${ok ? " checked" : ""}><span>${esc(texto)}${det ? `<em class="det">En la plataforma: ${esc(det)}</em>` : ""}</span></label>
    ${ok ? `<div class="ckx"><input type="date" data-kf="${esc(key)}" value="${esc(st.fecha || "")}" aria-label="Fecha"><input type="text" data-kr="${esc(key)}" value="${esc(st.responsable || "")}" placeholder="Responsable" aria-label="Responsable"><input type="text" data-kn="${esc(key)}" value="${esc(st.nota || "")}" placeholder="Nota (N.° de acta, ubicación del documento…)" aria-label="Nota"></div>` : ""}
    ${borrable ? `<button class="x" type="button" data-delx="${esc(borrable)}" aria-label="Quitar punto">×</button>` : ""}</div>`;
}
function render() {
  const m = $("#main");
  $("#top").hidden = !user; $("#dock").hidden = !c;
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (!obraId) { m.innerHTML = `<div class="empty"><b>Sin obras asignadas.</b></div>`; return; }
  if (sinTabla) { m.innerHTML = `<div class="empty"><b>Falta activar inicio y cierre de obra.</b><span>Ejecuta <b>supabase/ciclo.sql</b> en Supabase → SQL Editor y recarga.</span></div>`; return; }
  if (!c) { m.innerHTML = `<div class="empty">Cargando…</div>`; return; }
  const o = obra(), ai = avance("inicio"), ac = avance("cierre");
  let body = "";
  if (fase === "inicio") {
    body = `<section class="obracard"><h3 class="h3n">Datos de arranque</h3>
      <div class="grid2"><label class="fld" for="oIni"><span>Inicio contractual</span><input id="oIni" type="date" data-o="inicio" value="${esc(o.inicio || "")}" ${esAdmin() ? "" : "disabled"}></label>
        <label class="fld" for="oPlazo"><span>Plazo (días calendario)</span><input id="oPlazo" type="number" inputmode="numeric" data-o="plazo" value="${esc(o.plazo || "")}" ${esAdmin() ? "" : "disabled"}></label></div>
      <span class="code">${o.inicio && o.plazo ? "Término contractual: " + fmtF(ymd(new Date(pd(o.inicio).getTime() + (num(o.plazo) - 1) * 864e5))) + ". El tablero gerencial usa estas fechas." : "Con el inicio y el plazo, el tablero gerencial arma la curva de avance y el semáforo de plazo."}${esAdmin() ? "" : " Solo el administrador los cambia."}</span></section>`;
  } else {
    const r = c.recepcion, b = balance || {}, total = b.contrato + b.adic;
    const real = o.inicio && r.provisional ? dias(o.inicio, r.provisional) + 1 : null;
    body = `<section class="obracard"><h3 class="h3n">Recepción</h3>
      <div class="grid2"><label class="fld" for="rProv"><span>Recepción provisional</span><input id="rProv" type="date" data-r="provisional" value="${esc(r.provisional || "")}"></label>
        <label class="fld" for="rDef"><span>Recepción definitiva</span><input id="rDef" type="date" data-r="definitiva" value="${esc(r.definitiva || "")}"></label></div>
      ${real != null ? `<span class="code">Plazo real ${real} días frente a ${o.plazo || "—"} contractuales (${real - num(o.plazo) > 0 ? real - num(o.plazo) + " días de exceso" : "dentro del plazo"}).</span>` : ""}</section>
    <section class="obracard"><h3 class="h3n">Balance final</h3>
      <div class="kv2"><span>Contrato original</span><b>${money(b.contrato)}</b><span>Obras adicionales</span><b>${money(b.adic)}</b><span>Total</span><b>${money(total)}</b>
        <span>Planillado (${b.nPls} planillas)</span><b>${money(b.planillado)} · ${pct(total ? b.planillado / total * 100 : 0)}</b><span>Saldo por planillar</span><b>${money(total - b.planillado)}</b>
        <span>Cobrado (planillas pagadas)</span><b>${money(b.pagadas)}</b><span>Por cobrar</span><b class="${b.pendientes ? "rojo" : ""}">${money(b.pendientes)}</b>
        <span>Subcontratado / planillado</span><b>${money(b.subMonto)} / ${money(b.subPlan)}</b><span>Pólizas vigentes ante el mandante</span><b>${money(b.garantiaMandante)}</b></div>
      <span class="code">Se calcula con Estado de pago y Subcontratos. Para el balance de costos reales hará falta el programa de control de costos.</span></section>`;
  }
  const listas = LISTAS[fase].map((l) => { const ks = l.items.map(([k]) => fase + "." + l.id + "." + k), h = ks.filter((k) => (c.items[k] || {}).hecho).length; return `
    <details class="sec" data-sec="${fase + l.id}" open><summary><span class="num">${h}/${ks.length}</span><h2>${esc(l.titulo)}</h2></summary><div class="body"><div class="cks">${l.items.map(([k, t, a]) => itemHTML(fase + "." + l.id + "." + k, t, a)).join("")}</div></div></details>`; }).join("");
  const extras = c.extra.filter((x) => x.fase === fase);
  m.innerHTML = `
  <div class="segtabs" role="tablist"><button type="button" role="tab" data-fase="inicio" aria-selected="${fase === "inicio"}">Inicio · ${pct(ai.p)}</button><button type="button" role="tab" data-fase="cierre" aria-selected="${fase === "cierre"}">Cierre · ${pct(ac.p)}</button></div>
  <div class="meter big"><i style="width:${(fase === "inicio" ? ai : ac).p.toFixed(1)}%"></i></div>
  <span class="code">${(fase === "inicio" ? ai : ac).h} de ${(fase === "inicio" ? ai : ac).n} puntos cumplidos. Al marcar uno, registra la fecha, el responsable y dónde está el documento.</span>
  ${body}${listas}
  <details class="sec" data-sec="${fase}x"${extras.length ? " open" : ""}><summary><span class="num">${extras.length}</span><h2>Puntos propios de esta obra</h2></summary><div class="body">
    <div class="cks">${extras.map((x) => itemHTML("x." + x.id, x.texto, null, x.id)).join("")}</div>
    <div class="addrow"><input type="text" id="nuevoPunto" value="${esc(extraNuevo[fase])}" placeholder="Ej.: Permiso de ocupación de vía pública" aria-label="Nuevo punto"><button class="btn sm" type="button" data-act="addX">Agregar</button></div>
  </div></details>
  ${fase === "cierre" ? `
  <details class="sec" data-sec="enc"${c.encuesta ? " open" : ""}><summary><span class="num">★</span><h2>Encuesta de satisfacción del cliente</h2><span class="sum">${c.encuesta && promEnc() ? promEnc().toLocaleString("es-EC", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " / 5" : "sin respuesta"}</span></summary><div class="body">
    <span class="code">Hazla con el cliente al entregar la obra. 1 = muy insatisfecho · 5 = muy satisfecho.</span>
    ${ENCUESTA.map(([k, l]) => `<div class="rate"><span>${l}</span><div class="stars" role="group" aria-label="${l}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-enc="${k}" data-n="${n}" aria-pressed="${num((c.encuesta || {})[k]) >= n}">${n}</button>`).join("")}</div></div>`).join("")}
    <label class="chk" for="encRec"><input type="checkbox" id="encRec" data-encrec="1"${(c.encuesta || {}).recomendaria ? " checked" : ""}>Nos volvería a contratar o recomendaría</label>
    <div class="grid2"><label class="fld" for="encNom"><span>Respondió</span><input id="encNom" type="text" data-encf="nombre" value="${esc((c.encuesta || {}).nombre || "")}"></label><label class="fld" for="encFec"><span>Fecha</span><input id="encFec" type="date" data-encf="fecha" value="${esc((c.encuesta || {}).fecha || "")}"></label></div>
    <label class="fld" for="encCom"><span>Comentarios del cliente</span><textarea id="encCom" data-encf="comentario" rows="3">${esc((c.encuesta || {}).comentario || "")}</textarea></label>
  </div></details>
  <details class="sec" data-sec="lec"${c.lecciones ? " open" : ""}><summary><span class="num">L</span><h2>Lecciones aprendidas</h2></summary><div class="body">
    <label class="fld" for="lec"><span>Qué repetiríamos y qué haríamos distinto</span><textarea id="lec" data-lec="1" rows="5" placeholder="Ej.: pedir el hormigón con 48 h de anticipación en temporada de lluvia; contratar al subcontratista de mampostería con fondo de garantía del 10 %…">${esc(c.lecciones || "")}</textarea></label>
  </div></details>` : ""}`;
  setDirty(dirty); aplicarSecciones();
}
const promEnc = () => { const e = c.encuesta || {}, v = ENCUESTA.map(([k]) => num(e[k])).filter(Boolean); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
const secAb = {};
document.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.sec) secAb[d.dataset.sec] = d.open; }, true);
function aplicarSecciones() { document.querySelectorAll("details[data-sec]").forEach((d) => { if (d.dataset.sec in secAb) d.open = secAb[d.dataset.sec]; }); }

/* ---------- guardar ---------- */
let obraCambios = {};
async function guardar() {
  const btn = $("#btnGuardar"); btn.disabled = true;
  try {
    const row = { obra_id: obraId, items: c.items, extra: c.extra, recepcion: c.recepcion, encuesta: c.encuesta || null, lecciones: c.lecciones || null, actualizado: new Date().toISOString() };
    const ex = await sb.from("ciclo_obra").select("obra_id").eq("obra_id", obraId).maybeSingle();
    const { error } = ex.data ? await sb.from("ciclo_obra").update(row).eq("obra_id", obraId) : await sb.from("ciclo_obra").insert(row);
    if (error) throw error;
    if (Object.keys(obraCambios).length && esAdmin()) {
      const { error: e2 } = await sb.from("obras").update(obraCambios).eq("id", obraId);
      if (e2) throw e2; Object.assign(obra(), obraCambios); obraCambios = {};
    }
    setDirty(false); render(); toast("Guardado");
  } catch (err) { toast("No se pudo guardar: " + (err.message || "revisa tu conexión")); }
  finally { btn.disabled = false; }
}

/* ---------- PDF (A4 vertical) ---------- */
function pdf() {
  if (!window.jspdf) return toast("No se cargó el generador de PDF. Revisa tu conexión y recarga.");
  if (dirty) return toast("Guarda antes de generar el PDF.");
  const o = obra(), doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  { const _t = doc.text.bind(doc), _l = (s) => typeof s === "string" ? s.replace(/[−–]/g, "-").replace(/✓/g, "»").replace(/[★☆]/g, "*") : s; doc.text = (s, ...a) => _t(Array.isArray(s) ? s.map(_l) : _l(s), ...a); }
  const M = 12, W = 186, NAVY = [58, 61, 64], AMB = [169, 165, 157], GRID = [150, 150, 150], LBL = [243, 242, 239], OKC = [232, 238, 233];
  const titulo = fase === "inicio" ? "PROTOCOLO DE INICIO DE OBRA" : "PROTOCOLO DE CIERRE DE OBRA";
  let y = 0, page = 1;
  const fit = (s, w) => { s = String(s ?? ""); while (s && doc.getTextWidth(s) > w) s = s.slice(0, -2) + "…"; return s; };
  const header = () => {
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.rect(M, M, W, 18); doc.line(M + 44, M, M + 44, M + 18); doc.line(M + W - 44, M, M + W - 44, M + 18);
    doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("DLV", M + 5, M + 9.5); doc.setFillColor(...AMB); doc.rect(M + 5, M + 10.8, 15, 1, "F");
    doc.setFontSize(6.2); doc.text("CONSTRUCCIONES CÍA. LTDA.", M + 5, M + 14.6);
    doc.setFontSize(11.5); doc.text(titulo, M + 44 + (W - 88) / 2, M + 8.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85, 85, 85); doc.text(fit(o.nombre, W - 92), M + 44 + (W - 88) / 2, M + 13.5, { align: "center" });
    const a = avance(fase);
    [["FECHA", fmtF(hoy())], ["CUMPLIDO", a.h + " de " + a.n], ["PÁGINA", String(page)]].forEach(([k, v], i) => { const x = M + W - 44, yy = M + i * 6; if (i) doc.line(x, yy, M + W, yy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4); doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(v, M + W - 1.5, yy + 4, { align: "right" }); });
    doc.setFontSize(5.6); doc.setTextColor(120, 120, 120); doc.text("DLV Construcciones Cía. Ltda. · Av. Primero de Mayo y Av. de las Américas, Cuenca", M, 290);
    y = M + 22;
  };
  const need = (h) => { if (y + h > 282) { doc.addPage(); page++; header(); } };
  const bar = (t) => { need(14); doc.setFillColor(...NAVY); doc.rect(M, y, W, 5.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(7.4); doc.setTextColor(255, 255, 255); doc.text(t, M + 2, y + 3.9); y += 6.5; };
  const fila = (texto, st) => {
    const ls = doc.splitTextToSize(texto, 92), nota = [st.responsable, st.nota].filter(Boolean).join(" · "), ln = nota ? doc.splitTextToSize(nota, 58) : [];
    const h = Math.max(6, Math.max(ls.length, ln.length) * 3.4 + 2); need(h);
    if (st.hecho) { doc.setFillColor(...OKC); doc.rect(M, y, 12, h, "F"); }
    doc.setDrawColor(210, 210, 210); doc.rect(M, y, W, h); doc.line(M + 12, y, M + 12, y + h); doc.line(M + 106, y, M + 106, y + h); doc.line(M + 126, y, M + 126, y + h);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(30, 30, 30); doc.text(st.hecho ? "SÍ" : "NO", M + 6, y + 4, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.text(ls, M + 14, y + 4); doc.text(st.hecho && st.fecha ? fmtF(st.fecha) : "", M + 108, y + 4); doc.setFontSize(6.4); doc.text(ln, M + 128, y + 4); y += h;
  };
  header();
  doc.setFontSize(7.2);
  [["OBRA", o.nombre], ["CLIENTE", o.cliente], ["INICIO", fmtF(o.inicio)], ["PLAZO", o.plazo ? o.plazo + " días" : "—"], ["RESIDENTE", o.residente], ["FISCALIZACIÓN", o.fiscalizador]].forEach(([k, v], i) => {
    const x = M + (i % 2) * (W / 2), yy = y + Math.floor(i / 2) * 6; doc.setFillColor(...LBL); doc.rect(x, yy, 28, 6, "F"); doc.setDrawColor(...GRID); doc.rect(x, yy, W / 2, 6);
    doc.setFont("helvetica", "bold"); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4); doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(fit(v || "—", W / 2 - 32), x + 30, yy + 4); });
  y += 21;
  for (const l of LISTAS[fase]) { bar(l.titulo.toUpperCase()); for (const [k, t] of l.items) fila(t, c.items[fase + "." + l.id + "." + k] || {}); y += 3; }
  const ex = c.extra.filter((x) => x.fase === fase);
  if (ex.length) { bar("PUNTOS PROPIOS DE LA OBRA"); for (const x of ex) fila(x.texto, c.items["x." + x.id] || {}); y += 3; }
  if (fase === "cierre") {
    const b = balance || {}, total = b.contrato + b.adic, r = c.recepcion;
    bar("BALANCE FINAL");
    [["Contrato original", money(b.contrato)], ["Obras adicionales", money(b.adic)], ["Total", money(total)], ["Planillado", money(b.planillado)], ["Saldo por planillar", money(total - b.planillado)], ["Por cobrar", money(b.pendientes)],
     ["Recepción provisional", fmtF(r.provisional)], ["Recepción definitiva", fmtF(r.definitiva)]].forEach(([k, v], i) => { const x = M + (i % 2) * (W / 2); if (i % 2 === 0) need(6);
      doc.setDrawColor(210, 210, 210); doc.rect(x, y, W / 2, 6); doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(60, 60, 60); doc.text(k, x + 2, y + 4); doc.setTextColor(30, 30, 30); doc.text(v, x + W / 2 - 2, y + 4, { align: "right" }); if (i % 2 === 1) y += 6; });
    y += 4;
    if (c.encuesta) {
      bar("ENCUESTA DE SATISFACCIÓN DEL CLIENTE");
      for (const [k, l] of ENCUESTA) { need(5); doc.setFont("helvetica", "normal"); doc.setFontSize(7.4); doc.setTextColor(30, 30, 30); doc.text(l, M + 2, y + 3.6); doc.text(num(c.encuesta[k]) ? num(c.encuesta[k]) + " / 5" : "—", M + W - 2, y + 3.6, { align: "right" }); y += 5; }
      need(10); doc.setFont("helvetica", "bold"); doc.text("Promedio: " + (promEnc() ? promEnc().toLocaleString("es-EC", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " / 5" : "—") + "   ·   Nos recomendaría: " + (c.encuesta.recomendaria ? "Sí" : "No"), M + 2, y + 4); y += 6;
      if (c.encuesta.comentario) { doc.setFont("helvetica", "normal"); for (const ln of doc.splitTextToSize("Comentario: " + c.encuesta.comentario, W - 4)) { need(4); doc.text(ln, M + 2, y + 3.4); y += 4; } }
      y += 3;
    }
    if (c.lecciones) { bar("LECCIONES APRENDIDAS"); doc.setFont("helvetica", "normal"); doc.setFontSize(7.6); doc.setTextColor(30, 30, 30); for (const ln of doc.splitTextToSize(c.lecciones, W - 4)) { need(4.2); doc.text(ln, M + 2, y + 3.4); y += 4; } y += 3; }
  }
  need(30); y += 4; const fw = (W - 12) / 3;
  [["RESIDENTE DE OBRA", o.residente], ["GERENTE DE PROYECTO", o.gerente], [fase === "inicio" ? "FISCALIZACIÓN" : "CLIENTE / MANDANTE", fase === "inicio" ? o.fiscalizador : o.cliente]].forEach(([t, n], i) => { const x = M + i * (fw + 6);
    doc.setFillColor(...NAVY); doc.rect(x, y, fw, 4, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.2); doc.setTextColor(255, 255, 255); doc.text(t, x + fw / 2, y + 2.8, { align: "center" });
    doc.setDrawColor(...GRID); doc.rect(x, y + 4, fw, 18); doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(60, 60, 60); doc.text(fit(n || "Nombre / firma", fw - 4), x + 2, y + 20); });
  const name = `${fase === "inicio" ? "Inicio" : "Cierre"} de obra ${(o.nombre || "").replace(/[\\/:*?"<>|]/g, "")}.pdf`;
  const blob = doc.output("blob"), file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch((e) => { if (e.name !== "AbortError") doc.save(name); });
  else doc.save(name);
}

/* ---------- eventos ---------- */
const st = (k) => (c.items[k] = c.items[k] || {});
document.addEventListener("input", (e) => {
  const t = e.target; if (!c) return;
  if (t.dataset.kf) { st(t.dataset.kf).fecha = t.value; setDirty(true); }
  else if (t.dataset.kr) { st(t.dataset.kr).responsable = t.value; setDirty(true); }
  else if (t.dataset.kn) { st(t.dataset.kn).nota = t.value; setDirty(true); }
  else if (t.dataset.r) { c.recepcion[t.dataset.r] = t.value; setDirty(true); }
  else if (t.dataset.o) { obraCambios[t.dataset.o] = t.dataset.o === "plazo" ? (parseInt(t.value, 10) || null) : t.value || null; setDirty(true); }
  else if (t.dataset.encf) { c.encuesta = { ...(c.encuesta || {}), [t.dataset.encf]: t.value }; setDirty(true); }
  else if (t.dataset.lec) { c.lecciones = t.value; setDirty(true); }
  else if (t.id === "nuevoPunto") extraNuevo[fase] = t.value;
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "obraSel") { if (dirty && !confirmCambio()) { t.value = obraId; return; } obraId = t.value; try { localStorage.setItem("dlv-obra", obraId); } catch (_) {} cargarObra(); return; }
  if (!c) return;
  if (t.dataset.k) { const s = st(t.dataset.k); s.hecho = t.checked; if (t.checked && !s.fecha) s.fecha = hoy(); setDirty(true); render(); return; }
  if (t.dataset.encrec) { c.encuesta = { ...(c.encuesta || {}), recomendaria: t.checked }; setDirty(true); }
  if ((t.dataset.r || t.dataset.o) && t.type === "date") render();
});
let avisoCambio = 0;
function confirmCambio() { if (Date.now() - avisoCambio < 4000) return true; avisoCambio = Date.now(); toast("Tienes cambios sin guardar. Vuelve a elegir la obra para descartarlos."); return false; }
document.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || !c) return;
  if (b.dataset.fase) { fase = b.dataset.fase; render(); window.scrollTo(0, 0); return; }
  if (b.dataset.enc) { c.encuesta = { ...(c.encuesta || {}), [b.dataset.enc]: +b.dataset.n, fecha: (c.encuesta || {}).fecha || hoy() }; setDirty(true); render(); return; }
  if (b.dataset.delx) { c.extra = c.extra.filter((x) => x.id !== b.dataset.delx); delete c.items["x." + b.dataset.delx]; setDirty(true); render(); return; }
  if (b.dataset.act === "addX") { const t = (extraNuevo[fase] || "").trim(); if (!t) return toast("Escribe el punto a agregar."); c.extra.push({ id: uid(), fase, texto: t }); extraNuevo[fase] = ""; secAb[fase + "x"] = true; setDirty(true); render(); return; }
  if (b.id === "btnGuardar") return guardar();
  if (b.id === "btnPDF") { try { pdf(); } catch (err) { toast("No se pudo generar el PDF."); } }
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
  const qs = new URLSearchParams(location.search), want = qs.get("obra") || saved;
  obraId = (obras.find((o) => o.id === want) || obras[0] || {}).id || "";
  if (qs.get("fase") === "cierre") fase = "cierre";
  $("#obraSel").innerHTML = obras.length ? obras.map((o) => `<option value="${esc(o.id)}"${o.id === obraId ? " selected" : ""}>${esc(o.nombre)}</option>`).join("") : `<option value="">Sin obras asignadas</option>`;
  await cargarObra();
})();
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
})();
