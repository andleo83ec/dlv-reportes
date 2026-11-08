// DLV Plataforma — Personal: ficha de trabajadores con aviso de entrada al IESS, asistencia diaria por obra desde el celular
// y roles de pago (quincena, semana o mes) con aporte personal y patronal, horas extra, descuentos y provisiones. PDF del rol.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hoy = () => ymd(new Date());
const dt = (f) => { const [y, m, d] = String(f).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const sumar = (f, n) => { const d = dt(f); d.setDate(d.getDate() + n); return ymd(d); };
const fmtF = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fLarga = (f) => { const d = dt(f); return DIAS[d.getDay()] + " " + d.getDate() + " de " + MESES[d.getMonth()]; };
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").trim().replace(/[$\s]/g, ""); if (!s) return 0;
  const c = s.lastIndexOf(","), d = s.lastIndexOf(".");
  if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (c > -1) s = s.match(/,/g).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (d > -1 && (s.match(/\./g).length > 1 || /^-?\d{1,3}(\.\d{3})+$/.test(s))) s = s.replace(/\./g, "");
  const n = parseFloat(s); return isFinite(n) ? n : 0;
}
const r2 = (n) => Math.round(n * 100) / 100;
const dec = (v) => typeof v === "number" ? String(v).replace(".", ",") : v ?? ""; // muestra 10.5 como 10,5
const money = (n) => "$ " + (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf = (n, d = 2) => (n || 0).toLocaleString("es-EC", { maximumFractionDigits: d });
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3600); }
// Cédula ecuatoriana: 10 dígitos, provincia 01-24 (o 30) y dígito verificador módulo 10
function cedulaOk(c) {
  c = String(c || "").trim(); if (!/^\d{10}$/.test(c)) return false;
  const p = +c.slice(0, 2); if (!((p >= 1 && p <= 24) || p === 30) || +c[2] > 5) return false;
  let s = 0; for (let i = 0; i < 9; i++) { let v = +c[i] * (i % 2 ? 1 : 2); if (v > 9) v -= 9; s += v; }
  return (10 - (s % 10)) % 10 === +c[9];
}

// Mismas categorías que el reporte diario, para pasar la asistencia al reporte
const CARGOS_DIR = ["Maestro mayor", "Albañil", "Fierrero", "Carpintero (encofrado)", "Peón", "Operador de equipo", "Electricista", "Plomero", "Pintor", "Soldador", "Chofer"];
const CARGOS_IND = ["Residente de obra", "Asistente técnico", "Bodeguero", "Técnico de seguridad (SSO)", "Guardián"];
const CARGOS = [...CARGOS_DIR, ...CARGOS_IND];
const ordenCargo = (c) => { const i = CARGOS.indexOf(c); return i < 0 ? 99 : i; };
const MARCAS = { P: "Presente", M: "Medio día", F: "Falta" };
const EST_ROL = { borrador: "Borrador", aprobado: "Aprobado", pagado: "Pagado" };
// Valores 2026: SBU USD 482; aporte personal 9,45 %; patronal 11,15 % + 0,5 % IECE + 0,5 % SECAP
const CFG = { iess_personal: 9.45, iess_patronal: 12.15, recargo_hx: 50, provisiones: true, sbu: 482, dias_mes: 22 };

let sb = null, user = null, perfil = null, obras = [], obraId = "";
let trabs = [], asis = {}, asisDesde = null, roles = [], sinTablas = false;
let view = "lista", tab = "asistencia", fecha = hoy(), marcas = {}, dirtyAsis = false, verTodos = false, busca = "";
let trab = null, rol = null, dirty = false, confirm = null, agregar = false;
const esAdmin = () => perfil && perfil.rol === "admin";
const obra = () => obras.find((o) => o.id === obraId) || {};
const obraNom = (id) => (obras.find((o) => o.id === id) || {}).nombre || "";
const deObra = () => trabs.filter((t) => t.obra_id === obraId && t.activo).sort((a, b) => ordenCargo(a.cargo) - ordenCargo(b.cargo) || a.nombres.localeCompare(b.nombres, "es"));
const sinIess = (lista) => lista.filter((t) => t.activo && !t.iess);

/* ---------- cálculo del rol ---------- */
function calcLinea(l, cfg, hasta) {
  const j = num(l.jornal), dias = num(l.dias), hx = num(l.hx);
  const bruto = r2(dias * j + hx * j / 8 * (1 + num(cfg.recargo_hx) / 100) + num(l.bonos));
  const iess = l.iess ? r2(bruto * num(cfg.iess_personal) / 100) : 0;
  const liquido = r2(bruto - iess - num(l.anticipos) - num(l.desc));
  const patronal = l.iess ? r2(bruto * num(cfg.iess_patronal) / 100) : 0;
  let prov = 0;
  if (cfg.provisiones) {
    const anio = l.ingreso && hasta && dt(hasta) - dt(l.ingreso) >= 365 * 86400000;
    prov = bruto / 12 + num(cfg.sbu) / 12 * dias / (num(cfg.dias_mes) || 22) + bruto / 24 + (l.iess && anio ? bruto * 0.0833 : 0); // décimo tercero, décimo cuarto, vacaciones, fondos de reserva
  }
  prov = r2(prov);
  return { bruto, iess, liquido, patronal, prov, costo: r2(bruto + patronal + prov) };
}
function calcRol(r) {
  const cfg = { ...CFG, ...(r.config || {}) }, t = { n: 0, dias: 0, hx: 0, bruto: 0, iess: 0, anticipos: 0, desc: 0, liquido: 0, patronal: 0, prov: 0, costo: 0, sinIess: 0 };
  const lineas = (r.lineas || []).map((l) => ({ l, c: calcLinea(l, cfg, r.hasta) }));
  for (const { l, c } of lineas) {
    t.n++; t.dias += num(l.dias); t.hx += num(l.hx); t.anticipos += num(l.anticipos); t.desc += num(l.desc); if (!l.iess) t.sinIess++;
    for (const k of ["bruto", "iess", "liquido", "patronal", "prov", "costo"]) t[k] += c[k];
  }
  for (const k of ["bruto", "iess", "anticipos", "desc", "liquido", "patronal", "prov", "costo"]) t[k] = r2(t[k]);
  return { cfg, lineas, t };
}

