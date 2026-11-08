// DLV Plataforma — Facturas SRI (solo administradores). Las facturas llegan solas por correo al servicio de integraciones,
// que las valida en el SRI. Aquí se asignan a una obra (crean el gasto en Control de costos) o a una orden de compra,
// se revisan las pendientes del SRI y se concilia el mes con el listado de comprobantes recibidos.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hoy = () => ymd(new Date());
const fmtF = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => "$ " + (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const mesTxt = (k) => { const [y, m] = k.split("-"); return MESES[+m - 1] + " " + y; };
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 4200); }

const TIPOS = { factura: "Factura", nota_credito: "Nota de crédito", nota_debito: "Nota de débito", liquidacion: "Liquidación de compra", retencion: "Retención", guia_remision: "Guía de remisión" };
const EST = { pendiente_sri: "Esperando al SRI", procesada: "Validada", ajena: "No es de DLV", no_encontrada: "No existe en el SRI", no_autorizada: "No autorizada", error: "Error" };
const CATS = { materiales: "Materiales", mano_obra: "Mano de obra", equipos: "Equipos y transporte", indirectos: "Indirectos de obra", otros: "Otros" };
const ORIG = { correo: "correo", listado_sri: "listado SRI", manual: "a mano" };

let sb = null, user = null, perfil = null, obras = [], provs = [], facts = [], links = [], ocs = [], reglas = [], detalle = {}, sinTablas = false, estado = null;
let tab = "asignar", sel = {}, abierto = null, fMes = "", fObra = "", fBus = "", conc = null, trabajando = false;
const esAdmin = () => perfil && perfil.rol === "admin";
const obraNom = (id) => (obras.find((o) => o.id === id) || {}).nombre || "";
const signo = (f) => (f.cod_doc === "04" ? -1 : 1); // la nota de crédito resta
const enOC = (f) => links.find((l) => l.clave_acceso === f.clave_acceso);
const porAsignar = (f) => f.estado === "procesada" && !f.obra_id && !f.categoria && !enOC(f) && ["01", "04", "05", "03"].includes(f.cod_doc);

/* ---------- datos ---------- */
async function tok() { const { data: { session } } = await sb.auth.getSession(); return session ? session.access_token : ""; }
async function integra(ruta, opts = {}) {
  const r = await fetch("/api/integra/" + ruta, { ...opts, headers: { Authorization: "Bearer " + (await tok()), ...(opts.headers || {}) } });
  const ct = r.headers.get("Content-Type") || "";
  if (!ct.includes("json")) { if (!r.ok) throw new Error("El servicio respondió " + r.status); return r; }
  const j = await r.json();
  if (!r.ok) throw new Error(j.mensaje || j.error || "El servicio respondió " + r.status);
  return j;
}
async function cargar() {
  const desde = ymd(new Date(new Date().getFullYear(), new Date().getMonth() - 14, 1));
  const [f, l, o, ob, pv, rg] = await Promise.all([
    sb.from("facturas_proveedor").select("clave_acceso,cod_doc,tipo,ruc_emisor,razon_social,numero,fecha_emision,subtotal,descuento,iva,total,estado,estado_sri,intentos,ultimo_error,origen,email_de,xml_key,pdf_key,en_listado_sri,obra_sugerida_id,obra_id,asignada_por,asignada_en,gasto_id,categoria,creado_en").gte("fecha_emision", desde).order("fecha_emision", { ascending: false }),
    sb.from("compras_orden_facturas").select("orden_id,clave_acceso,numero,gasto_id"),
    sb.from("compras_ordenes").select("id,numero,obra_id,proveedor_ruc,estado,subtotal,fecha,categoria,capitulo,requerimiento_id"),
    sb.from("obras").select("id,nombre,activa").order("nombre"),
    sb.from("proveedores").select("ruc,razon_social,obra_sugerida_id"),
    sb.from("reglas_obra").select("*")
  ]);
  if (f.error) { sinTablas = true; return render(); }
  facts = f.data || []; links = (l.data || []).filter((x) => x.clave_acceso); ocs = o.data || []; obras = (ob.data || []).filter((x) => x.activa !== false); provs = pv.data || []; reglas = rg.data || [];
  render();
  integra("estado").then((e) => { estado = e; render(); }).catch((e) => { estado = { error: e.message }; render(); });
}

