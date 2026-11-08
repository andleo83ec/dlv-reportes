// DLV Plataforma — RDI, actas y correspondencia: requerimientos de información con plazo y fotos,
// actas de reunión con acuerdos y seguimiento, y registro de correspondencia. PDF de RDI y actas.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hoy = () => ymd(new Date());
const masDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const fmtF = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
const diasA = (f) => { if (!f) return null; const [y, m, d] = String(f).slice(0, 10).split("-").map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d) - t) / 86400000); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const cod = (pre, n) => pre + "-" + String(n || 0).padStart(3, "0");
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

const DEST = ["Fiscalización", "Diseño estructural", "Arquitectura", "Instalaciones eléctricas", "Instalaciones hidrosanitarias", "Mandante / propietario", "Proveedor"];
const EST_RDI = { abierto: "Abierto", respondido: "Respondido", cerrado: "Cerrado" };
const IMPACTO = { ninguno: "Sin impacto", costo: "Impacta costo", plazo: "Impacta plazo", ambos: "Impacta costo y plazo" };
const TIPO_ACTA = { obra: "Reunión de obra", fiscalizacion: "Con fiscalización", mandante: "Con el mandante", subcontratistas: "Con subcontratistas", interna: "Interna DLV" };
const EST_COR = { pendiente: "Pendiente", respondida: "Respondida", archivada: "Archivada" };

let sb = null, user = null, perfil = null, obras = [], obraId = "";
let rdis = [], actas = [], corr = [], sinTablas = false;
let view = "lista", tab = "rdi", item = null, dirty = false, confirm = null, soloAbiertos = true, subiendo = 0;
const esAdmin = () => perfil && perfil.rol === "admin";
const obra = () => obras.find((o) => o.id === obraId) || {};

/* ---------- semáforos ---------- */
function semRdi(r) {
  if (r.estado !== "abierto") return { cls: r.estado === "respondido" ? "ok" : "gris", txt: EST_RDI[r.estado] + (r.fecha_respuesta ? " " + fmtF(r.fecha_respuesta) : "") };
  const d = diasA(r.plazo), abierto = -diasA(r.fecha);
  if (d != null && d < 0) return { cls: "mal", txt: "Vencido hace " + -d + (d === -1 ? " día" : " días") };
  if (d != null && d <= 2) return { cls: "aviso", txt: d === 0 ? "Vence hoy" : "Vence en " + d + (d === 1 ? " día" : " días") };
  return { cls: "", txt: "Abierto · " + abierto + (abierto === 1 ? " día" : " días") };
}
function semAcuerdo(a) {
  if (a.estado === "cumplido") return { cls: "ok", txt: "Cumplido" };
  const d = diasA(a.plazo);
  if (d == null) return { cls: "", txt: "Sin plazo" };
  if (d < 0) return { cls: "mal", txt: "Vencido " + fmtF(a.plazo) };
  if (d <= 2) return { cls: "aviso", txt: d === 0 ? "Vence hoy" : "Vence " + fmtF(a.plazo) };
  return { cls: "", txt: "Hasta " + fmtF(a.plazo) };
}
const acuerdosPend = () => actas.flatMap((ac) => (ac.acuerdos || []).filter((a) => a.estado !== "cumplido").map((a) => ({ a, ac })))
  .sort((x, y) => String(x.a.plazo || "9").localeCompare(String(y.a.plazo || "9")));

/* ---------- datos ---------- */
async function cargarObra() {
  rdis = []; actas = []; corr = []; sinTablas = false;
  if (obraId) {
    const [a, b, c] = await Promise.all([
      sb.from("rdis").select("*").eq("obra_id", obraId).order("numero", { ascending: false }),
      sb.from("actas").select("*").eq("obra_id", obraId).order("numero", { ascending: false }),
      sb.from("correspondencia").select("*").eq("obra_id", obraId).order("fecha", { ascending: false })
    ]);
    if (a.error || b.error || c.error) sinTablas = true;
    else { rdis = a.data || []; actas = b.data || []; corr = c.data || []; }
  }
  render();
}
async function token() { const { data: { session } } = await sb.auth.getSession(); return session?.access_token || ""; }
const urlCache = {};
async function fotoURL(key) {
  if (urlCache[key]) return urlCache[key];
  const r = await fetch(`/api/fotos?obra=${encodeURIComponent(obraId)}&key=${encodeURIComponent(key)}`, { headers: { Authorization: "Bearer " + await token() } });
  if (!r.ok) throw new Error("foto");
  return (urlCache[key] = URL.createObjectURL(await r.blob()));
}
function pintarFotos() { document.querySelectorAll("img[data-key]").forEach((img) => { if (!img.src) fotoURL(img.dataset.key).then((u) => (img.src = u)).catch(() => (img.alt = "Foto no disponible")); }); }
async function comprimir(file) {
  let img; try { img = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) { img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight, k = Math.min(1, 1400 / Math.max(w0, h0)), w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
  return { blob: await new Promise((r) => c.toBlob(r, "image/jpeg", 0.78)), w, h };
}
async function subirFotos(files) {
  for (const f of files) {
    if (item.fotos.length >= 4) { toast("Máximo 4 fotos por RDI."); break; }
    subiendo++; render();
    try {
      const { blob, w, h } = await comprimir(f);
      const r = await fetch(`/api/fotos?obra=${encodeURIComponent(obraId)}`, { method: "POST", body: blob, headers: { "Content-Type": "image/jpeg", Authorization: "Bearer " + await token() } });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "error del servidor");
      urlCache[j.key] = URL.createObjectURL(blob); item.fotos.push({ key: j.key, w, h }); dirty = true;
    } catch (err) { toast("No se pudo subir la foto: " + err.message); }
    finally { subiendo--; render(); }
  }
}