/* ---------- datos ---------- */
async function cargarObra() {
  trabs = []; asis = {}; asisDesde = null; roles = []; sinTablas = false;
  if (obraId) {
    let qt = sb.from("trabajadores").select("*").order("nombres");
    if (!esAdmin()) qt = qt.eq("obra_id", obraId);
    const desde = sumar(hoy(), -62);
    const [a, b, c] = await Promise.all([qt, sb.from("asistencia").select("*").eq("obra_id", obraId).gte("fecha", desde), sb.from("roles_pago").select("*").eq("obra_id", obraId).order("numero")]);
    if (a.error || b.error || c.error) sinTablas = true;
    else { trabs = a.data || []; for (const x of b.data || []) asis[x.fecha] = x.marcas || {}; asisDesde = desde; roles = c.data || []; }
  }
  abrirFecha(fecha);
}
async function asegurarAsis(desde) {
  if (asisDesde && desde >= asisDesde) return;
  const { data } = await sb.from("asistencia").select("*").eq("obra_id", obraId).gte("fecha", desde).lt("fecha", asisDesde || "9999");
  for (const x of data || []) asis[x.fecha] = x.marcas || {};
  asisDesde = desde;
}
function abrirFecha(f) { fecha = f; marcas = JSON.parse(JSON.stringify(asis[f] || {})); dirtyAsis = false; render(); }