/* ---------- render ---------- */
function render() {
  const m = $("#main");
  $("#top").hidden = !user; $("#dock").hidden = true;
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (!esAdmin()) { m.innerHTML = `<div class="empty"><b>Solo para administradores.</b><span>Las facturas de proveedores las revisa la oficina.</span><a class="btn" href="/">Volver al menú</a></div>`; return; }
  if (sinTablas) { m.innerHTML = `<div class="empty"><b>Falta activar Facturas SRI.</b><span>Ejecuta <b>supabase/integraciones.sql</b> (o <b>instalar_todo.sql</b>) en Supabase → SQL Editor y recarga.</span></div>`; return; }
  const pend = facts.filter(porAsignar), esperando = facts.filter((f) => f.estado === "pendiente_sri"), mes = hoy().slice(0, 7);
  const delMes = facts.filter((f) => String(f.fecha_emision).startsWith(mes) && f.estado === "procesada");
  const cargado = delMes.filter((f) => f.obra_id || enOC(f)).reduce((t, f) => t + signo(f) * num(f.subtotal), 0);
  const problemas = facts.filter((f) => ["no_autorizada", "no_encontrada", "error"].includes(f.estado));
  m.innerHTML = `
  ${estado && (estado.error || estado.ok === undefined) ? `<div class="alertbar"><b>El servicio de correo y SRI todavía no está conectado.</b><span>Las facturas que ya estén en la base se ven y se asignan igual. Para que lleguen solas, sigue la sección «Facturas por correo y WhatsApp» de la guía (LEEME).</span></div>` : ""}
  <section class="obracard"><div class="kpis">
    <div><small>Por asignar</small><b class="${pend.length ? "ambar" : ""}">${pend.length}</b></div><div><small>Esperando al SRI</small><b>${esperando.length}</b></div>
    <div><small>Validadas en ${MESES[+mes.slice(5) - 1]}</small><b>${delMes.length}</b></div><div><small>Cargado a obras en el mes</small><b>${money(cargado)}</b></div></div>
    ${estado && estado.ok ? `<span class="code">Llegan solas por correo y se validan en el SRI${estado.facturas && estado.facturas.ruc.length ? " · RUC " + esc(estado.facturas.ruc.join(", ")) : ""}.</span>` : ""}
  </section>
  <div class="segtabs cuatro" role="tablist">${[["asignar", "Por asignar (" + pend.length + ")"], ["todas", "Todas"], ["sri", "SRI" + (problemas.length + esperando.length ? " (" + (problemas.length + esperando.length) + ")" : "")], ["conciliar", "Conciliar"]].map(([k, v]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${v}</button>`).join("")}</div>
  ${tab === "asignar" ? htmlAsignar(pend) : tab === "todas" ? htmlTodas() : tab === "sri" ? htmlSri(esperando, problemas) : htmlConciliar()}`;
}
function sugerida(f) {
  if (f.obra_sugerida_id) return f.obra_sugerida_id;
  const oc = ocsAbiertas(f)[0]; if (oc) return oc.obra_id;
  return (provs.find((p) => p.ruc === f.ruc_emisor) || {}).obra_sugerida_id || "";
}
const ocsAbiertas = (f) => ocs.filter((o) => o.proveedor_ruc === f.ruc_emisor && !["borrador", "anulada", "facturada"].includes(o.estado));
function htmlAsignar(pend) {
  if (!pend.length) return `<div class="empty"><b>Todo asignado.</b><span>Las próximas facturas aparecen aquí apenas lleguen por correo y el SRI las valide.</span></div>`;
  return `<div class="list">${pend.map((f) => {
    const s = sel[f.clave_acceso] || (sel[f.clave_acceso] = { obra: sugerida(f), cat: "materiales", oc: (ocsAbiertas(f)[0] || {}).id || "" });
    const os = ocsAbiertas(f);
    return `<article class="fac${abierto === f.clave_acceso ? " abierta" : ""}">
      <div class="fh"><span class="pr">${esc(f.razon_social || f.ruc_emisor)}</span><b class="tt">${money(signo(f) * num(f.total))}</b></div>
      <div class="meta"><span>${TIPOS[f.tipo] || f.tipo} ${esc(f.numero)}</span><span>${fmtF(f.fecha_emision)}</span><span>sin IVA ${money(signo(f) * num(f.subtotal))}</span><span>por ${ORIG[f.origen] || f.origen}</span></div>
      <div class="meta">${s.obra && !os.length ? `<span class="chip sug">Sugerida: ${esc(obraNom(s.obra))}</span>` : ""}${os.length ? `<span class="chip sug">${os.length === 1 ? "Hay una orden abierta" : os.length + " órdenes abiertas"} de este proveedor</span>` : ""}${f.cod_doc === "04" ? `<span class="chip">Resta del costo</span>` : ""}</div>
      <button class="lnk" type="button" data-ver="${esc(f.clave_acceso)}">${abierto === f.clave_acceso ? "Ocultar detalle" : "Ver detalle"}</button>
      ${abierto === f.clave_acceso ? htmlDetalle(f) : ""}
      <div class="asig">
        ${os.length ? `<label class="fld"><span>Orden de compra</span><select data-soc="${esc(f.clave_acceso)}"><option value="">No es de una orden</option>${os.map((o) => `<option value="${esc(o.id)}"${s.oc === o.id ? " selected" : ""}>${esc(o.numero || "OC")} · ${esc(obraNom(o.obra_id))} · ${money(num(o.subtotal))}</option>`).join("")}</select></label>` : ""}
        ${s.oc ? "" : `<label class="fld"><span>Obra</span><select data-sobra="${esc(f.clave_acceso)}"><option value="">Elegir obra…</option>${obras.map((o) => `<option value="${esc(o.id)}"${s.obra === o.id ? " selected" : ""}>${esc(o.nombre)}</option>`).join("")}</select></label>
        <label class="fld"><span>Cargar como</span><select data-scat="${esc(f.clave_acceso)}">${Object.entries(CATS).map(([k, v]) => `<option value="${k}"${s.cat === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>`}
        <div class="acts"><button class="btn primary" type="button" data-asignar="${esc(f.clave_acceso)}">${s.oc ? "Vincular a la orden" : "Asignar a la obra"}</button><button class="btn sm ghost" type="button" data-noobra="${esc(f.clave_acceso)}">No es de obra</button></div>
      </div></article>`; }).join("")}</div>
  <span class="code">Al asignar, el valor sin IVA entra como gasto de esa obra en Control de costos. Si la factura es de una orden de compra, se vincula a la orden y se cruza con lo recibido.</span>`;
}
function htmlDetalle(f) {
  const d = detalle[f.clave_acceso];
  return `<div class="det">${d ? `<div class="tblw"><table><thead><tr><th>Descripción</th><th>Cant.</th><th>P. unit.</th><th>Subtotal</th></tr></thead><tbody>${d.map((x) => `<tr><td>${esc(x.descripcion)}</td><td>${num(x.cantidad).toLocaleString("es-EC", { maximumFractionDigits: 3 })}</td><td>${money(num(x.precio_unitario))}</td><td>${money(num(x.subtotal))}</td></tr>`).join("")}</tbody></table></div>` : `<span class="code">Cargando…</span>`}
    <div class="acts">${f.pdf_key ? `<button class="btn sm" type="button" data-arch="${esc(f.clave_acceso)}.pdf">PDF</button>` : ""}${f.xml_key ? `<button class="btn sm" type="button" data-arch="${esc(f.clave_acceso)}.xml">XML</button>` : ""}<span class="code clave">Clave ${esc(f.clave_acceso)}</span></div></div>`;
}
function htmlTodas() {
  const q = fBus.trim().toLowerCase();
  const meses = [...new Set(facts.map((f) => String(f.fecha_emision).slice(0, 7)))].sort().reverse();
  const lista = facts.filter((f) => f.estado === "procesada" && (!fMes || String(f.fecha_emision).startsWith(fMes)) && (!fObra || (fObra === "_sin" ? !f.obra_id && !enOC(f) : f.obra_id === fObra || (enOC(f) && (ocs.find((o) => o.id === enOC(f).orden_id) || {}).obra_id === fObra)))
    && (!q || [f.razon_social, f.numero, f.ruc_emisor].some((x) => String(x || "").toLowerCase().includes(q))));
  const tot = lista.reduce((t, f) => t + signo(f) * num(f.subtotal), 0);
  return `<div class="filtros"><label class="fld"><span>Buscar</span><input id="fBus" type="search" placeholder="Proveedor, número o RUC" value="${esc(fBus)}"></label>
    <label class="fld"><span>Mes</span><select id="fMes"><option value="">Todos</option>${meses.map((k) => `<option value="${k}"${fMes === k ? " selected" : ""}>${mesTxt(k)}</option>`).join("")}</select></label>
    <label class="fld"><span>Obra</span><select id="fObra"><option value="">Todas</option><option value="_sin"${fObra === "_sin" ? " selected" : ""}>Sin obra</option>${obras.map((o) => `<option value="${esc(o.id)}"${fObra === o.id ? " selected" : ""}>${esc(o.nombre)}</option>`).join("")}</select></label></div>
  <div class="totline"><span>${lista.length} comprobantes</span><b>${money(tot)}</b><span>sin IVA</span></div>
  <div class="list">${lista.slice(0, 300).map((f) => { const l = enOC(f), oc = l && ocs.find((o) => o.id === l.orden_id); return `
    <button class="rep fr" type="button" data-ver="${esc(f.clave_acceso)}"><span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${esc(f.razon_social || f.ruc_emisor)}</span>
      <span class="d">${esc([TIPOS[f.tipo] || f.tipo, f.numero, fmtF(f.fecha_emision)].join(" · "))}</span>
      <span>${oc ? `<span class="pill">${esc(oc.numero || "OC")} · ${esc(obraNom(oc.obra_id))}</span>` : f.obra_id ? `<span class="pill">${esc(obraNom(f.obra_id))}</span>` : f.categoria === "oficina" ? `<span class="pill">Oficina</span>` : `<span class="pill gp-aviso">Por asignar</span>`}${f.en_listado_sri ? "" : ` <span class="pill">aún no en el listado SRI</span>`}</span></span>
      <b class="mt">${money(signo(f) * num(f.subtotal))}</b></button>
    ${abierto === f.clave_acceso ? htmlDetalle(f) + (f.obra_id || f.categoria === "oficina" ? `<div><button class="btn sm ghost" type="button" data-desasignar="${esc(f.clave_acceso)}">Quitar la asignación${f.gasto_id ? " y su gasto" : ""}</button></div>` : "") : ""}`; }).join("") || `<div class="empty"><span>No hay comprobantes con ese filtro.</span></div>`}</div>`;
}
function htmlSri(esperando, problemas) {
  const fila = (f) => `<div class="rep fr"><span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${esc(f.razon_social || f.ruc_emisor)} · ${esc(f.numero)}</span>
    <span class="d">${fmtF(f.fecha_emision)} · ${EST[f.estado] || f.estado}${f.intentos ? " · " + f.intentos + " intentos" : ""}${f.ultimo_error ? " · " + esc(String(f.ultimo_error).slice(0, 80)) : ""}</span></span><span class="pill ${f.estado === "pendiente_sri" ? "" : "gp-mal"}">${EST[f.estado] || f.estado}</span></div>`;
  return `<section class="obracard"><div class="listhead"><h2 class="h2">Esperando al SRI</h2><button class="btn sm" type="button" data-act="procesar"${trabajando ? " disabled" : ""}>Reintentar ahora</button></div>
    <span class="code">Cuando una factura recién emitida aún no aparece en el SRI, el servicio la vuelve a consultar cada 15 minutos con espera creciente.</span>
    <div class="list">${esperando.map(fila).join("") || `<span class="code">Ninguna.</span>`}</div></section>
  ${problemas.length ? `<section class="obracard"><div class="listhead"><h2 class="h2">Con problemas</h2></div><span class="code">No autorizadas, inexistentes o con error: revísalas con el proveedor.</span><div class="list">${problemas.map(fila).join("")}</div></section>` : ""}
  <section class="obracard"><div class="listhead"><h2 class="h2">Agregar por clave de acceso</h2></div>
    <span class="code">Para una factura que no llegó por correo: copia los 49 dígitos de la clave de acceso del RIDE.</span>
    <div class="clavebox"><label class="fld"><span>Clave de acceso</span><input id="clave" type="text" inputmode="numeric" maxlength="60" placeholder="0711202601019078123400120020010000034121234567811"></label><button class="btn primary" type="button" data-act="clave"${trabajando ? " disabled" : ""}>Consultar al SRI</button></div></section>`;
}
function htmlConciliar() {
  return `<section class="obracard"><div class="listhead"><h2 class="h2">Conciliación mensual</h2></div>
    <ol class="pasos"><li>Entra a SRI en línea → Facturación electrónica → <b>Comprobantes electrónicos recibidos</b>.</li><li>Elige el mes y descarga el listado en TXT.</li><li>Súbelo aquí: se agregan las que no llegaron por correo y se marcan las que están en el sistema pero no en el SRI (posibles anuladas).</li></ol>
    <label class="fld"><span>Listado del SRI (TXT)</span><input id="txtSri" type="file" accept=".txt,text/plain"></label>
    <div><button class="btn primary" type="button" data-act="conciliar"${trabajando ? " disabled" : ""}>${trabajando ? "Comparando…" : "Conciliar"}</button></div>
    ${conc ? `<div class="res">
      <div><span class="chip ok">${conc.ya_registradas}</span> de ${conc.en_listado} comprobantes del listado ya estaban en el sistema.</div>
      <div><span class="chip ${conc.nuevas.length ? "aviso" : "ok"}">${conc.nuevas.length}</span> no habían llegado por correo y se agregaron${conc.nuevas.length ? ":" : "."}${conc.nuevas.length ? `<ul>${conc.nuevas.slice(0, 30).map((n) => `<li>${esc(n.proveedor || n.ruc)} · ${esc(n.numero)} · ${fmtF(n.fecha)}</li>`).join("")}</ul>` : ""}</div>
      <div><span class="chip ${conc.en_sistema_no_en_listado.length ? "aviso" : "ok"}">${conc.en_sistema_no_en_listado.length}</span> están en el sistema pero no en el listado${conc.en_sistema_no_en_listado.length ? " (revisa si fueron anuladas):" : "."}${conc.en_sistema_no_en_listado.length ? `<ul>${conc.en_sistema_no_en_listado.slice(0, 30).map((n) => `<li>${esc(n.proveedor || "")} · ${esc(n.numero)}${n.total != null ? " · " + money(num(n.total)) : ""}</li>`).join("")}</ul>` : ""}</div>
    </div>` : ""}</section>
  <section class="obracard"><div class="listhead"><h2 class="h2">Sugerir la obra</h2></div>
    <span class="code">Si la información adicional de la factura o el asunto del correo contiene esta palabra, se sugiere la obra (sin tildes ni mayúsculas). También puedes fijar la obra por defecto de un proveedor en Compras → Proveedores.</span>
    <div class="mini">${reglas.map((g) => `<div><span>«${esc(g.patron)}» → ${esc(obraNom(g.obra_id))}</span><button class="x" type="button" data-delregla="${esc(g.id)}" aria-label="Quitar">×</button></div>`).join("") || `<span class="code">Sin reglas todavía.</span>`}</div>
    <div class="grid3"><label class="fld"><span>Palabra</span><input id="rPat" type="text" placeholder="turi"></label><label class="fld"><span>Obra</span><select id="rObra">${obras.map((o) => `<option value="${esc(o.id)}">${esc(o.nombre)}</option>`).join("")}</select></label><div style="align-self:end"><button class="btn" type="button" data-act="regla">Agregar</button></div></div></section>`;
}

/* ---------- acciones ---------- */
async function verDetalle(clave) {
  abierto = abierto === clave ? null : clave; render();
  if (abierto && !detalle[clave]) { const { data } = await sb.from("facturas_proveedor_detalle").select("linea,descripcion,cantidad,precio_unitario,subtotal").eq("clave_acceso", clave).order("linea"); detalle[clave] = data || []; render(); }
}
async function asignar(clave) {
  const f = facts.find((x) => x.clave_acceso === clave), s = sel[clave], quien = (perfil && perfil.nombre) || user.email, ahora = new Date().toISOString();
  const sub = r2(signo(f) * num(f.subtotal));
  if (s.oc) {
    const oc = ocs.find((o) => o.id === s.oc);
    const g = await crearGasto({ obra_id: oc.obra_id, fecha: f.fecha_emision, categoria: oc.categoria || "materiales", capitulo: oc.capitulo || null, orden_id: oc.id, descripcion: oc.numero || "Orden de compra" }, f, sub);
    const { error } = await sb.from("compras_orden_facturas").insert({ orden_id: oc.id, clave_acceso: f.clave_acceso, numero: f.numero, fecha: f.fecha_emision, subtotal: sub, iva: r2(signo(f) * num(f.iva)), total: r2(signo(f) * num(f.total)), gasto_id: g ? g.id : null });
    if (error) return toast("No se pudo vincular: " + error.message);
    links.push({ orden_id: oc.id, clave_acceso: f.clave_acceso, numero: f.numero, gasto_id: g ? g.id : null });
    await actualizarFactura(f, { obra_id: oc.obra_id, gasto_id: g ? g.id : null, asignada_por: quien, asignada_en: ahora });
    return toast("Vinculada a " + (oc.numero || "la orden") + (g ? " · gasto cargado a " + obraNom(oc.obra_id) : ""));
  }
  if (!s.obra) return toast("Elige la obra.");
  const g = await crearGasto({ obra_id: s.obra, fecha: f.fecha_emision, categoria: s.cat }, f, sub);
  await actualizarFactura(f, { obra_id: s.obra, categoria: s.cat, gasto_id: g ? g.id : null, asignada_por: quien, asignada_en: ahora });
  toast(money(sub) + " cargados a " + obraNom(s.obra) + (g ? "" : " (activa Control de costos para crear el gasto)"));
}
async function crearGasto(base, f, sub) {
  let desc = base.descripcion || "";
  if (!desc) { if (!detalle[f.clave_acceso]) { const { data } = await sb.from("facturas_proveedor_detalle").select("descripcion").eq("clave_acceso", f.clave_acceso).order("linea").limit(3); detalle[f.clave_acceso] = data || []; } desc = detalle[f.clave_acceso].slice(0, 2).map((x) => x.descripcion).join(", "); }
  const g = { obra_id: base.obra_id, fecha: base.fecha, categoria: base.categoria, proveedor: f.razon_social || f.ruc_emisor, documento: f.numero, descripcion: (TIPOS[f.tipo] && f.cod_doc !== "01" ? TIPOS[f.tipo] + ": " : "") + (desc || "Factura de proveedor"), capitulo: base.capitulo || null, monto: sub, pagado: false, origen: "factura", orden_id: base.orden_id || null };
  let { data, error } = await sb.from("gastos").insert(g).select().single();
  if (error && /orden_id/.test(error.message || "")) { delete g.orden_id; ({ data, error } = await sb.from("gastos").insert(g).select().single()); }
  return error ? null : data;
}
async function actualizarFactura(f, patch) {
  const { data, error } = await sb.from("facturas_proveedor").update(patch).eq("clave_acceso", f.clave_acceso).select().single();
  if (error) { toast("No se pudo guardar: " + error.message); return; }
  Object.assign(f, data || patch); delete sel[f.clave_acceso]; render();
}
async function desasignar(clave) {
  const f = facts.find((x) => x.clave_acceso === clave);
  if (enOC(f)) return toast("Está vinculada a una orden: quítala desde Compras.");
  if (f.gasto_id) await sb.from("gastos").delete().eq("id", f.gasto_id);
  await actualizarFactura(f, { obra_id: null, categoria: null, gasto_id: null, asignada_por: null, asignada_en: null });
  toast("Asignación quitada");
}
async function abrirArchivo(ruta) {
  const w = window.open("", "_blank");
  try { const r = await integra("facturas/archivo/" + ruta); const u = URL.createObjectURL(await r.blob()); if (w) w.location = u; else location.href = u; setTimeout(() => URL.revokeObjectURL(u), 60000); }
  catch (e) { if (w) w.close(); toast(e.message); }
}

/* ---------- eventos ---------- */
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "fBus") { fBus = t.value; const p = t.selectionStart; render(); const b = $("#fBus"); b.focus(); b.setSelectionRange(p, p); }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "fMes") { fMes = t.value; render(); return; }
  if (t.id === "fObra") { fObra = t.value; render(); return; }
  if (t.dataset.sobra) { sel[t.dataset.sobra].obra = t.value; return; }
  if (t.dataset.scat) { sel[t.dataset.scat].cat = t.value; return; }
  if (t.dataset.soc) { sel[t.dataset.soc].oc = t.value; render(); return; }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; abierto = null; render(); return; }
  if (b.dataset.ver) return verDetalle(b.dataset.ver);
  if (b.dataset.arch) return abrirArchivo(b.dataset.arch);
  if (b.dataset.asignar) { b.disabled = true; try { await asignar(b.dataset.asignar); } finally { b.disabled = false; } return; }
  if (b.dataset.noobra) { const f = facts.find((x) => x.clave_acceso === b.dataset.noobra); await actualizarFactura(f, { categoria: "oficina", asignada_por: (perfil && perfil.nombre) || user.email, asignada_en: new Date().toISOString() }); toast("Marcada como gasto de oficina (no entra a ninguna obra)"); return; }
  if (b.dataset.desasignar) return desasignar(b.dataset.desasignar);
  if (b.dataset.delregla) { const { error } = await sb.from("reglas_obra").delete().eq("id", b.dataset.delregla); if (!error) reglas = reglas.filter((x) => String(x.id) !== b.dataset.delregla); render(); return; }
  const a = b.dataset.act;
  if (a === "regla") {
    const pat = ($("#rPat").value || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); if (!pat) return toast("Escribe la palabra.");
    const { data, error } = await sb.from("reglas_obra").insert({ patron: pat, obra_id: $("#rObra").value }).select().single();
    if (error) return toast("No se pudo guardar: " + error.message); reglas.push(data); render(); return;
  }
  if (a === "conciliar") {
    const f = $("#txtSri").files[0]; if (!f) return toast("Elige el TXT del SRI.");
    trabajando = true; render();
    try { conc = await integra("facturas/conciliar", { method: "POST", headers: { "Content-Type": "text/plain" }, body: await f.text() }); toast("Conciliación lista"); await cargar(); }
    catch (err) { toast(err.message); } finally { trabajando = false; render(); }
    return;
  }
  if (a === "clave") {
    const c = ($("#clave").value || "").replace(/\D/g, ""); if (c.length !== 49) return toast("La clave de acceso tiene 49 dígitos.");
    trabajando = true; render();
    try { const r = await integra("facturas/clave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: c }) }); toast("Consultada: " + (Object.values(r || {})[0] || "lista")); await cargar(); }
    catch (err) { toast(err.message); } finally { trabajando = false; render(); }
    return;
  }
  if (a === "procesar") {
    trabajando = true; render();
    try { const r = await integra("facturas/procesar", { method: "POST" }); toast(Object.keys(r || {}).length + " consultadas al SRI"); await cargar(); }
    catch (err) { toast(err.message); } finally { trabajando = false; render(); }
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
  if (!esAdmin()) return render();
  await cargar();
})();
})();