/* ---------- render ---------- */
const conDock = () => ["rdi", "acta", "corr"].includes(view);
function setDirty(v) { dirty = v; const e = $("#estado"); if (!conDock()) return; e.className = "state" + (v ? " dirty" : ""); e.textContent = v ? "Sin guardar" : "Guardado"; }
function inp(path, label, type = "text", extra = "") {
  const v = path.split(".").reduce((a, k) => (a == null ? a : a[k]), item) ?? ""; const id = "f_" + path.replace(/\./g, "_");
  return `<label class="fld" for="${id}"><span>${label}</span><input id="${id}" type="${type}" data-p="${path}" value="${esc(v)}"${extra}></label>`;
}
function area(path, label, ph = "", rows = 3) { const v = path.split(".").reduce((a, k) => (a == null ? a : a[k]), item) ?? ""; const id = "f_" + path.replace(/\./g, "_"); return `<label class="fld" for="${id}"><span>${label}</span><textarea id="${id}" data-p="${path}" rows="${rows}" placeholder="${esc(ph)}">${esc(v)}</textarea></label>`; }
function sel(path, label, opts) { const v = path.split(".").reduce((a, k) => a[k], item); const id = "f_" + path.replace(/\./g, "_"); return `<label class="fld" for="${id}"><span>${label}</span><select id="${id}" data-p="${path}">${opts.map(([k, l]) => `<option value="${esc(k)}"${v === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`; }
function render() {
  const m = $("#main");
  $("#top").hidden = !user; $("#dock").hidden = !conDock();
  if (conDock()) { $("#btnPDF").hidden = view === "corr"; $("#btnVolver").textContent = "← Volver"; }
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (!obraId) { m.innerHTML = `<div class="empty"><b>Sin obras asignadas.</b></div>`; return; }
  if (sinTablas) { m.innerHTML = `<div class="empty"><b>Falta activar RDI y actas.</b><span>Ejecuta <b>supabase/rdi.sql</b> en Supabase → SQL Editor y recarga.</span></div>`; return; }
  if (view === "rdi") return renderRdi(m);
  if (view === "acta") return renderActa(m);
  if (view === "corr") return renderCorr(m);
  renderLista(m);
}
function renderLista(m) {
  const abiertos = rdis.filter((r) => r.estado === "abierto"), vencidos = abiertos.filter((r) => semRdi(r).cls === "mal");
  const pend = acuerdosPend(), pendVenc = pend.filter((x) => semAcuerdo(x.a).cls === "mal");
  const corrPend = corr.filter((c) => c.requiere_respuesta && c.estado === "pendiente");
  const tabs = [["rdi", `RDI (${abiertos.length})`], ["actas", `Actas (${actas.length})`], ["acuerdos", `Acuerdos (${pend.length})`], ["corr", `Oficios (${corrPend.length || corr.length})`]];
  let body = "";
  if (tab === "rdi") {
    const lista = soloAbiertos ? abiertos : rdis;
    body = `<div class="listhead"><h1>Requerimientos de información</h1><button class="btn hivis" type="button" data-act="nuevoRdi">+ RDI</button></div>
      <label class="chk" for="soloAb"><input type="checkbox" id="soloAb"${soloAbiertos ? " checked" : ""}>Solo abiertos</label>
      <div class="list">${lista.map((r) => { const s = semRdi(r); return `<button class="rep doc" type="button" data-rdi="${esc(r.id)}"><span class="n sm">${cod("RDI", r.numero)}</span>
        <span class="mid"><span class="t">${esc(r.asunto)}</span><span class="d">${esc(r.dirigido_a || "")} · ${fmtF(r.fecha)}${r.urgencia === "urgente" ? " · <b class='urg'>Urgente</b>" : ""}${r.impacto && r.impacto !== "ninguno" ? " · " + IMPACTO[r.impacto] : ""}</span></span>
        <span class="pill gp-${s.cls}">${esc(s.txt)}</span></button>`; }).join("") || `<div class="empty"><span>${soloAbiertos ? "No hay RDI abiertos." : "Aún no hay RDI en esta obra."}</span></div>`}</div>`;
  } else if (tab === "actas") {
    body = `<div class="listhead"><h1>Actas de reunión</h1><button class="btn hivis" type="button" data-act="nuevaActa">+ Acta</button></div>
      <div class="list">${actas.map((a) => { const p = (a.acuerdos || []).filter((x) => x.estado !== "cumplido").length; return `<button class="rep doc" type="button" data-acta="${esc(a.id)}"><span class="n sm">${cod("ACT", a.numero)}</span>
        <span class="mid"><span class="t">${esc(TIPO_ACTA[a.tipo] || a.tipo)} · ${fmtF(a.fecha)}</span><span class="d">${(a.asistentes || []).length} asistentes · ${(a.acuerdos || []).length} acuerdos</span></span>
        <span class="pill ${p ? "gp-aviso" : "gp-ok"}">${p ? p + " pendiente" + (p > 1 ? "s" : "") : "Al día"}</span></button>`; }).join("") || `<div class="empty"><span>Registra cada reunión con sus acuerdos, responsables y plazos.</span><button class="btn hivis" type="button" data-act="nuevaActa">+ Primera acta</button></div>`}</div>`;
  } else if (tab === "acuerdos") {
    body = `<div class="listhead"><h1>Acuerdos pendientes</h1></div><span class="code">Todos los acuerdos sin cumplir de las actas de esta obra. Márcalos al cumplirse.</span>
      <div class="list">${pend.map(({ a, ac }) => { const s = semAcuerdo(a); return `<div class="acu"><label class="chk" for="acu_${esc(a.id)}"><input type="checkbox" id="acu_${esc(a.id)}" data-cumplir="${esc(ac.id)}|${esc(a.id)}"><span><b>${esc(a.texto)}</b><span class="d">${esc(a.responsable || "Sin responsable")} · ${cod("ACT", ac.numero)} del ${fmtF(ac.fecha)}</span></span></label><span class="pill gp-${s.cls}">${esc(s.txt)}</span></div>`; }).join("") || `<div class="empty"><span>No hay acuerdos pendientes.</span></div>`}</div>`;
  } else {
    body = `<div class="listhead"><h1>Correspondencia</h1><button class="btn hivis" type="button" data-act="nuevaCorr">+ Registro</button></div>
      <div class="list">${corr.map((c) => { const d = diasA(c.plazo), venc = c.requiere_respuesta && c.estado === "pendiente" && d != null && d < 0; return `<button class="rep doc" type="button" data-corr="${esc(c.id)}"><span class="n sm">${c.direccion === "enviada" ? "↗ " + cod("OF", c.numero) : "↙ " + cod("REC", c.numero)}</span>
        <span class="mid"><span class="t">${esc(c.asunto)}</span><span class="d">${c.direccion === "enviada" ? "Para " + esc(c.para || "—") : "De " + esc(c.de || "—")} · ${fmtF(c.fecha)}${c.referencia ? " · " + esc(c.referencia) : ""}</span></span>
        <span class="pill ${venc ? "gp-mal" : c.requiere_respuesta && c.estado === "pendiente" ? "gp-aviso" : "gp-ok"}">${venc ? "Respuesta vencida" : c.requiere_respuesta && c.estado === "pendiente" ? "Espera respuesta" : EST_COR[c.estado]}</span></button>`; }).join("") || `<div class="empty"><span>Registra los oficios que envías y recibes; los que esperan respuesta quedan con plazo.</span></div>`}</div>`;
  }
  m.innerHTML = `<section class="obracard"><div class="listhead"><h1>${esc(obra().nombre)}</h1></div>
    <div class="kpis"><div><small>RDI abiertos</small><b>${abiertos.length}</b></div><div><small>RDI vencidos</small><b class="${vencidos.length ? "rojo" : ""}">${vencidos.length}</b></div><div><small>Acuerdos pendientes</small><b>${pend.length}</b></div><div><small>Acuerdos vencidos</small><b class="${pendVenc.length ? "rojo" : ""}">${pendVenc.length}</b></div></div></section>
    <div class="segtabs four" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}</div>${body}`;
}
function renderRdi(m) {
  const r = item, s = semRdi(r);
  m.innerHTML = `<details class="sec" open><summary><span class="num">RDI</span><h2>${cod("RDI", r.numero)}</h2><span class="sum">${esc(s.txt)}</span></summary><div class="body">
    ${inp("asunto", "Asunto", "text", ' placeholder="Ej.: Armado de viga V-3 en eje C no coincide con planta"')}
    <div class="grid2"><label class="fld" for="f_dirigido_a"><span>Dirigido a</span><input id="f_dirigido_a" type="text" data-p="dirigido_a" list="destList" value="${esc(r.dirigido_a || "")}"><datalist id="destList">${DEST.map((d) => `<option value="${esc(d)}">`).join("")}</datalist></label>${inp("referencia", "Referencia (plano, lámina, eje)")}</div>
    <div class="grid3">${inp("numero", "N.°", "number", ' inputmode="numeric"')}${inp("fecha", "Fecha", "date")}${inp("plazo", "Respuesta hasta", "date")}</div>
    ${sel("urgencia", "Urgencia", [["normal", "Normal"], ["urgente", "Urgente: detiene trabajos"]])}
    ${area("pregunta", "Consulta", "Describe qué no está claro o qué contradicción encontraste", 4)}
    ${area("propuesta", "Propuesta de DLV (opcional)", "Cómo propones resolverlo", 3)}
    <div class="fld"><span>Fotos (${r.fotos.length}/4)</span><div class="thumbs">${r.fotos.map((f, i) => `<span class="thumb"><img data-key="${esc(f.key)}" alt="Foto ${i + 1}"><button class="rm" type="button" data-rmfoto="${i}" aria-label="Quitar foto">×</button></span>`).join("")}${r.fotos.length < 4 ? `<button class="addph" type="button" data-act="foto" ${subiendo ? "disabled" : ""}>${subiendo ? "Subiendo…" : "+ Foto"}</button>` : ""}</div></div>
  </div></details>
  <details class="sec" ${r.estado !== "abierto" || r.respuesta ? "open" : ""}><summary><span class="num">R</span><h2>Respuesta</h2><span class="sum">${EST_RDI[r.estado]}</span></summary><div class="body">
    ${area("respuesta", "Respuesta recibida", "Transcribe la respuesta o adjunta su referencia", 4)}
    <div class="grid2">${inp("respondido_por", "Respondió")}${inp("fecha_respuesta", "Fecha de respuesta", "date")}</div>
    <div class="grid2">${sel("impacto", "Impacto", Object.entries(IMPACTO))}${sel("estado", "Estado", Object.entries(EST_RDI))}</div>
    ${r.impacto && r.impacto !== "ninguno" ? `<span class="code">Si impacta costo o plazo, regístralo como obra adicional en Estado de pago o como novedad en el reporte diario para respaldar la prórroga.</span>` : ""}
  </div></details>
  ${borrarHTML("rdis")}`;
  setDirty(dirty); pintarFotos();
}
function renderActa(m) {
  const a = item;
  m.innerHTML = `<details class="sec" open><summary><span class="num">ACT</span><h2>${cod("ACT", a.numero)}</h2><span class="sum">${esc(TIPO_ACTA[a.tipo] || "")}</span></summary><div class="body">
    <div class="grid3">${inp("numero", "N.°", "number", ' inputmode="numeric"')}${inp("fecha", "Fecha", "date")}${inp("hora", "Hora", "time")}</div>
    <div class="grid2">${sel("tipo", "Tipo de reunión", Object.entries(TIPO_ACTA))}${inp("lugar", "Lugar", "text", ' placeholder="Oficina de obra"')}</div>
  </div></details>
  <details class="sec" open><summary><span class="num">${a.asistentes.length}</span><h2>Asistentes</h2></summary><div class="body">
    <div class="rows">${a.asistentes.map((p, i) => `<div class="r r-asis"><label class="fld"><span>Nombre</span><input type="text" data-p="asistentes.${i}.nombre" value="${esc(p.nombre || "")}"></label>
      <label class="fld"><span>Cargo</span><input type="text" data-p="asistentes.${i}.cargo" value="${esc(p.cargo || "")}"></label><label class="fld"><span>Empresa</span><input type="text" data-p="asistentes.${i}.empresa" value="${esc(p.empresa || "")}"></label>
      <button class="x" type="button" data-del="asistentes.${i}" aria-label="Quitar asistente">×</button></div>`).join("")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm add" type="button" data-act="addAsis">+ Asistente</button>${actas.length && !a.asistentes.length ? `<button class="btn sm" type="button" data-act="copiarAsis">Copiar de la última acta</button>` : ""}</div>
  </div></details>
  <details class="sec" open><summary><span class="num">T</span><h2>Temas tratados</h2></summary><div class="body">${area("temas", "Desarrollo de la reunión", "1. Avance de obra…\n2. Pendientes de fiscalización…", 6)}</div></details>
  <details class="sec" open><summary><span class="num">${a.acuerdos.length}</span><h2>Acuerdos</h2><span class="sum">${a.acuerdos.filter((x) => x.estado !== "cumplido").length} pendientes</span></summary><div class="body">
    <div class="rows">${a.acuerdos.map((x, i) => `<div class="r r-acu"><label class="fld"><span>Acuerdo ${i + 1}</span><input type="text" data-p="acuerdos.${i}.texto" value="${esc(x.texto || "")}"></label>
      <button class="x" type="button" data-del="acuerdos.${i}" aria-label="Quitar acuerdo">×</button>
      <div class="ext"><label class="fld"><span>Responsable</span><input type="text" data-p="acuerdos.${i}.responsable" value="${esc(x.responsable || "")}" list="respList"></label>
        <label class="fld"><span>Plazo</span><input type="date" data-p="acuerdos.${i}.plazo" value="${esc(x.plazo || "")}"></label>
        <label class="fld"><span>Estado</span><select data-p="acuerdos.${i}.estado"><option value="pendiente"${x.estado !== "cumplido" ? " selected" : ""}>Pendiente</option><option value="cumplido"${x.estado === "cumplido" ? " selected" : ""}>Cumplido</option></select></label></div></div>`).join("")}</div>
    <datalist id="respList">${[...new Set(a.asistentes.map((p) => p.nombre).filter(Boolean).concat(["DLV", "Fiscalización", "Mandante"]))].map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
    <button class="btn sm add" type="button" data-act="addAcu">+ Acuerdo</button>
    ${pendAnteriores(a)}
    ${inp("proxima", "Próxima reunión", "date")}
  </div></details>
  ${borrarHTML("actas")}`;
  setDirty(dirty);
}
function pendAnteriores(a) {
  const prev = acuerdosPend().filter(({ ac }) => ac.id !== a.id && ac.numero < a.numero);
  if (!prev.length) return "";
  return `<div class="pastebox"><span class="code">Pendientes de actas anteriores (${prev.length}). Revísalos en esta reunión:</span>${prev.slice(0, 8).map(({ a: x, ac }) => `<div class="d">• ${esc(x.texto)} — ${esc(x.responsable || "")} (${cod("ACT", ac.numero)}, ${esc(semAcuerdo(x).txt)})</div>`).join("")}</div>`;
}
function renderCorr(m) {
  const c = item;
  m.innerHTML = `<details class="sec" open><summary><span class="num">${c.direccion === "enviada" ? "↗" : "↙"}</span><h2>${c.direccion === "enviada" ? cod("OF", c.numero) : cod("REC", c.numero)}</h2><span class="sum">${EST_COR[c.estado]}</span></summary><div class="body">
    <div class="grid2">${sel("direccion", "Tipo", [["enviada", "Enviada por DLV"], ["recibida", "Recibida"]])}${inp("fecha", "Fecha", "date")}</div>
    <div class="grid2">${inp("de", "De", "text", c.direccion === "enviada" ? ' placeholder="DLV Construcciones"' : "")}${inp("para", "Para")}</div>
    ${inp("asunto", "Asunto")}
    <div class="grid2">${inp("numero", "N.° de registro", "number", ' inputmode="numeric"')}${inp("referencia", "Referencia (N.° de oficio, correo)")}</div>
    ${area("resumen", "Resumen", "Qué se comunica o solicita", 4)}
    <label class="chk" for="f_req"><input type="checkbox" id="f_req" data-c="requiere_respuesta"${c.requiere_respuesta ? " checked" : ""}>Requiere respuesta</label>
    ${c.requiere_respuesta ? `<div class="grid2">${inp("plazo", "Responder hasta", "date")}${sel("estado", "Estado", Object.entries(EST_COR))}</div>` : sel("estado", "Estado", Object.entries(EST_COR))}
    ${inp("ubicacion", "Dónde está el original", "text", ' placeholder="Carpeta 3 · Archivo de obra / correo del 12/11"')}
  </div></details>${borrarHTML("correspondencia")}`;
  setDirty(dirty);
}
function borrarHTML(tabla) {
  if (!item.id || !esAdmin()) return "";
  return confirm === tabla ? `<div class="confirm"><span>¿Borrar este registro? No se puede deshacer.</span><button class="btn sm danger" type="button" data-act="borrarOk" data-t="${tabla}">Sí, borrar</button><button class="btn sm" type="button" data-act="noBorrar">Cancelar</button></div>`
    : `<div><button class="btn sm danger" type="button" data-act="borrar" data-t="${tabla}">Borrar</button></div>`;
}

/* ---------- abrir / guardar ---------- */
const sig = (lista, f) => lista.filter(f || (() => true)).reduce((m, x) => Math.max(m, x.numero || 0), 0) + 1;
function abrir(v, obj) { item = obj; view = v; confirm = null; render(); window.scrollTo(0, 0); }
function nuevoRdi() { abrir("rdi", { obra_id: obraId, numero: sig(rdis), fecha: hoy(), plazo: masDias(3), urgencia: "normal", estado: "abierto", impacto: "ninguno", dirigido_a: "Fiscalización", asunto: "", pregunta: "", referencia: "", propuesta: "", fotos: [] }); setDirty(true); }
function nuevaActa() { abrir("acta", { obra_id: obraId, numero: sig(actas), fecha: hoy(), hora: "", lugar: "Oficina de obra", tipo: "obra", asistentes: [], temas: "", acuerdos: [], proxima: masDias(7) }); setDirty(true); }
function nuevaCorr() { abrir("corr", { obra_id: obraId, numero: sig(corr, (c) => c.direccion === "enviada"), fecha: hoy(), direccion: "enviada", de: "DLV Construcciones", para: "", asunto: "", referencia: "", resumen: "", requiere_respuesta: false, plazo: "", estado: "archivada", ubicacion: "" }); setDirty(true); }
async function guardar() {
  const tablas = { rdi: "rdis", acta: "actas", corr: "correspondencia" }, tabla = tablas[view], x = item;
  if (view !== "acta" && !(x.asunto || "").trim()) return toast("Escribe el asunto.");
  let row;
  if (view === "rdi") row = { obra_id: obraId, numero: parseInt(x.numero, 10) || 1, fecha: x.fecha || hoy(), dirigido_a: x.dirigido_a || null, disciplina: x.disciplina || null, asunto: x.asunto.trim(), pregunta: x.pregunta || null, referencia: x.referencia || null, propuesta: x.propuesta || null,
    urgencia: x.urgencia, plazo: x.plazo || null, estado: x.respuesta && x.estado === "abierto" ? "respondido" : x.estado, respuesta: x.respuesta || null, respondido_por: x.respondido_por || null,
    fecha_respuesta: x.fecha_respuesta || (x.respuesta && !x.fecha_respuesta ? hoy() : null), impacto: x.impacto, fotos: x.fotos, actualizado: new Date().toISOString() };
  else if (view === "acta") row = { obra_id: obraId, numero: parseInt(x.numero, 10) || 1, fecha: x.fecha || hoy(), hora: x.hora || null, lugar: x.lugar || null, tipo: x.tipo,
    asistentes: x.asistentes.filter((p) => (p.nombre || "").trim()), temas: x.temas || null, acuerdos: x.acuerdos.filter((a) => (a.texto || "").trim()).map((a) => ({ id: a.id || uid(), texto: a.texto.trim(), responsable: a.responsable || "", plazo: a.plazo || "", estado: a.estado || "pendiente" })),
    proxima: x.proxima || null, actualizado: new Date().toISOString() };
  else row = { obra_id: obraId, numero: parseInt(x.numero, 10) || 1, fecha: x.fecha || hoy(), direccion: x.direccion, de: x.de || null, para: x.para || null, asunto: x.asunto.trim(), referencia: x.referencia || null, resumen: x.resumen || null,
    requiere_respuesta: !!x.requiere_respuesta, plazo: x.requiere_respuesta ? x.plazo || null : null, estado: x.estado, ubicacion: x.ubicacion || null };
  const btn = $("#btnGuardar"); btn.disabled = true;
  try {
    const { data, error } = x.id ? await sb.from(tabla).update(row).eq("id", x.id).select().single() : await sb.from(tabla).insert(row).select().single();
    if (error) throw error;
    const lista = view === "rdi" ? rdis : view === "acta" ? actas : corr;
    const i = lista.findIndex((y) => y.id === data.id); if (i >= 0) lista[i] = data; else lista.unshift(data);
    lista.sort((a, b) => (b.numero || 0) - (a.numero || 0));
    item = JSON.parse(JSON.stringify(data)); item.fotos = item.fotos || []; item.asistentes = item.asistentes || []; item.acuerdos = item.acuerdos || [];
    setDirty(false); render(); toast("Guardado");
  } catch (err) { toast(String(err.code) === "23505" ? "Ya existe un registro con ese número." : "No se pudo guardar: " + (err.message || "revisa tu conexión")); }
  finally { btn.disabled = false; }
}
async function cumplirAcuerdo(actaId, acuId) {
  const ac = actas.find((a) => a.id === actaId); if (!ac) return;
  const acuerdos = (ac.acuerdos || []).map((a) => a.id === acuId ? { ...a, estado: "cumplido", cumplido_el: hoy() } : a);
  const { data, error } = await sb.from("actas").update({ acuerdos, actualizado: new Date().toISOString() }).eq("id", actaId).select().single();
  if (error) return toast("No se pudo actualizar el acuerdo.");
  Object.assign(ac, data); toast("Acuerdo cumplido"); render();
}

/* ---------- PDF (A4 vertical) ---------- */
async function imgData(key) {
  try {
    const url = await fotoURL(key);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
    return { data: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height };
  } catch (_) { return null; }
}
function nuevoDoc(titulo, codigo, fecha) {
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" }); { const _t = doc.text.bind(doc), _l = (s) => typeof s === "string" ? s.replace(/[\u2212\u2013]/g, "-").replace(/\u2713/g, "»").replace(/\u2610/g, "[  ]").replace(/[\u2605\u2606]/g, "*").replace(/\u2197/g, ">").replace(/\u2199/g, "<").replace(/\u2192/g, "->") : s; doc.text = (s, ...a) => _t(Array.isArray(s) ? s.map(_l) : _l(s), ...a); }
  const M = 12, W = 186, NAVY = [29, 53, 87], AMB = [232, 163, 23], GRID = [150, 150, 150], LBL = [236, 235, 227];
  const o = obra();
  const P = { doc, M, W, NAVY, GRID, LBL, y: 0, page: 1 };
  P.header = () => {
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.rect(M, M, W, 18); doc.line(M + 44, M, M + 44, M + 18); doc.line(M + W - 44, M, M + W - 44, M + 18);
    doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("DLV", M + 5, M + 9.5); doc.setFillColor(...AMB); doc.rect(M + 5, M + 10.8, 15, 1, "F");
    doc.setFontSize(6.2); doc.text("CONSTRUCCIONES CÍA. LTDA.", M + 5, M + 14.6);
    doc.setFontSize(12); doc.text(titulo, M + 44 + (W - 88) / 2, M + 8.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85, 85, 85); doc.text(P.fit(o.nombre || "", W - 92), M + 44 + (W - 88) / 2, M + 13.5, { align: "center" });
    [["CÓDIGO", codigo], ["FECHA", fmtF(fecha)], ["PÁGINA", String(P.page)]].forEach(([k, v], i) => {
      const x = M + W - 44, yy = M + i * 6; if (i) doc.line(x, yy, M + W, yy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4);
      doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(v, M + W - 1.5, yy + 4, { align: "right" });
    });
    doc.setFont("helvetica", "normal"); doc.setFontSize(5.6); doc.setTextColor(120, 120, 120); doc.text("DLV Construcciones Cía. Ltda. · Av. Primero de Mayo y Av. de las Américas, Cuenca", M, 290);
    P.y = M + 22;
  };
  P.fit = (s, w) => { s = String(s ?? ""); while (s && doc.getTextWidth(s) > w) s = s.slice(0, -2) + "…"; return s; };
  P.need = (h) => { if (P.y + h > 282) { doc.addPage(); P.page++; P.header(); } };
  P.bar = (t) => { P.need(12); doc.setFillColor(...NAVY); doc.rect(M, P.y, W, 5.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(7.4); doc.setTextColor(255, 255, 255); doc.text(t, M + 2, P.y + 3.9); P.y += 7; };
  P.kv = (pares) => {
    doc.setFontSize(7.2);
    pares.forEach(([k, v], i) => { const col = i % 2, x = M + col * (W / 2); if (col === 0) P.need(6); const yy = P.y;
      doc.setFillColor(...LBL); doc.rect(x, yy, 30, 6, "F"); doc.setDrawColor(...GRID); doc.rect(x, yy, W / 2, 6);
      doc.setFont("helvetica", "bold"); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4); doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(P.fit(v || "—", W / 2 - 34), x + 32, yy + 4);
      if (col === 1 || i === pares.length - 1) P.y += 6; });
    P.y += 2;
  };
  P.par = (t, opt = {}) => {
    doc.setFont("helvetica", opt.bold ? "bold" : "normal"); doc.setFontSize(opt.size || 8.4); doc.setTextColor(30, 30, 30);
    const ls = doc.splitTextToSize(String(t || ""), W - 4);
    for (const l of ls) { P.need(4.4); doc.text(l, M + 2, P.y + 3.2); P.y += 4.1; }
    P.y += 1.5;
  };
  P.lineas = (n) => { doc.setDrawColor(190, 190, 190); for (let i = 0; i < n; i++) { P.need(7); doc.line(M + 2, P.y + 6, M + W - 2, P.y + 6); P.y += 7; } P.y += 2; };
  P.firmas = (lista) => {
    const n = lista.length, gap = 6, w = (W - gap * (Math.min(n, 3) - 1)) / Math.min(n, 3);
    for (let i = 0; i < n; i += 3) {
      P.need(26); const fila = lista.slice(i, i + 3);
      fila.forEach(([t, nom], j) => { const x = M + j * (w + gap);
        doc.setFillColor(...NAVY); doc.rect(x, P.y, w, 4, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.2); doc.setTextColor(255, 255, 255); doc.text(P.fit(t, w - 3), x + w / 2, P.y + 2.8, { align: "center" });
        doc.setDrawColor(...GRID); doc.rect(x, P.y + 4, w, 18); doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(60, 60, 60); doc.text(P.fit(nom || "Nombre / firma", w - 4), x + 2, P.y + 20); });
      P.y += 25;
    }
  };
  P.header();
  return P;
}
function entregar(doc, name) {
  const blob = doc.output("blob"), file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch((e) => { if (e.name !== "AbortError") doc.save(name); });
  else doc.save(name);
}
async function pdfRdi() {
  const r = item, o = obra(), P = nuevoDoc("REQUERIMIENTO DE INFORMACIÓN", cod("RDI", r.numero), r.fecha), doc = P.doc;
  P.kv([["OBRA", o.nombre], ["CONTRATISTA", "DLV Construcciones Cía. Ltda."], ["DIRIGIDO A", r.dirigido_a], ["REFERENCIA", r.referencia], ["URGENCIA", r.urgencia === "urgente" ? "URGENTE · detiene trabajos" : "Normal"], ["RESPONDER HASTA", fmtF(r.plazo)]]);
  P.bar("1. CONSULTA"); P.par(r.asunto, { bold: true }); P.par(r.pregunta || "");
  if (r.propuesta) { P.bar("2. PROPUESTA DEL CONTRATISTA"); P.par(r.propuesta); }
  const fotos = (await Promise.all((r.fotos || []).slice(0, 4).map((f) => imgData(f.key)))).filter(Boolean);
  if (fotos.length) {
    P.bar((r.propuesta ? "3" : "2") + ". REGISTRO FOTOGRÁFICO");
    const w = (P.W - 6) / 2, h = 62;
    for (let i = 0; i < fotos.length; i += 2) {
      P.need(h + 2);
      fotos.slice(i, i + 2).forEach((im, j) => { const x = P.M + j * (w + 6); doc.setDrawColor(...P.GRID); doc.rect(x, P.y, w, h); const k = Math.min((w - 2) / im.w, (h - 2) / im.h); doc.addImage(im.data, "JPEG", x + (w - im.w * k) / 2, P.y + (h - im.h * k) / 2, im.w * k, im.h * k); });
      P.y += h + 3;
    }
  }
  P.bar("RESPUESTA");
  if (r.respuesta) { P.par(r.respuesta); P.kv([["RESPONDIÓ", r.respondido_por], ["FECHA", fmtF(r.fecha_respuesta)], ["IMPACTO", IMPACTO[r.impacto]], ["ESTADO", EST_RDI[r.estado]]]); }
  else { P.lineas(6); P.par("Impacto:   ☐ Sin impacto   ☐ Costo   ☐ Plazo   ☐ Costo y plazo", { size: 7.6 }); }
  P.y += 2; P.firmas([["SOLICITA · DLV", o.residente || o.gerente], ["RESPONDE · " + (r.dirigido_a || "").toUpperCase(), r.respondido_por || ""], ["RECIBE · DLV", o.gerente]]);
  entregar(doc, `${cod("RDI", r.numero)} ${(o.nombre || "").replace(/[\\/:*?"<>|]/g, "")}.pdf`);
}
function pdfActa() {
  const a = item, o = obra(), P = nuevoDoc("ACTA DE REUNIÓN", cod("ACT", a.numero), a.fecha), doc = P.doc;
  P.kv([["OBRA", o.nombre], ["TIPO", TIPO_ACTA[a.tipo]], ["FECHA", fmtF(a.fecha)], ["HORA", a.hora], ["LUGAR", a.lugar], ["PRÓXIMA", fmtF(a.proxima)]]);
  const tabla = (heads, widths, rows) => {
    P.need(12); let x = P.M; doc.setFillColor(...P.LBL); doc.rect(P.M, P.y, P.W, 5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.6); doc.setTextColor(...P.NAVY);
    heads.forEach((h, i) => { doc.text(h, x + 1.5, P.y + 3.5); x += widths[i]; }); P.y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(30, 30, 30);
    for (const r of rows) {
      const cells = r.map((c, i) => doc.splitTextToSize(String(c ?? ""), widths[i] - 3)), h = Math.max(6, Math.max(...cells.map((c) => c.length)) * 3.6 + 2);
      P.need(h); x = P.M; doc.setDrawColor(200, 200, 200); doc.rect(P.M, P.y, P.W, h);
      cells.forEach((c, i) => { doc.text(c, x + 1.5, P.y + 4); x += widths[i]; if (i < cells.length - 1) doc.line(x, P.y, x, P.y + h); }); P.y += h;
    }
    P.y += 3;
  };
  P.bar("1. ASISTENTES"); tabla(["NOMBRE", "CARGO", "EMPRESA", "FIRMA"], [56, 44, 46, 40], a.asistentes.map((p) => [p.nombre, p.cargo, p.empresa, ""]));
  P.bar("2. TEMAS TRATADOS"); P.par(a.temas || "—");
  P.bar("3. ACUERDOS"); tabla(["N.°", "ACUERDO", "RESPONSABLE", "PLAZO", "ESTADO"], [10, 92, 38, 22, 24], a.acuerdos.map((x, i) => [i + 1, x.texto, x.responsable, fmtF(x.plazo), x.estado === "cumplido" ? "Cumplido" : "Pendiente"]));
  const prev = acuerdosPend().filter(({ ac }) => ac.id !== a.id && ac.numero < a.numero);
  if (prev.length) { P.bar("4. PENDIENTES DE ACTAS ANTERIORES"); tabla(["ACTA", "ACUERDO", "RESPONSABLE", "PLAZO"], [22, 104, 38, 22], prev.map(({ a: x, ac }) => [cod("ACT", ac.numero), x.texto, x.responsable, fmtF(x.plazo)])); }
  P.par("La presente acta se considera aprobada si no se reciben observaciones dentro de las 48 horas siguientes a su entrega.", { size: 7 });
  entregar(doc, `${cod("ACT", a.numero)} ${(o.nombre || "").replace(/[\\/:*?"<>|]/g, "")} ${a.fecha}.pdf`);
}

/* ---------- eventos ---------- */
const setP = (o, p, v) => { const ks = p.split("."); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]]; a[ks[ks.length - 1]] = v; };
document.addEventListener("input", (e) => { const t = e.target; if (t.dataset.p && item && t.tagName !== "SELECT") { setP(item, t.dataset.p, t.value); setDirty(true); } });
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "obraSel") { obraId = t.value; try { localStorage.setItem("dlv-obra", obraId); } catch (_) {} view = "lista"; item = null; cargarObra(); return; }
  if (t.id === "soloAb") { soloAbiertos = t.checked; render(); return; }
  if (t.id === "fotoIn") { const fs = [...t.files]; t.value = ""; if (fs.length) subirFotos(fs); return; }
  if (t.dataset.cumplir) { const [a, b] = t.dataset.cumplir.split("|"); cumplirAcuerdo(a, b); return; }
  if (t.dataset.c && item) { item[t.dataset.c] = t.checked; if (t.dataset.c === "requiere_respuesta" && t.checked) { item.estado = "pendiente"; item.plazo = item.plazo || masDias(5); } setDirty(true); render(); return; }
  if (t.tagName === "SELECT" && t.dataset.p && item) {
    setP(item, t.dataset.p, t.value);
    if (t.dataset.p === "direccion") { item.numero = sig(corr, (c) => c.direccion === t.value && c.id !== item.id); if (t.value === "recibida") { item.de = ""; item.para = "DLV Construcciones"; } else { item.de = "DLV Construcciones"; item.para = ""; } }
    setDirty(true); render();
  }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
  if (b.dataset.rdi) { const r = rdis.find((x) => x.id === b.dataset.rdi); abrir("rdi", { ...JSON.parse(JSON.stringify(r)), fotos: r.fotos || [] }); setDirty(false); return; }
  if (b.dataset.acta) { const a = actas.find((x) => x.id === b.dataset.acta); abrir("acta", { ...JSON.parse(JSON.stringify(a)), asistentes: a.asistentes || [], acuerdos: a.acuerdos || [] }); setDirty(false); return; }
  if (b.dataset.corr) { abrir("corr", JSON.parse(JSON.stringify(corr.find((x) => x.id === b.dataset.corr)))); setDirty(false); return; }
  if (b.dataset.rmfoto && item) { item.fotos.splice(+b.dataset.rmfoto, 1); setDirty(true); render(); return; }
  if (b.dataset.del && item) { const [k, i] = b.dataset.del.split("."); item[k].splice(+i, 1); setDirty(true); render(); return; }
  const a = b.dataset.act;
  if (a === "nuevoRdi") return nuevoRdi();
  if (a === "nuevaActa") return nuevaActa();
  if (a === "nuevaCorr") return nuevaCorr();
  if (a === "foto") { $("#fotoIn").click(); return; }
  if (a === "addAsis") { item.asistentes.push({ nombre: "", cargo: "", empresa: "" }); setDirty(true); render(); return; }
  if (a === "copiarAsis") { const u = actas[0]; item.asistentes = JSON.parse(JSON.stringify(u.asistentes || [])); setDirty(true); render(); return; }
  if (a === "addAcu") { item.acuerdos.push({ id: uid(), texto: "", responsable: "", plazo: masDias(7), estado: "pendiente" }); setDirty(true); render(); return; }
  if (a === "borrar") { confirm = b.dataset.t; render(); return; }
  if (a === "noBorrar") { confirm = null; render(); return; }
  if (a === "borrarOk") {
    const { error } = await sb.from(b.dataset.t).delete().eq("id", item.id);
    if (error) return toast("No se pudo borrar.");
    if (b.dataset.t === "rdis") rdis = rdis.filter((x) => x.id !== item.id); else if (b.dataset.t === "actas") actas = actas.filter((x) => x.id !== item.id); else corr = corr.filter((x) => x.id !== item.id);
    dirty = false; view = "lista"; item = null; render(); toast("Borrado"); return;
  }
  if (b.id === "btnGuardar") return guardar();
  if (b.id === "btnPDF") {
    if (!window.jspdf) return toast("No se cargó el generador de PDF. Revisa tu conexión y recarga.");
    if (dirty) return toast("Guarda antes de generar el PDF.");
    b.disabled = true; try { view === "rdi" ? await pdfRdi() : pdfActa(); } catch (err) { toast("No se pudo generar el PDF."); } finally { b.disabled = false; } return;
  }
  if (b.id === "btnVolver") {
    if (dirty && !b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "¿Salir sin guardar?"; setTimeout(() => { if (b.dataset.sure) { b.dataset.sure = ""; b.textContent = "← Volver"; } }, 3000); return; }
    b.dataset.sure = ""; tab = view === "rdi" ? "rdi" : view === "acta" ? "actas" : "corr"; view = "lista"; item = null; dirty = false; render(); window.scrollTo(0, 0);
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
  const qs = new URLSearchParams(location.search), want = qs.get("obra") || saved;
  obraId = (obras.find((o) => o.id === want) || obras[0] || {}).id || "";
  if (["rdi", "actas", "acuerdos", "corr"].includes(qs.get("tab"))) tab = qs.get("tab");
  $("#obraSel").innerHTML = obras.length ? obras.map((o) => `<option value="${esc(o.id)}"${o.id === obraId ? " selected" : ""}>${esc(o.nombre)}</option>`).join("") : `<option value="">Sin obras asignadas</option>`;
  await cargarObra();
})();
})();
