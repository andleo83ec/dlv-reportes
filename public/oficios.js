// DLV Plataforma — Oficios: cada usuario de la obra redacta (con ayuda de Claude) sobre la misma plantilla,
// el número se asigna al emitir (DLV-TUR-OF-014-2026, mismo correlativo que la correspondencia enviada de /rdi),
// el firmante lo firma con su certificado en su computadora (agente pyHanko) y el QR lleva a /v/<token>.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hoy = () => ymd(new Date());
const masDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const fmtF = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
const fmtFH = (t) => t ? new Date(t).toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fechaLarga = (ciudad, f) => { const [y, m, d] = String(f || hoy()).split("-").map(Number); return `${ciudad || "Cuenca"}, ${d} de ${MESES[m - 1]} de ${y}`; };
const parrafos = (t) => String(t || "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3800); }

const EST = { borrador: "Borrador", pendiente_firma: "Pendiente de firma", firmado: "Firmado", anulado: "Anulado" };
const FILTROS = [["todos", "Todos"], ["pendiente_firma", "Por firmar"], ["firmado", "Firmados"], ["borrador", "Borradores"]];

let sb = null, user = null, perfil = null, obras = [], obraId = "";
let oficios = [], firmantes = [], eventos = [], perfiles = [], sinTablas = false;
let view = "lista", item = null, dirty = false, filtro = "todos", confirmar = "", generando = false;
const esAdmin = () => perfil && perfil.rol === "admin";
const obra = () => obras.find((o) => o.id === obraId) || {};
const sigCodigo = () => { const o = obra(); if (!o.codigo) return "(la obra aún no tiene código)"; const n = oficios.reduce((m, x) => Math.max(m, x.numero || 0), 0) + 1; return `DLV-${o.codigo}-OF-${String(n).padStart(3, "0")}-${new Date().getFullYear()}`; };
const urlVerif = (o) => `${location.origin}/v/${o.token_verificacion}`;

/* ---------- datos ---------- */
async function cargarObra() {
  oficios = []; firmantes = []; sinTablas = false;
  if (obraId) {
    const [a, b] = await Promise.all([
      sb.from("oficios").select("*").eq("obra_id", obraId).order("numero", { ascending: false, nullsFirst: true }).order("creado", { ascending: false }),
      sb.rpc("oficio_firmantes", { p_obra: obraId })
    ]);
    if (a.error) sinTablas = true; else { oficios = a.data || []; firmantes = b.data || []; }
  }
  const id = new URLSearchParams(location.search).get("id");
  const o = id && oficios.find((x) => x.id === id);
  if (o) { history.replaceState(null, "", location.pathname); return abrir(o); }
  render();
}
async function tok() { const { data: { session } } = await sb.auth.getSession(); return session ? session.access_token : ""; }
async function api(q, init = {}) {
  const r = await fetch("/api/oficios?" + q, { ...init, headers: { ...(init.headers || {}), Authorization: "Bearer " + (await tok()) } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Error " + r.status);
  return r;
}
async function abrirArchivo(o, tipo) {
  const w = window.open("", "_blank");   // antes de esperar, para que Safari no la bloquee
  try {
    const r = await api(`accion=archivo&id=${o.id}&tipo=${tipo}`);
    const url = URL.createObjectURL(await r.blob());
    if (w) w.location = url; else { const a = document.createElement("a"); a.href = url; a.download = o.codigo + "." + tipo; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { if (w) w.close(); toast(e.message); }
}

/* ---------- render ---------- */
function setDirty(v) { dirty = v; const e = $("#estado"); e.className = "state" + (v ? " dirty" : ""); e.textContent = v ? "Sin guardar" : "Guardado"; }
function render() {
  const m = $("#main");
  $("#top").hidden = !user;
  const editor = view === "editor";
  $("#dock").hidden = !(editor || view === "config");
  $("#btnEmitir").hidden = !editor; $("#btnGuardar").hidden = !(editor || view === "config");
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (!obraId) { m.innerHTML = `<div class="empty"><b>Sin obras asignadas.</b></div>`; return; }
  if (sinTablas) { m.innerHTML = `<div class="empty"><b>Falta activar los oficios.</b><span>Ejecuta <b>supabase/oficios.sql</b> en Supabase → SQL Editor y recarga.</span></div>`; return; }
  if (view === "editor") return renderEditor(m);
  if (view === "detalle") return renderDetalle(m);
  if (view === "config") return renderConfig(m);
  renderLista(m);
}

function renderLista(m) {
  const mios = oficios.filter((o) => o.estado === "pendiente_firma" && o.firmante_id === user.id);
  const cuenta = (e) => oficios.filter((o) => o.estado === e).length;
  const lista = oficios.filter((o) => filtro === "todos" || o.estado === filtro);
  m.innerHTML = `
  <section class="obracard"><div class="listhead"><h1>Oficios</h1><div class="acts">
      ${esAdmin() ? `<button class="btn sm" type="button" data-act="config">Configuración</button>` : ""}
      <button class="btn hivis" type="button" data-act="nuevo">+ Oficio</button></div></div>
    <div class="kpis"><div><small>Emitidos</small><b>${oficios.filter((o) => o.numero).length}</b></div><div><small>Por firmar</small><b class="${cuenta("pendiente_firma") ? "rojo" : ""}">${cuenta("pendiente_firma")}</b></div>
      <div><small>Firmados</small><b>${cuenta("firmado")}</b></div><div><small>Siguiente número</small><b style="font-size:.8rem">${esc(sigCodigo())}</b></div></div>
    ${mios.length ? `<div class="alertbar"><b>${mios.length === 1 ? "1 oficio espera su firma" : mios.length + " oficios esperan su firma"}</b><span>Ábralos con el agente de firma en su computadora: ${mios.slice(0, 3).map((o) => esc(o.codigo)).join(" · ")}</span></div>` : ""}
    ${!obra().codigo ? `<div class="alertbar"><b>La obra no tiene código de oficios.</b><span>${esAdmin() ? "Asígnelo en Configuración (por ejemplo TUR) antes de emitir." : "Pida a un administrador que lo asigne antes de emitir."}</span></div>` : ""}
  </section>
  <div class="segtabs four" role="tablist">${FILTROS.map(([k, l]) => `<button type="button" role="tab" data-filtro="${k}" aria-selected="${filtro === k}">${l}</button>`).join("")}</div>
  <div class="list">${lista.map((o) => `<button class="rep doc of" type="button" data-of="${esc(o.id)}">
      <span class="cod${o.codigo ? "" : " sin"}">${o.codigo ? esc(o.codigo) : "Borrador"}</span>
      <span class="mid"><span class="t">${esc(o.asunto || "(sin asunto)")}</span>
        <span class="d">Para ${esc([o.destinatario_titulo, o.destinatario_nombre].filter(Boolean).join(" ") || "—")} · ${esc(o.autor_nombre || "")}${o.fecha_emision ? " · " + fmtF(o.fecha_emision) : ""}${o.estado === "pendiente_firma" ? " · firma " + esc(o.firmante_nombre || "") : ""}</span></span>
      <span class="pill of-${o.estado}">${EST[o.estado]}</span></button>`).join("")
    || `<div class="empty"><span>${oficios.length ? "No hay oficios en este filtro." : "Aún no hay oficios en esta obra. Toque «+ Oficio» para redactar el primero."}</span></div>`}</div>
  <span class="code">Los borradores solo los ven su autor y los administradores. El número se asigna al emitir y queda también en la correspondencia enviada (RDI y actas → Oficios).</span>`;
}

function inp(path, label, type = "text", extra = "") { const id = "f_" + path; return `<label class="fld" for="${id}"><span>${label}</span><input id="${id}" type="${type}" data-p="${path}" value="${esc(item[path] ?? "")}"${extra}></label>`; }
function renderEditor(m) {
  const x = item, ob = obra();
  m.innerHTML = `
  <details class="sec" open><summary><span class="num">OF</span><h2>${x.id ? "Borrador" : "Nuevo oficio"}</h2><span class="sum">Al emitir: ${esc(sigCodigo())}</span></summary><div class="body">
    <div class="sub">Destinatario</div>
    <div class="grid2">${inp("destinatario_titulo", "Título (Ing., Arq., Sr.)")}${inp("destinatario_nombre", "Nombre")}</div>
    <div class="grid2">${inp("destinatario_cargo", "Cargo")}${inp("destinatario_institucion", "Institución o empresa")}</div>
    <div class="sub">Contenido</div>
    ${inp("asunto", "Asunto")}
    ${inp("referencia", "Referencia (opcional: contrato, oficio anterior, planilla)")}
    <div class="claudebox"><b>Redactar con Claude</b>
      <label class="fld" for="idea"><span>Escriba en pocas palabras qué quiere decir</span><textarea id="idea" rows="3" placeholder="Ej.: pedir a fiscalización la aprobación del cambio de hormigón f'c 240 a 280 en columnas del 3er piso; respuesta en 3 días"></textarea></label>
      <div class="acts"><select id="tono"><option value="">Tono formal</option><option value="cordial">Cordial</option><option value="firme">Firme</option><option value="urgente">Urgente</option></select>
        <button class="btn sm primary" type="button" data-act="redactar">Redactar</button><button class="btn sm" type="button" data-act="mejorar">Mejorar texto actual</button></div>
      <span class="msg" id="claudeMsg"></span></div>
    <label class="fld" for="f_cuerpo"><span>Cuerpo del oficio (párrafos separados por una línea en blanco)</span><textarea id="f_cuerpo" class="cuerpo" data-p="cuerpo">${esc(x.cuerpo || "")}</textarea></label>
    <div class="grid2">${inp("anexos", "Anexos (opcional)")}${inp("con_copia", "Con copia a (opcional)")}</div>
    <label class="chk" for="f_req"><input type="checkbox" id="f_req" data-c="requiere_respuesta"${x.requiere_respuesta ? " checked" : ""}>Espera respuesta</label>
    ${x.requiere_respuesta ? inp("plazo_respuesta", "Responder hasta", "date") : ""}
    <label class="fld" for="f_firmante"><span>Quién firma</span><select id="f_firmante" data-p="firmante_id"><option value="">— Seleccione —</option>
      ${firmantes.map((f) => `<option value="${esc(f.id)}"${f.id === x.firmante_id ? " selected" : ""}>${esc(f.nombre)}${f.cargo ? " — " + esc(f.cargo) : ""}</option>`).join("")}</select></label>
    ${!firmantes.length ? `<span class="code">No hay firmantes habilitados en esta obra. ${esAdmin() ? "Habilítelos en Configuración." : "Pida a un administrador que habilite uno."}</span>` : ""}
    ${x.id ? (confirmar === "borrar" ? `<div class="confirm"><span>¿Eliminar este borrador?</span><button class="btn sm danger" type="button" data-act="borrarOk">Sí, eliminar</button><button class="btn sm" type="button" data-act="noConf">Cancelar</button></div>`
      : `<div><button class="btn sm danger" type="button" data-act="borrar">Eliminar borrador</button></div>`) : ""}
  </div></details>
  ${confirmar === "emitir" ? `<div class="confirm" style="background:var(--warn-bg)"><span>Se asignará el número <b>${esc(sigCodigo())}</b> y el texto ya no se podrá editar. Si luego hay un error, el oficio se anula y el número queda registrado.</span><button class="btn sm primary" type="button" data-act="emitirOk">Emitir</button><button class="btn sm" type="button" data-act="noConf">Volver</button></div>` : ""}
  <details class="sec" id="prevSec"><summary><span class="num">⎙</span><h2>Vista previa</h2><span class="sum">Plantilla DLV</span></summary><div class="body" id="prevBody">${hoja(x, ob)}</div></details>`;
  setDirty(dirty);
}

function hoja(o, ob) {
  const firma = o.estado === "firmado"
    ? `<div class="sello"><div class="q" id="qrHoja"></div><div>Firmado electrónicamente por:<br><b>${esc(o.certificado_info || o.firmante_nombre || "")}</b><br>${esc(fmtFH(o.firmado_en))}<br>${esc(o.codigo)}</div></div>`
    : `<div class="ph">Aquí irá la firma electrónica con código QR</div>`;
  return `<div class="hojawrap"><div class="hoja">${o.estado === "anulado" ? '<div class="anul">ANULADO</div>' : ""}
    <div class="hc"><b>DLV CONSTRUCCIONES<span>CÍA. LTDA.</span></b><small>Ingeniería · Construcción · Gerencia de proyectos</small></div>
    <div class="hp">Proyecto: ${esc(ob.nombre || "")}</div>
    <div class="der">${esc(fechaLarga(ob.ciudad, o.fecha_emision))}</div>
    <div class="der cod">Oficio N.º ${o.codigo ? esc(o.codigo) : '<span style="color:#b8892e">[se asigna al emitir]</span>'}</div>
    <div><b>${esc([o.destinatario_titulo, o.destinatario_nombre].filter(Boolean).join(" "))}</b></div>
    ${o.destinatario_cargo ? `<div>${esc(o.destinatario_cargo)}</div>` : ""}${o.destinatario_institucion ? `<div>${esc(o.destinatario_institucion)}</div>` : ""}
    <div style="margin-bottom:12px">Presente.-</div>
    <div><b>Asunto:</b> ${esc(o.asunto)}</div>${o.referencia ? `<div><b>Ref.:</b> ${esc(o.referencia)}</div>` : ""}
    <div style="margin:12px 0 8px">De mi consideración:</div>
    ${parrafos(o.cuerpo).map((p) => `<p>${esc(p)}</p>`).join("")}
    <div>Atentamente,</div><div class="fir">${firma}</div>
    <div><b>${esc(o.firmante_nombre || "")}</b></div><div>${esc(o.firmante_cargo || "")}</div>
    <div style="font-size:9px;color:#6b7280;margin-bottom:10px">DLV CONSTRUCCIONES CÍA. LTDA.</div>
    ${o.anexos ? `<div style="font-size:9px"><b>Anexos:</b> ${esc(o.anexos)}</div>` : ""}${o.con_copia ? `<div style="font-size:9px"><b>c.c.:</b> ${esc(o.con_copia)}</div>` : ""}
    <div class="pie">Av. Primero de Mayo y Av. de las Américas · Cuenca, Ecuador<br><i>Documento firmado electrónicamente. Verifique su autenticidad escaneando el código QR.</i></div>
  </div></div>`;
}

function renderDetalle(m) {
  const o = item, ob = obra();
  const soyFirmante = o.estado === "pendiente_firma" && o.firmante_id === user.id;
  const puedeAnular = (o.estado === "firmado" && esAdmin()) || (o.estado === "pendiente_firma" && (esAdmin() || o.autor_id === user.id));
  m.innerHTML = `
  <details class="sec" open><summary><span class="num">OF</span><h2>${esc(o.codigo)}</h2><span class="sum"><span class="pill of-${o.estado}">${EST[o.estado]}</span></span></summary><div class="body">
    ${o.estado === "pendiente_firma" ? `<div class="alertbar"><b>${soyFirmante ? "Este oficio espera su firma." : "Pendiente de firma de " + esc(o.firmante_nombre || "")}</b>
      <span>${soyFirmante ? "En su computadora ejecute el agente de firma (firmar.bat): genera el Word con la plantilla, lo convierte a PDF, lo firma con su certificado y lo sube aquí." : "Cuando lo firme, aparecerá aquí el PDF con el código QR."}</span></div>` : ""}
    ${o.estado === "anulado" ? `<div class="confirm"><span><b>Anulado:</b> ${esc(o.motivo_anulacion)}</span></div>` : ""}
    <div class="ofdet"><dl class="kvof">
        <dt>Para</dt><dd>${esc([o.destinatario_titulo, o.destinatario_nombre].filter(Boolean).join(" "))}${o.destinatario_cargo ? "<br><small>" + esc(o.destinatario_cargo) + "</small>" : ""}${o.destinatario_institucion ? "<br><small>" + esc(o.destinatario_institucion) + "</small>" : ""}</dd>
        <dt>Asunto</dt><dd>${esc(o.asunto)}</dd>${o.referencia ? `<dt>Referencia</dt><dd>${esc(o.referencia)}</dd>` : ""}
        <dt>Emisión</dt><dd>${fmtF(o.fecha_emision)}</dd><dt>Redactó</dt><dd>${esc(o.autor_nombre)}</dd><dt>Firma</dt><dd>${esc(o.firmante_nombre)}</dd>
        ${o.requiere_respuesta ? `<dt>Respuesta hasta</dt><dd>${fmtF(o.plazo_respuesta) || "—"}</dd>` : ""}
        ${o.firmado_en ? `<dt>Firmado</dt><dd>${esc(fmtFH(o.firmado_en))}</dd>` : ""}${o.certificado_info ? `<dt>Certificado</dt><dd>${esc(o.certificado_info)}</dd>` : ""}
        ${o.hash_sha256 ? `<dt>Huella SHA-256</dt><dd class="hash">${esc(o.hash_sha256)}</dd>` : ""}
      </dl>
      <div class="qrbox"><div class="qr" id="qrDet"></div><small>${esc(urlVerif(o))}</small>
        <button class="btn sm" type="button" data-act="copiar">Copiar enlace</button></div></div>
    <div class="acts-row">
      ${o.estado === "firmado" ? `<button class="btn primary" type="button" data-act="pdf">Ver PDF firmado</button><button class="btn" type="button" data-act="docx">Word</button>` : ""}
      <a class="btn" href="/v/${esc(o.token_verificacion)}" target="_blank" rel="noopener">Página del QR</a>
      ${puedeAnular && confirmar !== "anular" ? `<button class="btn danger" type="button" data-act="anular">Anular</button>` : ""}
    </div>
    ${confirmar === "anular" ? `<div class="confirm"><label class="fld" for="motivo" style="flex:1 1 240px"><span>Motivo de la anulación (el número queda registrado)</span><input id="motivo" type="text"></label>
      <button class="btn sm danger" type="button" data-act="anularOk">Anular</button><button class="btn sm" type="button" data-act="noConf">Cancelar</button></div>` : ""}
  </div></details>
  <details class="sec"><summary><span class="num">⎙</span><h2>Texto del oficio</h2><span class="sum">Vista de la plantilla</span></summary><div class="body">${hoja(o, ob)}</div></details>
  <details class="sec"><summary><span class="num">⟲</span><h2>Historial</h2><span class="sum">${eventos.length}</span></summary><div class="body">
    <table class="hist">${eventos.map((e) => `<tr><td>${esc(fmtFH(e.creado))}</td><td>${esc(e.accion)}</td><td>${esc(e.usuario || "")}</td></tr>`).join("")}</table></div></details>`;
  pintarQR("qrDet", o, 150); pintarQR("qrHoja", o, 58);
}
function pintarQR(id, o, size) {
  const el = document.getElementById(id); if (!el || !window.QRCode) return;
  el.innerHTML = ""; new window.QRCode(el, { text: urlVerif(o), width: size * 2, height: size * 2, correctLevel: window.QRCode.CorrectLevel.M });
}

function renderConfig(m) {
  const ob = item.obra;
  m.innerHTML = `
  <details class="sec" open><summary><span class="num">⚙</span><h2>Configuración de oficios</h2><span class="sum">${esc(obra().nombre)}</span></summary><div class="body">
    <div class="sub">Obra</div>
    <div class="grid2">
      <label class="fld" for="c_codigo"><span>Código para la numeración (2–10 letras o números)</span><input id="c_codigo" data-o="codigo" value="${esc(ob.codigo || "")}" maxlength="10" style="text-transform:uppercase"${oficios.some((o) => o.numero) ? " disabled" : ""}></label>
      <label class="fld" for="c_ciudad"><span>Ciudad (para la fecha del oficio)</span><input id="c_ciudad" data-o="ciudad" value="${esc(ob.ciudad || "Cuenca")}"></label>
    </div>
    <span class="code">${oficios.some((o) => o.numero) ? "El código no se puede cambiar porque la obra ya tiene oficios emitidos." : "Forma la numeración: DLV-" + esc(ob.codigo || "TUR") + "-OF-001-" + new Date().getFullYear() + "."}</span>
    <div class="sub">Plantilla Word</div>
    <span class="code">La plantilla general sirve para todas las obras; una plantilla de obra la reemplaza solo aquí. Mantenga los campos {{ … }} y el texto FIRMA_AQUI.</span>
    <div class="acts-row">
      <button class="btn sm" type="button" data-act="bajarPl">Descargar plantilla vigente</button>
      <label class="btn sm" for="plGen">Subir plantilla general<input id="plGen" type="file" accept=".docx" hidden data-pl="general"></label>
      <label class="btn sm" for="plObra">Subir plantilla de esta obra<input id="plObra" type="file" accept=".docx" hidden data-pl="obra"></label>
    </div>
    <div class="sub">Firmantes</div>
    <span class="code">Solo los habilitados pueden ser elegidos para firmar. Deben ser administradores o miembros de la obra y tener su certificado de firma electrónica.</span>
    <div class="list">${perfiles.map((p, i) => `<div class="firm-row">
        <label class="chk" for="pf_${i}" style="border:0;background:transparent;padding:0"><input type="checkbox" id="pf_${i}" data-pf="${i}" data-k="puede_firmar"${p.puede_firmar ? " checked" : ""}></label>
        <span class="who"><b>${esc(p.nombre || p.email)}</b><small>${esc(p.email || "")} · ${p.rol === "admin" ? "Administrador" : "Residente"}</small></span>
        <label class="fld" for="pt_${i}"><span>Título</span><input id="pt_${i}" data-pf="${i}" data-k="titulo" value="${esc(p.titulo || "")}" placeholder="Ing."></label>
        <label class="fld" for="pc_${i}"><span>Cargo</span><input id="pc_${i}" data-pf="${i}" data-k="cargo" value="${esc(p.cargo || "")}" placeholder="Gerente de Proyectos"></label>
      </div>`).join("")}</div>
  </div></details>`;
  setDirty(dirty);
}

/* ---------- acciones ---------- */
function nuevo() {
  item = { obra_id: obraId, destinatario_titulo: "", destinatario_nombre: "", destinatario_cargo: "", destinatario_institucion: "", asunto: "", referencia: "", cuerpo: "",
    anexos: "", con_copia: "", requiere_respuesta: false, plazo_respuesta: masDias(5), firmante_id: firmantes.length === 1 ? firmantes[0].id : "", estado: "borrador" };
  view = "editor"; confirmar = ""; setDirty(false); render(); window.scrollTo(0, 0);
}
async function abrir(o) {
  item = JSON.parse(JSON.stringify(o)); confirmar = ""; dirty = false;
  if (o.estado === "borrador" && (o.autor_id === user.id || esAdmin())) { view = "editor"; return render(); }
  view = "detalle"; eventos = [];
  render(); window.scrollTo(0, 0);
  const { data } = await sb.from("oficio_eventos").select("*").eq("oficio_id", o.id).order("creado");
  eventos = data || []; if (view === "detalle" && item.id === o.id) render();
}
function filaGuardar() {
  const x = item, f = firmantes.find((y) => y.id === x.firmante_id);
  return { obra_id: obraId, destinatario_titulo: x.destinatario_titulo.trim(), destinatario_nombre: x.destinatario_nombre.trim(), destinatario_cargo: x.destinatario_cargo.trim(),
    destinatario_institucion: x.destinatario_institucion.trim(), asunto: x.asunto.trim(), referencia: x.referencia.trim(), cuerpo: x.cuerpo.trim(), anexos: x.anexos.trim(),
    con_copia: x.con_copia.trim(), requiere_respuesta: !!x.requiere_respuesta, plazo_respuesta: x.requiere_respuesta ? x.plazo_respuesta || null : null, firmante_id: f ? f.id : null };
}
async function guardar() {
  const row = filaGuardar();
  const { data, error } = item.id ? await sb.from("oficios").update(row).eq("id", item.id).select().single() : await sb.from("oficios").insert(row).select().single();
  if (error) throw error;
  const i = oficios.findIndex((y) => y.id === data.id); if (i >= 0) oficios[i] = data; else oficios.unshift(data);
  item = JSON.parse(JSON.stringify(data)); setDirty(false);
  return data;
}
async function emitir() {
  const r = filaGuardar();
  if (!r.destinatario_nombre || !r.asunto || !r.cuerpo) return toast("Faltan datos: destinatario, asunto y cuerpo.");
  if (!r.firmante_id) return toast("Elija quién firma.");
  if (/\[[^\]]{2,40}\]/.test(r.cuerpo)) return toast("El cuerpo tiene datos por completar entre corchetes, por ejemplo [fecha].");
  if (!obra().codigo) return toast("La obra no tiene código de oficios. " + (esAdmin() ? "Asígnelo en Configuración." : "Pida a un administrador que lo asigne."));
  confirmar = "emitir"; render(); document.querySelector('[data-act="emitirOk"]').scrollIntoView({ block: "center", behavior: "smooth" });
}
async function emitirOk(btn) {
  btn.disabled = true;
  try {
    await guardar();
    const { data: codigo, error } = await sb.rpc("emitir_oficio", { p_oficio: item.id });
    if (error) throw error;
    const { data } = await sb.from("oficios").select("*").eq("id", item.id).single();
    const i = oficios.findIndex((y) => y.id === data.id); if (i >= 0) oficios[i] = data;
    oficios.sort((a, b) => (b.numero || 1e9) - (a.numero || 1e9));
    toast("Emitido: " + codigo); await abrir(data);
  } catch (e) { confirmar = ""; render(); toast(String(e.code) === "23505" ? "Otro usuario emitió al mismo tiempo: vuelva a tocar Emitir." : e.message || "No se pudo emitir"); }
}
async function claude(modo) {
  const msg = $("#claudeMsg"), cu = $("#f_cuerpo"), idea = $("#idea").value.trim();
  if (modo === "redactar" && !idea) return toast("Escriba la idea del oficio.");
  if (modo === "mejorar" && !cu.value.trim()) return toast("No hay texto para mejorar.");
  if (generando) return; generando = true;
  document.querySelectorAll('[data-act="redactar"],[data-act="mejorar"]').forEach((b) => (b.disabled = true));
  msg.textContent = "Claude está redactando…";
  try {
    const x = item;
    const r = await api("accion=redactar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      obra: obraId, modo, idea, cuerpo: cu.value, tono: $("#tono").value, asunto: x.asunto, referencia: x.referencia,
      destinatario: [x.destinatario_titulo, x.destinatario_nombre].filter(Boolean).join(" "), cargo: x.destinatario_cargo, institucion: x.destinatario_institucion }) });
    const { cuerpo } = await r.json();
    cu.value = cuerpo; item.cuerpo = cuerpo; setDirty(true);
    msg.textContent = "Propuesta de Claude: revísela y complete lo que esté entre corchetes antes de emitir.";
  } catch (e) { msg.textContent = ""; toast(e.message); }
  finally { generando = false; document.querySelectorAll('[data-act="redactar"],[data-act="mejorar"]').forEach((b) => (b.disabled = false)); }
}
async function abrirConfig() {
  const [a, b] = await Promise.all([sb.from("obras").select("id,codigo,ciudad").eq("id", obraId).single(), sb.from("perfiles").select("id,email,nombre,rol,titulo,cargo,puede_firmar").order("nombre")]);
  item = { obra: a.data || {}, perfOrig: JSON.stringify(b.data || []) }; perfiles = b.data || [];
  view = "config"; confirmar = ""; setDirty(false); render(); window.scrollTo(0, 0);
}
async function guardarConfig() {
  const ob = item.obra, cod = String(ob.codigo || "").trim().toUpperCase();
  if (cod && !/^[A-Z0-9]{2,10}$/.test(cod)) return toast("El código debe tener de 2 a 10 letras o números, sin espacios.");
  const { error } = await sb.from("obras").update({ codigo: cod || null, ciudad: (ob.ciudad || "Cuenca").trim() }).eq("id", obraId);
  if (error) return toast(String(error.code) === "23505" ? "Ese código ya lo usa otra obra." : "No se pudo guardar la obra: " + error.message);
  const orig = JSON.parse(item.perfOrig);
  for (const p of perfiles) {
    const o = orig.find((x) => x.id === p.id) || {};
    if (o.puede_firmar !== p.puede_firmar || (o.titulo || "") !== (p.titulo || "") || (o.cargo || "") !== (p.cargo || "")) {
      const r = await sb.from("perfiles").update({ puede_firmar: !!p.puede_firmar, titulo: p.titulo || null, cargo: p.cargo || null }).eq("id", p.id);
      if (r.error) return toast("No se pudo guardar a " + (p.nombre || p.email) + ": " + r.error.message);
    }
  }
  const o = obras.find((x) => x.id === obraId); if (o) { o.codigo = cod || null; o.ciudad = ob.ciudad; }
  item.perfOrig = JSON.stringify(perfiles); setDirty(false);
  firmantes = (await sb.rpc("oficio_firmantes", { p_obra: obraId })).data || [];
  toast("Configuración guardada");
}
async function subirPlantilla(input) {
  const f = input.files[0]; input.value = ""; if (!f) return;
  if (!/\.docx$/i.test(f.name)) return toast("La plantilla debe ser un archivo .docx");
  try {
    await api(input.dataset.pl === "general" ? "accion=plantilla&general=1" : "accion=plantilla&obra=" + obraId, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f });
    toast(input.dataset.pl === "general" ? "Plantilla general actualizada" : "Plantilla de la obra actualizada");
  } catch (e) { toast(e.message); }
}
async function bajarPlantilla() {
  try {
    const r = await api("accion=plantilla&obra=" + obraId), url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = url; a.download = "plantilla_oficio_" + (obra().codigo || "obra") + ".docx"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { toast(e.message); }
}
function volver() { view = "lista"; item = null; confirmar = ""; dirty = false; render(); window.scrollTo(0, 0); }

/* ---------- eventos ---------- */
document.addEventListener("input", (e) => {
  const t = e.target;
  if (view === "editor" && t.dataset.p) { item[t.dataset.p] = t.value; setDirty(true); }
  if (view === "config" && t.dataset.o) { item.obra[t.dataset.o] = t.value; setDirty(true); }
  if (view === "config" && t.dataset.pf && t.dataset.k !== "puede_firmar") { perfiles[+t.dataset.pf][t.dataset.k] = t.value; setDirty(true); }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "obraSel") {
    if (dirty && !confirm("Hay cambios sin guardar. ¿Cambiar de obra?")) { t.value = obraId; return; }
    obraId = t.value; try { localStorage.setItem("dlv-obra", obraId); } catch (_) {}
    view = "lista"; item = null; dirty = false; return cargarObra();
  }
  if (view === "editor" && t.dataset.c) { item[t.dataset.c] = t.checked; setDirty(true); render(); }
  if (view === "editor" && t.dataset.p && t.tagName === "SELECT") { item[t.dataset.p] = t.value; setDirty(true); }
  if (view === "config" && t.dataset.k === "puede_firmar") { perfiles[+t.dataset.pf].puede_firmar = t.checked; setDirty(true); }
  if (t.dataset.pl) subirPlantilla(t);
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button, [data-of]"); if (!b) return;
  if (b.dataset.of) { const o = oficios.find((x) => x.id === b.dataset.of); if (o) abrir(o); return; }
  if (b.dataset.filtro) { filtro = b.dataset.filtro; return render(); }
  const act = b.dataset.act;
  if (act === "nuevo") return nuevo();
  if (act === "config") return abrirConfig();
  if (act === "redactar" || act === "mejorar") return claude(act);
  if (act === "borrar") { confirmar = "borrar"; return render(); }
  if (act === "noConf") { confirmar = ""; return render(); }
  if (act === "emitirOk") return emitirOk(b);
  if (act === "borrarOk") {
    const { error } = await sb.from("oficios").delete().eq("id", item.id);
    if (error) return toast("No se pudo eliminar: " + error.message);
    oficios = oficios.filter((o) => o.id !== item.id); toast("Borrador eliminado"); return volver();
  }
  if (act === "anular") { confirmar = "anular"; render(); return $("#motivo").focus(); }
  if (act === "anularOk") {
    const motivo = $("#motivo").value.trim(); if (!motivo) return toast("Indique el motivo.");
    b.disabled = true;
    const { error } = await sb.rpc("anular_oficio", { p_oficio: item.id, p_motivo: motivo });
    if (error) { b.disabled = false; return toast(error.message); }
    const { data } = await sb.from("oficios").select("*").eq("id", item.id).single();
    const i = oficios.findIndex((y) => y.id === data.id); if (i >= 0) oficios[i] = data;
    toast("Oficio anulado"); return abrir(data);
  }
  if (act === "pdf") return abrirArchivo(item, "pdf");
  if (act === "docx") return abrirArchivo(item, "docx");
  if (act === "copiar") { try { await navigator.clipboard.writeText(urlVerif(item)); toast("Enlace copiado"); } catch (_) { toast(urlVerif(item)); } return; }
  if (act === "bajarPl") return bajarPlantilla();
  if (b.id === "btnGuardar") {
    b.disabled = true;
    try { if (view === "config") await guardarConfig(); else { await guardar(); render(); toast("Borrador guardado (todavía sin número)"); } }
    catch (err) { toast("No se pudo guardar: " + (err.message || "revise su conexión")); }
    finally { b.disabled = false; } return;
  }
  if (b.id === "btnEmitir") return emitir();
  if (b.id === "btnVolver") {
    if (dirty && !b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "¿Salir sin guardar?"; setTimeout(() => { if (b.dataset.sure) { b.dataset.sure = ""; b.textContent = "← Volver"; } }, 3000); return; }
    b.dataset.sure = ""; b.textContent = "← Volver"; return volver();
  }
});
// La vista previa se actualiza con lo escrito al abrirla
document.addEventListener("toggle", (e) => { if (e.target.id === "prevSec" && e.target.open && item) $("#prevBody").innerHTML = hoja(item, obra()); }, true);

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
  $("#obraSel").innerHTML = obras.length ? obras.map((o) => `<option value="${esc(o.id)}"${o.id === obraId ? " selected" : ""}>${esc(o.nombre)}</option>`).join("") : `<option value="">Sin obras asignadas</option>`;
  await cargarObra();
})();
})();