/* ---------- render ---------- */
const secAbierta = {};
document.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.sec) secAbierta[view + d.dataset.sec] = d.open; }, true);
function aplicarSecciones() { document.querySelectorAll("details[data-sec]").forEach((d) => { const k = view + d.dataset.sec; if (k in secAbierta) d.open = secAbierta[k]; }); }
function render() { renderBase(); aplicarSecciones(); estadoDock(); }
function estadoDock() {
  const e = $("#estado"), d = view === "lista" ? dirtyAsis : dirty;
  if (view === "lista" && tab !== "asistencia") return;
  e.className = "state" + (d ? " dirty" : ""); e.textContent = d ? "Sin guardar" : view === "lista" ? (asis[fecha] ? "Guardada" : "Sin tomar") : "Guardado";
}
function renderBase() {
  const m = $("#main");
  $("#top").hidden = !user;
  const dock = user && obraId && !sinTablas && (view !== "lista" || tab === "asistencia");
  $("#dock").hidden = !dock;
  if (dock) {
    $("#btnVolver").hidden = view === "lista"; $("#btnVolver").textContent = view === "rol" ? "← Roles" : "← Personal";
    $("#btnPDF").hidden = view !== "rol" || !rol || !(rol.lineas || []).length;
    $("#btnGuardar").textContent = view === "lista" ? "Guardar asistencia" : "Guardar";
    $("#btnGuardar").hidden = view === "rol" && rol.estado !== "borrador" && !esAdmin();
  }
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (!obraId) { m.innerHTML = `<div class="empty"><b>Sin obras asignadas.</b></div>`; return; }
  if (sinTablas) { m.innerHTML = `<div class="empty"><b>Falta activar el módulo de personal.</b><span>Ejecuta <b>supabase/personal.sql</b> en Supabase → SQL Editor y recarga.</span></div>`; return; }
  if (view === "trab") return renderTrab(m);
  if (view === "rol") return renderRol(m);
  const sin = sinIess(deObra());
  m.innerHTML = `
  <div class="segtabs tres" role="tablist">${[["asistencia", "Asistencia"], ["trabajadores", "Trabajadores (" + deObra().length + ")"], ["roles", "Roles de pago"]].map(([k, v]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${v}</button>`).join("")}</div>
  ${sin.length ? `<button class="alertbar mal" type="button" data-tab="trabajadores"><b>${sin.length === 1 ? "1 trabajador sin" : sin.length + " trabajadores sin"} aviso de entrada al IESS</b><span>${sin.slice(0, 3).map((t) => esc(t.nombres)).join(" · ")}${sin.length > 3 ? "…" : ""} — es obligatorio desde el primer día de trabajo.</span></button>` : ""}
  ${tab === "asistencia" ? htmlAsistencia() : tab === "trabajadores" ? htmlTrabajadores() : htmlRoles()}`;
}
function htmlAsistencia() {
  const lista = deObra(), ids = new Set(lista.map((t) => t.id));
  // trabajadores marcados ese día que ya no están en la obra (se muestran con los datos guardados)
  const extra = Object.entries(marcas).filter(([id]) => !ids.has(id)).map(([id, x]) => ({ id, nombres: x.n || "Trabajador", cargo: x.cargo, _fuera: true }));
  const todos = lista.concat(extra);
  const c = { P: 0, M: 0, F: 0 }; for (const t of todos) { const e = (marcas[t.id] || {}).e; if (c[e] != null) c[e]++; }
  const sinMarca = todos.length - c.P - c.M - c.F;
  const hxT = Object.values(marcas).reduce((s, x) => s + num(x.hx), 0);
  const futuro = fecha > hoy();
  return `
  <section class="obracard asis-head">
    <div class="fechabar"><button class="btn sm" type="button" data-dia="-1" aria-label="Día anterior">‹</button>
      <label class="fld"><span>${esc(fLarga(fecha))}${fecha === hoy() ? " · hoy" : ""}</span><input type="date" id="fFecha" value="${fecha}" max="${hoy()}"></label>
      <button class="btn sm" type="button" data-dia="1" aria-label="Día siguiente"${fecha >= hoy() ? " disabled" : ""}>›</button></div>
    <div class="chips"><span class="chip P">${c.P} presentes</span><span class="chip M">${c.M} medio día</span><span class="chip F">${c.F} faltas</span>${sinMarca ? `<span class="chip">${sinMarca} sin marcar</span>` : ""}${hxT ? `<span class="chip">${nf(hxT, 1)} h extra</span>` : ""}</div>
    ${todos.length && sinMarca ? `<button class="btn hivis" type="button" data-act="todos">Marcar ${sinMarca === todos.length ? "a todos" : "a los " + sinMarca + " restantes"} como presentes</button>` : ""}
  </section>
  ${futuro ? "" : todos.length ? `<div class="asis">${todos.map((t) => { const x = marcas[t.id] || {}; return `
    <div class="arow${x.e ? " m-" + x.e : ""}"><span class="who"><b>${esc(t.nombres)}</b><small>${esc(t.cargo || "Sin cargo")}${t._fuera ? " · ya no está en esta obra" : ""}${!t._fuera && !t.iess ? ` · <em>sin IESS</em>` : ""}</small></span>
      <span class="mk" role="group" aria-label="Asistencia de ${esc(t.nombres)}">${Object.keys(MARCAS).map((k) => `<button type="button" data-mk="${esc(t.id)}" data-e="${k}" aria-pressed="${x.e === k}" title="${MARCAS[k]}">${k === "M" ? "½" : k}</button>`).join("")}</span>
      <label class="hx"><span>H. extra</span><input type="text" inputmode="decimal" data-hx="${esc(t.id)}" value="${esc(x.hx ? dec(x.hx) : "")}"${x.e && x.e !== "F" ? "" : " disabled"}></label></div>`; }).join("")}</div>`
    : `<div class="empty"><span>Registra primero al personal de esta obra.</span><button class="btn hivis" type="button" data-act="nuevoTrab">+ Trabajador</button></div>`}
  ${todos.length ? `<details class="sec" data-sec="sem"><summary><span class="num">7</span><h2>Últimos 7 días</h2><span class="sum">${fmtF(sumar(fecha, -6)).slice(0, 5)} – ${fmtF(fecha).slice(0, 5)}</span></summary><div class="body">${semana(todos)}</div></details>` : ""}
  <span class="code">P = jornada completa · ½ = medio día · F = falta. Las horas extra se pagan con recargo del 50 % en el rol. La asistencia del día se puede pasar al reporte diario.</span>`;
}
function semana(todos) {
  const dias = []; for (let i = 6; i >= 0; i--) dias.push(sumar(fecha, -i));
  const val = (f, id) => { const x = (f === fecha ? marcas : asis[f] || {})[id]; return x ? x.e : ""; };
  return `<div class="semana"><table><thead><tr><th>Trabajador</th>${dias.map((f) => `<th>${DIAS[dt(f).getDay()].slice(0, 2)}<br>${dt(f).getDate()}</th>`).join("")}<th>Días</th></tr></thead><tbody>
    ${todos.map((t) => { let s = 0; const cel = dias.map((f) => { const e = val(f, t.id); s += e === "P" ? 1 : e === "M" ? 0.5 : 0; return `<td class="m-${e}">${e === "M" ? "½" : e}</td>`; }).join(""); return `<tr><td>${esc(t.nombres)}</td>${cel}<td><b>${nf(s, 1)}</b></td></tr>`; }).join("")}
  </tbody></table></div>`;
}
function htmlTrabajadores() {
  const q = busca.trim().toLowerCase();
  let lista = verTodos && esAdmin() ? trabs.slice() : trabs.filter((t) => t.obra_id === obraId);
  if (q) lista = lista.filter((t) => [t.nombres, t.cedula, t.cargo].some((x) => String(x || "").toLowerCase().includes(q)));
  lista.sort((a, b) => (b.activo - a.activo) || ordenCargo(a.cargo) - ordenCargo(b.cargo) || a.nombres.localeCompare(b.nombres, "es"));
  const act = lista.filter((t) => t.activo), jorn = act.reduce((s, t) => s + num(t.jornal), 0);
  return `
  <div class="listhead"><h1>Personal</h1><button class="btn hivis" type="button" data-act="nuevoTrab">+ Trabajador</button></div>
  <div class="filtros2"><label class="fld"><span>Buscar</span><input id="fBus" type="search" placeholder="Nombre, cédula o cargo" value="${esc(busca)}"></label>
    ${esAdmin() ? `<label class="chk"><input type="checkbox" id="fTodos"${verTodos ? " checked" : ""}> Todas las obras</label>` : ""}</div>
  <div class="totline"><span>${act.length} activos</span>${act.length ? `<span>jornales ${money(jorn)} por día</span>` : ""}</div>
  <div class="list">${lista.length ? lista.map((t) => `
    <button class="rep tr${t.activo ? "" : " baja"}" type="button" data-trab="${esc(t.id)}"><span class="ini">${esc(t.nombres.split(/\s+/).slice(0, 2).map((x) => x[0]).join(""))}</span>
      <span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${esc(t.nombres)}</span>
        <span class="d">${esc([t.cargo, t.cedula, verTodos ? obraNom(t.obra_id) || "sin obra" : ""].filter(Boolean).join(" · "))}</span>
        <span>${t.activo ? (t.iess ? `<span class="pill gp-ok">IESS${t.iess_fecha ? " desde " + fmtF(t.iess_fecha) : ""}</span>` : `<span class="pill gp-mal">Sin aviso IESS</span>`) : `<span class="pill">Salió ${fmtF(t.salida)}</span>`}</span></span>
      <b class="mt">${money(num(t.jornal))}<small>/día</small></b></button>`).join("")
    : `<div class="empty"><span>${q ? "Nadie coincide con la búsqueda." : "Aún no hay trabajadores en esta obra."}</span>${q ? "" : `<button class="btn hivis" type="button" data-act="nuevoTrab">+ Primer trabajador</button>`}</div>`}</div>`;
}
function htmlRoles() {
  return `
  <div class="listhead"><h1>Roles de pago</h1><button class="btn hivis" type="button" data-act="nuevoRol">+ Rol de pagos</button></div>
  <div class="list">${roles.length ? roles.slice().reverse().map((r) => { const t = r.totales || {}; return `
    <button class="rep" type="button" data-rol="${esc(r.id)}"><span class="n">${String(r.numero).padStart(2, "0")}</span>
      <span style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="t">${fmtF(r.desde)} – ${fmtF(r.hasta)}</span>
        <span class="d">${num(t.n)} trabajadores · líquido ${money(num(t.liquido))} · costo DLV ${money(num(t.costo))}</span></span>
      <span class="pill est-${esc(r.estado)}">${EST_ROL[r.estado]}</span></button>`; }).join("")
    : `<div class="empty"><span>El rol se arma solo con la asistencia del período: días trabajados, medio días y horas extra de cada trabajador.</span><button class="btn hivis" type="button" data-act="nuevoRol">+ Primer rol</button></div>`}</div>
  <span class="code">Al aprobar un rol, su costo total (sueldos, aporte patronal y provisiones) pasa a mano de obra en Control de costos.</span>`;
}
function renderTrab(m) {
  const t = trab, val = (k) => esc(t[k] ?? "");
  const ced = (t.cedula || "").trim(), cedMal = ced && !cedulaOk(ced);
  const misObras = esAdmin() ? obras : obras.filter((o) => o.id === obraId || o.id === t.obra_id);
  m.innerHTML = `
  <details class="sec" open><summary><span class="num">${t.id ? esc(t.nombres.split(/\s+/).slice(0, 2).map((x) => x[0]).join("")) : "+"}</span><h2>${t.id ? "Ficha del trabajador" : "Nuevo trabajador"}</h2><span class="sum">${t.activo ? "Activo" : "Salió"}</span></summary><div class="body">
    <label class="fld" for="t_nombres"><span>Nombres y apellidos</span><input id="t_nombres" type="text" data-p="nombres" value="${val("nombres")}" autocomplete="off"></label>
    <div class="grid2"><label class="fld" for="t_cedula"><span>Cédula</span><input id="t_cedula" type="text" inputmode="numeric" maxlength="13" data-p="cedula" value="${val("cedula")}"></label>
      <label class="fld" for="t_cargo"><span>Cargo</span><input id="t_cargo" type="text" list="dlCargo" data-p="cargo" value="${val("cargo")}" autocomplete="off"></label></div>
    <datalist id="dlCargo">${CARGOS.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
    <span class="warnline" id="cedWarn"${cedMal ? "" : " hidden"}>La cédula no pasa la validación del dígito verificador. Revísala.</span>
    <div class="grid2"><label class="fld" for="t_jornal"><span>Jornal diario (USD)</span><input id="t_jornal" type="text" inputmode="decimal" data-p="jornal" value="${esc(dec(t.jornal))}"></label>
      <label class="fld" for="t_tel"><span>Teléfono</span><input id="t_tel" type="tel" data-p="telefono" value="${val("telefono")}"></label></div>
    <span class="code" id="mensual">${num(t.jornal) ? "Equivale a " + money(num(t.jornal) * 30) + " al mes (30 días). El salario básico 2026 es " + money(CFG.sbu) + "." : "El jornal no puede quedar por debajo del mínimo sectorial de su cargo."}</span>
    <div class="grid2"><label class="fld" for="t_ingreso"><span>Fecha de ingreso</span><input id="t_ingreso" type="date" data-p="ingreso" value="${val("ingreso")}"></label>
      <label class="fld" for="t_obra"><span>Obra</span><select id="t_obra" data-p="obra_id"${esAdmin() ? "" : " disabled"}>${esAdmin() ? `<option value="">Sin obra</option>` : ""}${misObras.map((o) => `<option value="${esc(o.id)}"${o.id === t.obra_id ? " selected" : ""}>${esc(o.nombre)}</option>`).join("")}</select></label></div>
    <div class="iessbox${t.iess ? "" : " mal"}"><label class="chk"><input type="checkbox" id="t_iess"${t.iess ? " checked" : ""}> Aviso de entrada al IESS hecho</label>
      ${t.iess ? `<label class="fld" for="t_iessf"><span>Fecha del aviso</span><input id="t_iessf" type="date" data-p="iess_fecha" value="${val("iess_fecha")}"></label>` : `<span class="code">Obligatorio desde el primer día. Sin aviso, el rol no descuenta el 9,45 % ni calcula aporte patronal, y DLV queda expuesta a multas y responsabilidad patronal si hay un accidente.</span>`}</div>
    <label class="fld" for="t_contacto"><span>Contacto de emergencia</span><input id="t_contacto" type="text" data-p="contacto" value="${val("contacto")}" placeholder="Nombre y teléfono"></label>
    <label class="fld" for="t_notas"><span>Notas</span><textarea id="t_notas" data-p="notas" rows="2">${esc(t.notas || "")}</textarea></label>
  </div></details>
  ${t.id ? `<details class="sec" data-sec="baja"${t.activo ? "" : " open"}><summary><span class="num">↧</span><h2>Salida</h2><span class="sum">${t.activo ? "" : fmtF(t.salida)}</span></summary><div class="body">
    ${t.activo ? `<span class="code">Al dar de baja deja de aparecer en la asistencia. Recuerda el aviso de salida en el IESS y el acta de finiquito en el Ministerio del Trabajo.</span>
      <div class="grid2"><label class="fld" for="t_salida"><span>Fecha de salida</span><input id="t_salida" type="date" value="${hoy()}"></label><div style="align-self:end"><button class="btn danger" type="button" data-act="baja">Dar de baja</button></div></div>`
    : `<span class="code">Salió el ${fmtF(t.salida)}.</span><div><button class="btn" type="button" data-act="reingreso">Reincorporar</button></div>`}
    ${esAdmin() ? (confirm === "t" ? `<div class="confirm"><span>¿Borrar la ficha? Se pierde su historial en los roles en borrador.</span><button class="btn sm danger" type="button" data-act="delTOk">Sí, borrar</button><button class="btn sm" type="button" data-act="noDel">Cancelar</button></div>` : `<div><button class="btn sm ghost" type="button" data-act="delT">Borrar ficha</button></div>`) : ""}
  </div></details>` : ""}`;
}
function renderRol(m) {
  const r = rol, { cfg, lineas, t } = calcRol(r), bloq = r.estado !== "borrador", dis = bloq ? " disabled" : "";
  const enRol = new Set(r.lineas.map((l) => l.tid)), disponibles = trabs.filter((x) => x.activo && !enRol.has(x.id) && (x.obra_id === obraId));
  const inp = (i, k, label) => `<label class="fld"><span>${label}</span><input type="text" inputmode="decimal" data-l="${i}" data-k="${k}" value="${esc(dec(r.lineas[i][k]))}"${dis}></label>`;
  m.innerHTML = `
  <details class="sec" open><summary><span class="num">${String(r.numero).padStart(2, "0")}</span><h2>Rol de pagos</h2><span class="sum">${EST_ROL[r.estado]}</span></summary><div class="body">
    <div class="grid2"><label class="fld" for="r_desde"><span>Desde</span><input id="r_desde" type="date" data-r="desde" value="${esc(r.desde)}"${dis}></label>
      <label class="fld" for="r_hasta"><span>Hasta</span><input id="r_hasta" type="date" data-r="hasta" value="${esc(r.hasta)}"${dis}></label></div>
    ${bloq ? "" : `<div class="acts"><button class="btn sm" type="button" data-per="q1">1.ª quincena</button><button class="btn sm" type="button" data-per="q2">2.ª quincena</button><button class="btn sm" type="button" data-per="mes">Mes completo</button><button class="btn sm" type="button" data-per="sem">Semana pasada</button></div>`}
    <label class="fld" for="r_est"><span>Estado</span><select id="r_est"${!esAdmin() && r.estado !== "borrador" ? " disabled" : ""}>${Object.entries(EST_ROL).map(([k, v]) => `<option value="${k}"${r.estado === k ? " selected" : ""}${!esAdmin() && k !== "borrador" ? " disabled" : ""}>${v}</option>`).join("")}</select></label>
    ${bloq ? `<span class="code">Rol ${EST_ROL[r.estado].toLowerCase()}: los valores están bloqueados.${esAdmin() ? " Vuelve a «Borrador» para corregirlo." : ""}</span>` : `<button class="btn sm" type="button" data-act="recalc">Volver a traer días y horas extra de la asistencia</button>`}
    ${!esAdmin() && !bloq ? `<span class="code">Cuando esté listo, el administrador lo aprueba y lo marca como pagado.</span>` : ""}
  </div></details>
  <div class="sumcard" id="sumcard">${resumen(t)}</div>
  <div class="lineas">${lineas.map(({ l, c }, i) => `
    <div class="ln${l.iess ? "" : " noiess"}"><div class="h"><b>${esc(l.n)}</b><span class="code">${esc(l.cargo || "")} · ${money(num(l.jornal))}/día${l.iess ? "" : " · <em>sin IESS</em>"}</span>${bloq ? "" : `<button class="x" type="button" data-qlin="${i}" aria-label="Quitar del rol">×</button>`}</div>
      <div class="g">${inp(i, "dias", "Días")}${inp(i, "hx", "H. extra")}${inp(i, "bonos", "Bonos")}${inp(i, "anticipos", "Anticipos")}${inp(i, "desc", "Otros desc.")}</div>
      <div class="v" id="v_${i}">${valores(c)}</div></div>`).join("") || `<span class="code">No hay asistencia en este período. Revisa las fechas o agrega trabajadores a mano.</span>`}</div>
  ${bloq ? "" : agregar ? `<div class="pastebox"><span class="code">Agregar al rol:</span><div class="pick">${disponibles.map((x) => `<label class="chk"><input type="checkbox" data-add="${esc(x.id)}"> ${esc(x.nombres)} · ${esc(x.cargo || "")}</label>`).join("") || `<span class="code">Todo el personal de la obra ya está en el rol.</span>`}</div>
      <div><button class="btn sm primary" type="button" data-act="addOk">Agregar</button> <button class="btn sm ghost" type="button" data-act="addNo">Cancelar</button></div></div>`
    : `<div><button class="btn sm" type="button" data-act="add">+ Trabajador al rol</button></div>`}
  <details class="sec" data-sec="cfg"><summary><span class="num">%</span><h2>Parámetros</h2><span class="sum">IESS ${nf(cfg.iess_personal)} % · patronal ${nf(cfg.iess_patronal)} %</span></summary><div class="body">
    <div class="metas">${[["iess_personal", "Aporte personal IESS %"], ["iess_patronal", "Aporte patronal %"], ["recargo_hx", "Recargo horas extra %"], ["sbu", "Salario básico (USD)"], ["dias_mes", "Días laborables al mes"]].map(([k, lbl]) => `<label class="fld"><span>${lbl}</span><input type="text" inputmode="decimal" data-cfg="${k}" value="${esc(dec(cfg[k]))}"${dis}></label>`).join("")}</div>
    <label class="chk"><input type="checkbox" id="r_prov"${cfg.provisiones ? " checked" : ""}${dis}> Calcular provisiones en el costo (décimo tercero, décimo cuarto, vacaciones y fondos de reserva)</label>
    <span class="code">Patronal 12,15 % = 11,15 % IESS + 0,5 % IECE + 0,5 % SECAP. Horas extra = jornal ÷ 8 × (1 + recargo). Décimo cuarto = salario básico ÷ 12 × días ÷ días laborables al mes. Fondos de reserva desde el año de trabajo. Las provisiones no se descuentan al trabajador: solo suman al costo de DLV.</span>
    <label class="fld" for="r_nota"><span>Observaciones</span><textarea id="r_nota" data-r="nota" rows="2"${dis}>${esc(r.nota || "")}</textarea></label>
  </div></details>
  ${r.id && esAdmin() && r.estado === "borrador" ? (confirm === "r" ? `<div class="confirm"><span>¿Borrar este rol?</span><button class="btn sm danger" type="button" data-act="delROk">Sí, borrar</button><button class="btn sm" type="button" data-act="noDel">Cancelar</button></div>` : `<div><button class="btn sm danger" type="button" data-act="delR">Borrar rol</button></div>`) : ""}`;
}
const valores = (c) => `<span>Bruto <b>${money(c.bruto)}</b></span><span>IESS <b>${money(c.iess)}</b></span><span class="liq">Líquido <b>${money(c.liquido)}</b></span><span class="cst">Costo DLV <b>${money(c.costo)}</b></span>`;
const resumen = (t) => `<div class="sumgrid">
  <div><span>${t.n} trabajadores · ${nf(t.dias, 1)} días${t.hx ? " · " + nf(t.hx, 1) + " h extra" : ""}</span><b></b></div>
  <div><span>Total ingresos</span><b>${money(t.bruto)}</b></div><div><span>(−) Aporte personal IESS</span><b>${money(t.iess)}</b></div>
  <div><span>(−) Anticipos y descuentos</span><b>${money(t.anticipos + t.desc)}</b></div><div class="big tot"><span>Líquido a pagar</span><b>${money(t.liquido)}</b></div>
  <div><span>Aporte patronal</span><b>${money(t.patronal)}</b></div><div><span>Provisiones</span><b>${money(t.prov)}</b></div>
  <div class="big"><span>Costo total para DLV</span><b>${money(t.costo)}</b></div></div>
  ${t.sinIess ? `<span class="warnline">${t.sinIess === 1 ? "1 trabajador" : t.sinIess + " trabajadores"} sin aviso de entrada al IESS en este rol.</span>` : ""}`;

/* ---------- acciones ---------- */
async function guardarAsis() {
  const limpio = {};
  const porId = Object.fromEntries(trabs.map((t) => [t.id, t]));
  for (const [id, x] of Object.entries(marcas)) {
    if (!x.e) continue; const t = porId[id];
    limpio[id] = { e: x.e, hx: x.e === "F" ? 0 : num(x.hx), cargo: t ? t.cargo || "" : x.cargo || "", n: t ? t.nombres : x.n || "" };
  }
  const { data, error } = await sb.from("asistencia").upsert({ obra_id: obraId, fecha, marcas: limpio, actualizado: new Date().toISOString() }, { onConflict: "obra_id,fecha" }).select().single();
  if (error) return toast("No se pudo guardar: " + error.message);
  asis[fecha] = data.marcas || limpio; marcas = JSON.parse(JSON.stringify(asis[fecha])); dirtyAsis = false; render();
  const n = Object.values(limpio).filter((x) => x.e !== "F").length;
  toast("Asistencia del " + fmtF(fecha) + " guardada · " + n + (n === 1 ? " persona" : " personas") + " en obra");
}
function abrirTrab(t) {
  trab = t ? { ...t } : { nombres: "", cedula: "", cargo: "", telefono: "", jornal: "", ingreso: hoy(), obra_id: obraId, iess: false, iess_fecha: "", contacto: "", notas: "", activo: true };
  confirm = null; view = "trab"; dirty = !t; render(); window.scrollTo(0, 0);
  if (!t) $("#t_nombres").focus();
}
async function guardarTrab(extra) {
  const t = { ...trab, ...(extra || {}) };
  if (!(t.nombres || "").trim()) return toast("Escribe el nombre del trabajador.");
  if (!num(t.jornal) && t.activo) return toast("Escribe el jornal diario.");
  const row = { nombres: t.nombres.trim().replace(/\s+/g, " "), cedula: (t.cedula || "").trim() || null, cargo: (t.cargo || "").trim() || null, telefono: (t.telefono || "").trim() || null, jornal: r2(num(t.jornal)),
    ingreso: t.ingreso || null, salida: t.salida || null, iess: !!t.iess, iess_fecha: t.iess ? t.iess_fecha || null : null, obra_id: t.obra_id || null, activo: !!t.activo, contacto: (t.contacto || "").trim() || null, notas: (t.notas || "").trim() || null };
  const { data, error } = t.id ? await sb.from("trabajadores").update(row).eq("id", t.id).select().single() : await sb.from("trabajadores").insert(row).select().single();
  if (error) return toast(/duplicate|unique/i.test(error.message) ? "Esa cédula ya está registrada" + (esAdmin() ? "." : " en otra obra: pide al administrador que lo cambie a esta.") : "No se pudo guardar: " + error.message);
  const i = trabs.findIndex((x) => x.id === data.id); if (i > -1) trabs[i] = data; else trabs.push(data);
  const nuevo = !t.id; trab = { ...data }; dirty = false;
  if (nuevo) { view = "lista"; trab = null; toast(data.nombres + " registrado" + (data.iess ? "" : " · recuerda el aviso de entrada al IESS")); } else toast("Ficha guardada");
  render();
}
function periodo(tipo, base) {
  const d = dt(base || hoy()), y = d.getFullYear(), m = d.getMonth(), fin = new Date(y, m + 1, 0).getDate(), p = (n) => ymd(new Date(y, m, n));
  if (tipo === "q1") return [p(1), p(15)];
  if (tipo === "q2") return [p(16), p(fin)];
  if (tipo === "mes") return [p(1), p(fin)];
  const h = dt(hoy()), dow = (h.getDay() + 6) % 7, lunes = new Date(h); lunes.setDate(h.getDate() - dow - 7); const dom = new Date(lunes); dom.setDate(lunes.getDate() + 6);
  return [ymd(lunes), ymd(dom)];
}
async function lineasDesdeAsis(r, conservar) {
  await asegurarAsis(r.desde);
  const porId = Object.fromEntries(trabs.map((t) => [t.id, t])), acc = {};
  for (const [f, mk] of Object.entries(asis)) {
    if (f < r.desde || f > r.hasta) continue;
    for (const [id, x] of Object.entries(mk)) {
      const a = acc[id] = acc[id] || { dias: 0, hx: 0, n: x.n, cargo: x.cargo };
      a.dias += x.e === "P" ? 1 : x.e === "M" ? 0.5 : 0; a.hx += x.e === "F" ? 0 : num(x.hx);
    }
  }
  const prev = Object.fromEntries((conservar || []).map((l) => [l.tid, l]));
  const out = [];
  for (const [id, a] of Object.entries(acc)) {
    if (!a.dias && !a.hx) continue;
    const t = porId[id] || {}, p = prev[id] || {};
    out.push({ tid: id, n: t.nombres || a.n, ced: t.cedula || "", cargo: t.cargo || a.cargo || "", jornal: num(t.jornal), iess: !!t.iess, ingreso: t.ingreso || null,
      dias: a.dias, hx: a.hx, bonos: p.bonos || "", anticipos: p.anticipos || "", desc: p.desc || "" });
  }
  return out.sort((a, b) => ordenCargo(a.cargo) - ordenCargo(b.cargo) || a.n.localeCompare(b.n, "es"));
}
async function nuevoRol() {
  const d = dt(hoy()), [desde, hasta] = d.getDate() <= 15 ? periodo("q2", ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1))) : periodo("q1");
  rol = { obra_id: obraId, numero: roles.reduce((m, x) => Math.max(m, x.numero || 0), 0) + 1, desde, hasta, estado: "borrador", lineas: [], config: { ...CFG }, nota: "" };
  rol.lineas = await lineasDesdeAsis(rol);
  agregar = false; confirm = null; view = "rol"; dirty = true; render(); window.scrollTo(0, 0);
  if (!rol.lineas.length) toast("No hay asistencia del " + fmtF(desde) + " al " + fmtF(hasta) + ".");
}
async function guardarRol() {
  const r = rol;
  if (!r.desde || !r.hasta || r.hasta < r.desde) return toast("Revisa las fechas del período.");
  const { cfg, lineas, t } = calcRol(r);
  const lin = lineas.map(({ l, c }) => ({ ...l, dias: num(l.dias), hx: num(l.hx), bonos: num(l.bonos), anticipos: num(l.anticipos), desc: num(l.desc), ...c }));
  const row = { obra_id: obraId, numero: r.numero, desde: r.desde, hasta: r.hasta, estado: r.estado, lineas: lin, config: cfg, totales: t, nota: (r.nota || "").trim() || null, actualizado: new Date().toISOString() };
  const { data, error } = r.id ? await sb.from("roles_pago").update(row).eq("id", r.id).select().single() : await sb.from("roles_pago").insert(row).select().single();
  if (error) return toast("No se pudo guardar: " + error.message);
  const i = roles.findIndex((x) => x.id === data.id); if (i > -1) roles[i] = data; else roles.push(data);
  rol = JSON.parse(JSON.stringify(data)); dirty = false; render(); toast("Rol guardado · líquido " + money(t.liquido));
}
function volver() { view = "lista"; trab = rol = null; dirty = false; confirm = null; render(); window.scrollTo(0, 0); }

/* ---------- PDF del rol ---------- */
function pdfRol() {
  const r = rol, o = obra(), { cfg, lineas, t } = calcRol(r);
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "landscape" }); { const _t = doc.text.bind(doc), _l = (s) => typeof s === "string" ? s.replace(/[−–]/g, "-").replace(/✓/g, "»").replace(/☐/g, "[  ]").replace(/[★☆]/g, "*").replace(/↗/g, ">").replace(/↙/g, "<").replace(/→/g, "->").replace(/½/g, "0,5") : s; doc.text = (s, ...a) => _t(Array.isArray(s) ? s.map(_l) : _l(s), ...a); }
  const M = 10, W = 277, NAVY = [29, 53, 87], AMB = [232, 163, 23], GRID = [150, 150, 150], SUB = [217, 222, 230];
  const fit = (x, w) => { x = String(x ?? ""); while (x && doc.getTextWidth(x) > w) x = x.slice(0, -2) + "…"; return x; };
  let pagina = 1;
  const header = () => {
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.rect(M, M, W, 18); doc.line(M + 48, M, M + 48, M + 18); doc.line(M + W - 52, M, M + W - 52, M + 18);
    doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("DLV", M + 5, M + 9.5); doc.setFillColor(...AMB); doc.rect(M + 5, M + 10.8, 15, 1, "F");
    doc.setFontSize(6.4); doc.text("CONSTRUCCIONES CÍA. LTDA.", M + 5, M + 14.6);
    doc.setFontSize(12.5); doc.text("ROL DE PAGOS N.° " + String(r.numero).padStart(2, "0"), M + 48 + (W - 100) / 2, M + 8.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85, 85, 85); doc.text(fit((o.nombre || "") + " · personal de obra", W - 110), M + 48 + (W - 100) / 2, M + 13.2, { align: "center" });
    [["PERÍODO", fmtF(r.desde) + " – " + fmtF(r.hasta)], ["ESTADO", EST_ROL[r.estado].toUpperCase()], ["PÁGINA", String(pagina)]].forEach(([k, v], i) => {
      const x = M + W - 52, yy = M + i * 6; if (i) doc.line(x, yy, M + W, yy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4);
      doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(v, M + W - 1.5, yy + 4, { align: "right" });
    });
    doc.setFontSize(5.6); doc.setTextColor(120, 120, 120); doc.text("DLV Construcciones Cía. Ltda. · Rol de pagos · aporte personal IESS " + nf(cfg.iess_personal) + " % · horas extra con recargo del " + nf(cfg.recargo_hx) + " %", M, 203);
    return M + 21;
  };
  const cols = [["N.°", 7, "c"], ["CÉDULA", 19, "l"], ["NOMBRES", 46, "l"], ["CARGO", 26, "l"], ["DÍAS", 10, "r"], ["H.EXT.", 10, "r"], ["JORNAL", 15, "r"], ["BONOS", 15, "r"], ["T. INGRESOS", 19, "r"], ["IESS", 15, "r"], ["ANTICIPOS", 16, "r"], ["OTROS DESC.", 16, "r"], ["LÍQUIDO", 19, "r"], ["FIRMA", 24, "c"]];
  const head = (yy) => { let x = M; doc.setFillColor(...NAVY); doc.rect(M, yy, W, 6.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(255, 255, 255);
    for (const [h, w, al] of cols) { doc.text(h, al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, yy + 4.2, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; } return yy + 6.5; };
  let y = head(header());
  const fila = (vals, opt = {}) => {
    const h = opt.h || 8;
    if (y + h > 196) { doc.addPage("a4", "landscape"); pagina++; y = head(header()); }
    if (opt.fill) { doc.setFillColor(...opt.fill); doc.rect(M, y, W, h, "F"); }
    doc.setDrawColor(200, 200, 200); doc.line(M, y + h, M + W, y + h);
    let x = M; doc.setFont("helvetica", opt.bold ? "bold" : "normal"); doc.setFontSize(6.6); doc.setTextColor(30, 30, 30);
    cols.forEach(([, w, al], i) => { const v = vals[i]; if (i) doc.line(x, y, x, y + h); if (v != null && v !== "") doc.text(fit(v, w - 2.4), al === "r" ? x + w - 1.2 : al === "c" ? x + w / 2 : x + 1.2, y + h / 2 + 1.2, { align: al === "r" ? "right" : al === "c" ? "center" : "left" }); x += w; });
    y += h;
  };
  lineas.forEach(({ l, c }, i) => fila([String(i + 1), l.ced || "", l.n + (l.iess ? "" : " (sin IESS)"), l.cargo || "", nf(num(l.dias), 1), num(l.hx) ? nf(num(l.hx), 1) : "", money(num(l.jornal)), num(l.bonos) ? money(num(l.bonos)) : "", money(c.bruto), money(c.iess), num(l.anticipos) ? money(num(l.anticipos)) : "", num(l.desc) ? money(num(l.desc)) : "", money(c.liquido), ""]));
  fila(["", "", "TOTALES", t.n + " trabajadores", nf(t.dias, 1), t.hx ? nf(t.hx, 1) : "", "", "", money(t.bruto), money(t.iess), money(t.anticipos), money(t.desc), money(t.liquido), ""], { bold: true, fill: SUB, h: 6 });
  if (y + 52 > 196) { doc.addPage("a4", "landscape"); pagina++; y = header(); }
  y += 5;
  const bw = 92;
  doc.setFillColor(...NAVY); doc.rect(M, y, bw, 5.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(255, 255, 255); doc.text("COSTO DEL ROL PARA DLV", M + 2, y + 3.8);
  [["Total ingresos", t.bruto], ["Aporte patronal (" + nf(cfg.iess_patronal) + " %)", t.patronal], ["Provisiones (décimos, vacaciones, fondos de reserva)", t.prov], ["COSTO TOTAL", t.costo, true], ["Aportes a pagar al IESS (personal + patronal)", t.iess + t.patronal]].forEach(([k, v, b], i) => {
    const yy = y + 5.5 + i * 5.6; if (b) { doc.setFillColor(...SUB); doc.rect(M, yy, bw, 5.6, "F"); } doc.setDrawColor(...GRID); doc.rect(M, yy, bw, 5.6);
    doc.setFont("helvetica", b ? "bold" : "normal"); doc.setFontSize(6.8); doc.setTextColor(30, 30, 30); doc.text(k, M + 2, yy + 3.9); doc.text(money(v), M + bw - 2, yy + 3.9, { align: "right" });
  });
  if (r.nota) { doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(60, 60, 60); doc.text(doc.splitTextToSize("Observaciones: " + r.nota, bw).slice(0, 3), M, y + 41); }
  const fw = (W - bw - 16) / 2;
  [["ELABORADO · RESIDENTE DE OBRA", o.residente || ""], ["APROBADO · GERENTE DE PROYECTO", o.gerente || ""]].forEach(([tt, n], i) => {
    const x = M + bw + 8 + i * (fw + 8); doc.setFillColor(...NAVY); doc.rect(x, y, fw, 4.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); doc.setTextColor(255, 255, 255); doc.text(tt, x + fw / 2, y + 3.1, { align: "center" });
    doc.setDrawColor(...GRID); doc.rect(x, y + 4.5, fw, 24); doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(60, 60, 60); doc.text(fit(n || "Nombre / firma", fw - 26), x + 2, y + 26.5); doc.text("___/___/______", x + fw - 2, y + 26.5, { align: "right" });
  });
  const name = `Rol ${String(r.numero).padStart(2, "0")} ${(o.nombre || "").replace(/[\\/:*?"<>|]/g, "")} ${r.desde} a ${r.hasta}.pdf`;
  const blob = doc.output("blob"), file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch((e) => { if (e.name !== "AbortError") doc.save(name); });
  else doc.save(name);
}

/* ---------- eventos ---------- */
function refrescarLinea(i) {
  const { lineas, t } = calcRol(rol), v = $("#v_" + i); if (v && lineas[i]) v.innerHTML = valores(lineas[i].c);
  $("#sumcard").innerHTML = resumen(t);
}
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "fBus") { busca = t.value; const p = t.selectionStart; render(); const b = $("#fBus"); b.focus(); b.setSelectionRange(p, p); return; }
  if (t.dataset.hx) { (marcas[t.dataset.hx] = marcas[t.dataset.hx] || {}).hx = t.value; dirtyAsis = true; estadoDock(); return; }
  if (view === "trab" && t.dataset.p) {
    trab[t.dataset.p] = t.value; dirty = true; estadoDock();
    if (t.dataset.p === "cedula") { const c = t.value.trim(); $("#cedWarn").hidden = !c || c.length < 10 || cedulaOk(c); }
    if (t.dataset.p === "jornal") $("#mensual").textContent = num(t.value) ? "Equivale a " + money(num(t.value) * 30) + " al mes (30 días). El salario básico 2026 es " + money(CFG.sbu) + "." : "";
    return;
  }
  if (view === "rol") {
    if (t.dataset.l) { rol.lineas[+t.dataset.l][t.dataset.k] = t.value; dirty = true; estadoDock(); refrescarLinea(+t.dataset.l); return; }
    if (t.dataset.cfg) { rol.config = { ...CFG, ...rol.config, [t.dataset.cfg]: t.value }; dirty = true; estadoDock(); const { t: tt } = calcRol(rol); $("#sumcard").innerHTML = resumen(tt); calcRol(rol).lineas.forEach((x, i) => { const v = $("#v_" + i); if (v) v.innerHTML = valores(x.c); }); return; }
    if (t.dataset.r === "nota") { rol.nota = t.value; dirty = true; estadoDock(); }
  }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "obraSel") {
    if (dirtyAsis || dirty) { t.value = obraId; return toast("Guarda primero los cambios."); }
    obraId = t.value; try { localStorage.setItem("dlv-obra", obraId); } catch (_) {} view = "lista"; trab = rol = null; cargarObra(); return;
  }
  if (t.id === "fFecha") {
    if (!t.value) return;
    if (dirtyAsis) { t.value = fecha; return toast("Guarda la asistencia del " + fmtF(fecha) + " antes de cambiar de día."); }
    await asegurarAsis(t.value); return abrirFecha(t.value > hoy() ? hoy() : t.value);
  }
  if (t.id === "fTodos") { verTodos = t.checked; render(); return; }
  if (view === "trab") {
    if (t.id === "t_iess") { trab.iess = t.checked; if (t.checked && !trab.iess_fecha) trab.iess_fecha = trab.ingreso || hoy(); dirty = true; render(); return; }
    if (t.id === "t_obra") { trab.obra_id = t.value; dirty = true; estadoDock(); return; }
  }
  if (view === "rol") {
    if (t.id === "r_est") { rol.estado = t.value; dirty = true; render(); return; }
    if (t.id === "r_prov") { rol.config = { ...CFG, ...rol.config, provisiones: t.checked }; dirty = true; render(); return; }
    if (t.dataset.r === "desde" || t.dataset.r === "hasta") { rol[t.dataset.r] = t.value; dirty = true; if (rol.desde && rol.hasta && rol.hasta >= rol.desde) { rol.lineas = await lineasDesdeAsis(rol, rol.lineas); } render(); return; }
  }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) {
    if (dirtyAsis && b.dataset.tab !== "asistencia" && tab === "asistencia") return toast("Guarda primero la asistencia.");
    tab = b.dataset.tab; render(); window.scrollTo(0, 0); return;
  }
  if (b.dataset.dia) {
    if (dirtyAsis) return toast("Guarda la asistencia del " + fmtF(fecha) + " antes de cambiar de día.");
    const f = sumar(fecha, +b.dataset.dia); if (f > hoy()) return; await asegurarAsis(f); return abrirFecha(f);
  }
  if (b.dataset.mk) {
    const id = b.dataset.mk, x = marcas[id] = marcas[id] || {};
    x.e = x.e === b.dataset.e ? undefined : b.dataset.e; if (!x.e) delete marcas[id];
    dirtyAsis = true; const y = window.scrollY; render(); window.scrollTo(0, y); return;
  }
  if (b.dataset.trab) return abrirTrab(trabs.find((x) => x.id === b.dataset.trab));
  if (b.dataset.rol) { rol = JSON.parse(JSON.stringify(roles.find((x) => x.id === b.dataset.rol))); rol.lineas = rol.lineas || []; agregar = false; confirm = null; view = "rol"; dirty = false; render(); window.scrollTo(0, 0); return; }
  if (b.dataset.per && rol) { [rol.desde, rol.hasta] = periodo(b.dataset.per, b.dataset.per === "sem" ? null : rol.desde); rol.lineas = await lineasDesdeAsis(rol, rol.lineas); dirty = true; render(); return; }
  if (b.dataset.qlin && rol) { rol.lineas.splice(+b.dataset.qlin, 1); dirty = true; render(); return; }
  const a = b.dataset.act;
  if (a === "todos") { for (const t of deObra()) if (!(marcas[t.id] || {}).e) marcas[t.id] = { ...(marcas[t.id] || {}), e: "P" }; dirtyAsis = true; render(); return; }
  if (a === "nuevoTrab") { if (dirtyAsis) return toast("Guarda primero la asistencia."); return abrirTrab(null); }
  if (a === "nuevoRol") return nuevoRol();
  if (a === "baja") { const f = $("#t_salida").value || hoy(); return guardarTrab({ activo: false, salida: f }); }
  if (a === "reingreso") return guardarTrab({ activo: true, salida: null, obra_id: trab.obra_id || obraId });
  if (a === "recalc") { rol.lineas = await lineasDesdeAsis(rol, rol.lineas); dirty = true; render(); toast("Días y horas extra actualizados desde la asistencia"); return; }
  if (a === "add") { agregar = true; render(); return; }
  if (a === "addNo") { agregar = false; render(); return; }
  if (a === "addOk") {
    const ids = [...document.querySelectorAll("[data-add]:checked")].map((x) => x.dataset.add);
    for (const t of trabs.filter((x) => ids.includes(x.id))) rol.lineas.push({ tid: t.id, n: t.nombres, ced: t.cedula || "", cargo: t.cargo || "", jornal: num(t.jornal), iess: !!t.iess, ingreso: t.ingreso || null, dias: "", hx: "", bonos: "", anticipos: "", desc: "" });
    agregar = false; dirty = true; render(); return;
  }
  if (a === "delT") { confirm = "t"; render(); return; }
  if (a === "delR") { confirm = "r"; render(); return; }
  if (a === "noDel") { confirm = null; render(); return; }
  if (a === "delTOk") { const { error } = await sb.from("trabajadores").delete().eq("id", trab.id); if (error) return toast("No se pudo borrar."); trabs = trabs.filter((x) => x.id !== trab.id); toast("Ficha borrada"); return volver(); }
  if (a === "delROk") { const { error } = await sb.from("roles_pago").delete().eq("id", rol.id); if (error) return toast("No se pudo borrar."); roles = roles.filter((x) => x.id !== rol.id); toast("Rol borrado"); return volver(); }
  if (b.id === "btnGuardar") return view === "lista" ? guardarAsis() : view === "trab" ? guardarTrab() : guardarRol();
  if (b.id === "btnPDF") { try { pdfRol(); } catch (err) { console.error(err); toast("No se pudo generar el PDF."); } return; }
  if (b.id === "btnVolver") {
    if (dirty && !b.dataset.sure) { b.dataset.sure = "1"; const prev = b.textContent; b.textContent = "¿Salir sin guardar?"; setTimeout(() => { if (b.dataset.sure) { b.dataset.sure = ""; b.textContent = prev; } }, 3000); return; }
    b.dataset.sure = ""; volver();
  }
});
window.addEventListener("beforeunload", (e) => { if (dirtyAsis || dirty) { e.preventDefault(); e.returnValue = ""; } });

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
  if (["asistencia", "trabajadores", "roles"].includes(qs.get("tab"))) tab = qs.get("tab");
  $("#obraSel").innerHTML = obras.length ? obras.map((o) => `<option value="${esc(o.id)}"${o.id === obraId ? " selected" : ""}>${esc(o.nombre)}</option>`).join("") : `<option value="">Sin obras asignadas</option>`;
  await cargarObra();
})();
})();
