// DLV Plataforma — Tablero gerencial: semáforo de todas las obras (plazo, avance físico y económico,
// reportes, subcontratos, pendientes y pólizas), curva de avance real vs. programado e informe semanal en PDF.
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const pd = (f) => { const [y, m, d] = String(f).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const hoy = () => ymd(new Date());
const sumar = (f, n) => { const d = pd(f); d.setDate(d.getDate() + n); return ymd(d); };
const dias = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const fmtF = (f) => { if (!f) return "—"; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
const fmtC = (f) => pd(f).toLocaleDateString("es-EC", { day: "numeric", month: "short" }).replace(".", "");
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };
const money = (n) => "$ " + (n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyK = (n) => n >= 1e6 ? "$ " + (n / 1e6).toLocaleString("es-EC", { maximumFractionDigits: 2 }) + " M" : n >= 1e4 ? "$ " + (n / 1e3).toLocaleString("es-EC", { maximumFractionDigits: 1 }) + " mil" : money(n);
const pct = (n, d = 1) => (n || 0).toLocaleString("es-EC", { minimumFractionDigits: d, maximumFractionDigits: d }) + " %";
const lunes = (f) => { const d = pd(f); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

let sb = null, user = null, perfil = null;
let obras = [], D = {}, R = [], view = "lista", sel = null, semana = lunes(hoy());

/* ---------- datos ---------- */
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await build().range(from, from + 999); if (error) return null; out.push(...(data || [])); if (!data || data.length < 1000) break; }
  return out;
}
async function q(build) { const { data, error } = await build(); return error ? null : data || []; }
async function cargar() {
  const desde = sumar(hoy(), -400);
  const [ob, rep, pls, rub, subs, spl, gar, rdis, actas, mods, avel, avreg] = await Promise.all([
    q(() => sb.from("obras").select("*").eq("activa", true).order("nombre")),
    fetchAll(() => sb.from("reportes").select("obra_id,numero,fecha,datos").gte("fecha", desde).order("fecha")),
    q(() => sb.from("planillas").select("obra_id,numero,fecha,estado,totales").order("numero")),
    fetchAll(() => sb.from("rubros").select("obra_id,cantidad,precio,adicional")),
    q(() => sb.from("subcontratos").select("id,obra_id,contratista,monto,estado")),
    q(() => sb.from("subcontrato_planillas").select("obra_id,subcontrato_id,estado,totales")),
    q(() => sb.from("garantias").select("*").eq("estado", "vigente")),
    q(() => sb.from("rdis").select("obra_id,numero,asunto,estado,plazo,fecha,dirigido_a")),
    q(() => sb.from("actas").select("obra_id,numero,fecha,acuerdos")),
    q(() => sb.from("modelos").select("obra_id,elementos,creado").order("creado")),
    fetchAll(() => sb.from("avance_elementos").select("obra_id,estado,pct")),
    q(() => sb.from("avance_registros").select("obra_id,fecha,estado,pct,resumen,niveles,fotos,total").gte("fecha", sumar(hoy(), -120)).order("fecha"))
  ]);
  obras = ob || [];
  D = { rep: rep || [], pls: pls || [], rub: rub || [], subs: subs || [], spl: spl || [], gar: gar || [], rdis: rdis || [], actas: actas || [], mods: mods || [], avel: avel || [], avreg: avreg || [],
    mod: { pls: !!pls, subs: !!subs, rdi: !!rdis, bim: !!mods } };
  R = obras.map(resumen).sort((a, b) => ({ mal: 0, aviso: 1, ok: 2 }[a.sem] - { mal: 0, aviso: 1, ok: 2 }[b.sem]) || a.o.nombre.localeCompare(b.o.nombre, "es"));
}

/* ---------- indicadores por obra ---------- */
function resumen(o) {
  const H = hoy(), por = (arr) => arr.filter((x) => x.obra_id === o.id);
  const reps = por(D.rep);
  // plazo
  const plazo = { inicio: o.inicio, total: num(o.plazo) };
  if (o.inicio && plazo.total) {
    plazo.fin = sumar(o.inicio, plazo.total - 1); plazo.trans = Math.max(0, dias(o.inicio, H) + 1); plazo.rest = plazo.total - plazo.trans;
    plazo.pct = Math.min(100, Math.max(0, plazo.trans / plazo.total * 100)); plazo.vencida = plazo.rest < 0;
  }
  // avance físico (lo declara el residente en el reporte diario)
  const serie = reps.filter((r) => r.datos && String(r.datos.avance ?? "").trim() !== "").map((r) => ({ fecha: r.fecha, v: num(r.datos.avance) }));
  const fisico = serie.length ? serie[serie.length - 1] : null;
  const desv = fisico && plazo.pct != null ? fisico.v - plazo.pct : null;
  // avance económico (estado de pago)
  const pls = por(D.pls), ult = pls[pls.length - 1];
  const rub = por(D.rub), totalPres = rub.reduce((t, r) => t + num(r.cantidad) * num(r.precio), 0);
  const eco = { total: ult && ult.totales ? num(ult.totales.total) : totalPres, acumulado: ult && ult.totales ? num(ult.totales.acumulado) : 0, ultima: ult || null, n: pls.length,
    porCobrar: pls.filter((p) => p.estado === "presentada" || p.estado === "aprobada").reduce((t, p) => t + num((p.totales || {}).liquido), 0) };
  eco.pct = eco.total > 0 ? eco.acumulado / eco.total * 100 : null;
  // modelo 3D
  const mod = por(D.mods).pop(), avel = por(D.avel);
  const bim = mod && mod.elementos ? { pct: avel.reduce((t, e) => t + (e.estado === "ok" ? 100 : e.estado === "ni" ? 0 : num(e.pct)), 0) / mod.elementos, elementos: mod.elementos } : null;
  // reportes
  const ultRep = reps[reps.length - 1], desde7 = sumar(H, -6);
  const sem = reps.filter((r) => r.fecha >= desde7);
  const pers = (r) => ["directa", "indirecta"].reduce((t, k) => t + ((r.datos || {})[k] || []).reduce((s, p) => s + num(p.n), 0), 0);
  const rep = { ultimo: ultRep ? ultRep.fecha : null, sinReporte: ultRep ? dias(ultRep.fecha, H) : null, semana: sem.length,
    personal: sem.length ? sem.reduce((t, r) => t + pers(r), 0) / sem.length : 0, horasPar: sem.reduce((t, r) => t + num(((r.datos || {}).clima || {}).horasPar), 0),
    incidentes: reps.filter((r) => r.fecha >= sumar(H, -29) && /\S/.test(((r.datos || {}).sso || {}).incidentes || "") && !/^ningun/i.test(((r.datos || {}).sso || {}).incidentes.trim())).length };
  // subcontratos
  const subs = por(D.subs).filter((s) => s.estado !== "anulado"), spl = por(D.spl);
  const sub = { n: subs.length, monto: subs.reduce((t, s) => t + num(s.monto), 0), planillado: spl.reduce((t, p) => t + num((p.totales || {}).bruto), 0) };
  // pendientes
  const gars = por(D.gar).map((g) => ({ ...g, d: g.vencimiento ? dias(H, g.vencimiento) : null }));
  const gar = { vencidas: gars.filter((g) => g.d != null && g.d < 0), porVencer: gars.filter((g) => g.d != null && g.d >= 0 && g.d <= 30) };
  const rdis = por(D.rdis).filter((r) => r.estado === "abierto");
  const rdi = { abiertos: rdis, vencidos: rdis.filter((r) => r.plazo && r.plazo < H) };
  const acus = por(D.actas).flatMap((a) => (a.acuerdos || []).filter((x) => x.estado !== "cumplido").map((x) => ({ ...x, acta: a.numero })));
  const acu = { pend: acus, venc: acus.filter((x) => x.plazo && x.plazo < H) };
  // semáforo
  const mal = [], aviso = [];
  if (plazo.vencida && (!fisico || fisico.v < 100)) mal.push("Plazo contractual vencido hace " + -plazo.rest + " días");
  else if (plazo.rest != null && plazo.rest <= 15 && fisico && fisico.v < 90) aviso.push("Quedan " + plazo.rest + " días y el avance es " + pct(fisico.v, 0));
  if (desv != null && desv < -10) mal.push("Atraso de " + pct(-desv, 0) + " frente al avance programado");
  else if (desv != null && desv < -5) aviso.push("Atraso de " + pct(-desv, 0) + " frente al programado");
  if (rep.sinReporte != null && rep.sinReporte > 3 && !plazo.vencida) mal.push(rep.sinReporte + " días sin reporte diario");
  else if (rep.sinReporte != null && rep.sinReporte > 1) aviso.push(rep.sinReporte + " días sin reporte diario");
  if (gar.vencidas.length) mal.push(gar.vencidas.length + (gar.vencidas.length === 1 ? " póliza vencida" : " pólizas vencidas"));
  if (gar.porVencer.length) aviso.push(gar.porVencer.length + (gar.porVencer.length === 1 ? " póliza vence" : " pólizas vencen") + " en 30 días");
  if (rdi.vencidos.length) mal.push(rdi.vencidos.length + " RDI sin respuesta fuera de plazo");
  if (acu.venc.length) aviso.push(acu.venc.length + (acu.venc.length === 1 ? " acuerdo de acta vencido" : " acuerdos de actas vencidos"));
  if (rep.incidentes) aviso.push(rep.incidentes + (rep.incidentes === 1 ? " incidente de seguridad" : " incidentes de seguridad") + " en 30 días");
  return { o, plazo, serie, fisico, desv, eco, bim, rep, sub, gar, rdi, acu, sem: mal.length ? "mal" : aviso.length ? "aviso" : "ok", motivos: [...mal, ...aviso] };
}

/* ---------- render ---------- */
const SEM = { ok: "Al día", aviso: "Atención", mal: "En riesgo" };
const barra = (label, v, cls = "") => `<div class="bar3"><span>${label}</span><div class="meter ${cls}"><i style="width:${Math.min(100, Math.max(0, v || 0)).toFixed(1)}%"></i></div><b>${v == null ? "—" : pct(v, 0)}</b></div>`;
function render() {
  const m = $("#main");
  $("#top").hidden = !user; $("#dock").hidden = view !== "obra";
  if (!user) { m.innerHTML = `<div class="empty"><b>Inicia sesión</b><span>Entra desde el menú de DLV.</span><a class="btn primary" href="/">Ir al menú</a></div>`; return; }
  if (!obras.length) { m.innerHTML = `<div class="empty"><b>Sin obras activas.</b></div>`; return; }
  if (view === "obra") return renderObra(m);
  const enRiesgo = R.filter((r) => r.sem === "mal").length, monto = R.reduce((t, r) => t + (r.eco.total || 0), 0), plan = R.reduce((t, r) => t + (r.eco.acumulado || 0), 0), cobrar = R.reduce((t, r) => t + r.eco.porCobrar, 0);
  m.innerHTML = `
  <section class="obracard"><div class="listhead"><h1>Todas las obras</h1><span class="code">${new Date().toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span></div>
    <div class="kpis"><div><small>Obras activas</small><b>${R.length}</b></div><div><small>En riesgo</small><b class="${enRiesgo ? "rojo" : ""}">${enRiesgo}</b></div>
      <div><small>Contratado</small><b>${moneyK(monto)}</b></div><div><small>Planillado</small><b>${moneyK(plan)}</b></div><div><small>Por cobrar</small><b>${moneyK(cobrar)}</b></div></div></section>
  <div class="tgrid">${R.map((r) => `
    <button class="tcard s-${r.sem}" type="button" data-obra="${esc(r.o.id)}">
      <div class="th"><span class="dot s-${r.sem}"></span><b>${esc(r.o.nombre)}</b><span class="pill sp-${r.sem}">${SEM[r.sem]}</span></div>
      ${barra("Tiempo", r.plazo.pct, "t")}${barra("Físico", r.fisico ? r.fisico.v : null, "f")}${barra("Económico", r.eco.pct, "e")}${r.bim ? barra("Modelo 3D", r.bim.pct, "b") : ""}
      <ul class="mot">${r.motivos.slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>Sin alertas</li>"}</ul>
      <span class="code">${r.plazo.rest != null ? (r.plazo.rest >= 0 ? r.plazo.rest + " días restantes" : "plazo vencido") : "sin plazo cargado"} · último reporte ${r.rep.ultimo ? fmtC(r.rep.ultimo) : "—"}</span>
    </button>`).join("")}</div>
  <p class="code">Tiempo: días transcurridos del plazo contractual. Físico: el % acumulado del último reporte diario. Económico: planillado acumulado sobre el monto total del contrato.</p>`;
}
function curva(r) {
  const p = r.plazo; if (!p.inicio || !p.total) return `<span class="code">Carga el inicio y el plazo de la obra para ver la curva de avance.</span>`;
  const W = 600, Hh = 220, L = 36, B = 26, T = 10, Rr = 12, w = W - L - Rr, h = Hh - B - T;
  const x = (f) => L + Math.max(0, Math.min(1, dias(p.inicio, f) / (p.total - 1 || 1))) * w, y = (v) => T + h - Math.max(0, Math.min(100, v)) / 100 * h;
  const pts = r.serie.map((s) => `${x(s.fecha).toFixed(1)},${y(s.v).toFixed(1)}`).join(" ");
  const H = hoy(), xh = x(H), ult = r.serie[r.serie.length - 1];
  const ticks = [0, 25, 50, 75, 100].map((v) => `<line x1="${L}" x2="${L + w}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3}" class="ax" text-anchor="end">${v}%</text>`).join("");
  const meses = []; for (let i = 0; i <= 4; i++) { const f = sumar(p.inicio, Math.round((p.total - 1) * i / 4)); meses.push(`<text x="${x(f)}" y="${Hh - 8}" class="ax" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${fmtC(f)}</text>`); }
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Avance real frente al programado">
    ${ticks}${meses.join("")}
    <line x1="${L}" y1="${y(0)}" x2="${L + w}" y2="${y(100)}" class="prog"/>
    ${H >= p.inicio && H <= p.fin ? `<line x1="${xh}" x2="${xh}" y1="${T}" y2="${T + h}" class="hoy"/><text x="${xh + 3}" y="${T + 9}" class="ax">hoy</text>` : ""}
    ${r.serie.length > 1 ? `<polyline points="${pts}" class="real"/>` : ""}
    ${ult ? `<circle cx="${x(ult.fecha)}" cy="${y(ult.v)}" r="4" class="realpt"/><text x="${x(ult.fecha) + 6}" y="${y(ult.v) - 6}" class="lbl">${pct(ult.v, 0)}</text>` : ""}
  </svg><div class="leg"><span><i class="lr"></i>Real (reportes diarios)</span><span><i class="lp"></i>Programado lineal</span></div></div>`;
}
function renderObra(m) {
  const r = R.find((x) => x.o.id === sel); if (!r) { view = "lista"; return render(); }
  const o = r.o, pls = D.pls.filter((p) => p.obra_id === o.id).slice(-4).reverse();
  const card = (t, body, link) => `<section class="tbox"><div class="tbh"><h3>${t}</h3>${link ? `<a class="btn sm" href="${link}">Abrir</a>` : ""}</div>${body}</section>`;
  m.innerHTML = `
  <section class="obracard s-${r.sem}"><div class="listhead"><h1>${esc(o.nombre)}</h1><span class="pill sp-${r.sem}">${SEM[r.sem]}</span></div>
    <span class="code">${esc(o.cliente || "")}${o.fiscalizador ? " · fiscaliza " + esc(o.fiscalizador) : ""}${o.residente ? " · residente " + esc(o.residente) : ""}</span>
    ${barra("Tiempo", r.plazo.pct, "t")}${barra("Físico", r.fisico ? r.fisico.v : null, "f")}${barra("Económico", r.eco.pct, "e")}${r.bim ? barra("Modelo 3D", r.bim.pct, "b") : ""}
    ${r.motivos.length ? `<ul class="mot big">${r.motivos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<span class="code">Sin alertas.</span>`}
  </section>
  ${card("Curva de avance", curva(r))}
  <div class="tcols">
  ${card("Plazo", `<div class="kv2"><span>Inicio</span><b>${fmtF(r.plazo.inicio)}</b><span>Término contractual</span><b>${fmtF(r.plazo.fin)}</b><span>Transcurridos</span><b>${r.plazo.trans ?? "—"} de ${r.plazo.total || "—"} días</b><span>Restantes</span><b class="${r.plazo.vencida ? "rojo" : ""}">${r.plazo.rest ?? "—"}</b><span>Desviación física</span><b class="${r.desv != null && r.desv < -5 ? "rojo" : ""}">${r.desv == null ? "—" : (r.desv >= 0 ? "+" : "−") + pct(Math.abs(r.desv), 1)}</b></div>`)}
  ${card("Reportes diarios", `<div class="kv2"><span>Último</span><b>${fmtF(r.rep.ultimo)}</b><span>Reportes últimos 7 días</span><b>${r.rep.semana}</b><span>Personal promedio</span><b>${r.rep.personal.toLocaleString("es-EC", { maximumFractionDigits: 1 })}</b><span>Horas paralizadas (7 días)</span><b>${r.rep.horasPar.toLocaleString("es-EC")}</b><span>Incidentes (30 días)</span><b class="${r.rep.incidentes ? "rojo" : ""}">${r.rep.incidentes}</b></div>`, "/reportes")}
  ${card("Estado de pago", D.mod.pls ? `<div class="kv2"><span>Contrato + adicionales</span><b>${money(r.eco.total)}</b><span>Planillado</span><b>${money(r.eco.acumulado)}</b><span>Por cobrar (presentadas y aprobadas)</span><b>${money(r.eco.porCobrar)}</b></div>
    <div class="mini">${pls.map((p) => `<div><span>EP-${String(p.numero).padStart(2, "0")} · ${fmtF(p.fecha)}</span><b>${money(num((p.totales || {}).bruto))}</b><span class="pill est-${esc(p.estado)}">${esc(p.estado)}</span></div>`).join("") || `<span class="code">Sin planillas.</span>`}</div>` : `<span class="code">Programa no activado.</span>`, "/planillas?obra=" + encodeURIComponent(o.id))}
  ${card("Subcontratos", D.mod.subs ? `<div class="kv2"><span>Contratos</span><b>${r.sub.n}</b><span>Monto contratado</span><b>${money(r.sub.monto)}</b><span>Planillado</span><b>${money(r.sub.planillado)}</b></div>
    <div class="mini">${[...r.gar.vencidas, ...r.gar.porVencer].map((g) => `<div><span>${esc(g.emisor || "Póliza")} ${esc(g.numero || "")}</span><b>${money(num(g.monto))}</b><span class="pill ${g.d < 0 ? "gp-mal" : "gp-aviso"}">${g.d < 0 ? "vencida" : "vence " + fmtC(g.vencimiento)}</span></div>`).join("")}</div>` : `<span class="code">Programa no activado.</span>`, "/subcontratos?obra=" + encodeURIComponent(o.id))}
  ${card("Pendientes", D.mod.rdi ? `<div class="kv2"><span>RDI abiertos</span><b>${r.rdi.abiertos.length}</b><span>RDI fuera de plazo</span><b class="${r.rdi.vencidos.length ? "rojo" : ""}">${r.rdi.vencidos.length}</b><span>Acuerdos pendientes</span><b>${r.acu.pend.length}</b><span>Acuerdos vencidos</span><b class="${r.acu.venc.length ? "rojo" : ""}">${r.acu.venc.length}</b></div>
    <div class="mini">${r.rdi.vencidos.slice(0, 3).map((x) => `<div><span>RDI-${String(x.numero).padStart(3, "0")} ${esc(x.asunto)}</span><span class="pill gp-mal">desde ${fmtC(x.plazo)}</span></div>`).join("")}</div>` : `<span class="code">Programa no activado.</span>`, "/rdi?obra=" + encodeURIComponent(o.id))}
  </div>
  <section class="tbox"><div class="tbh"><h3>Informe semanal</h3></div>
    <div class="grid2"><label class="fld" for="semSel"><span>Semana que empieza el lunes</span><input id="semSel" type="date" value="${esc(semana)}"></label>
    <div class="fld"><span>Período</span><div class="acum">${fmtF(semana)} – ${fmtF(sumar(semana, 6))}</div></div></div>
    <span class="code">Arma el informe con los reportes diarios, el avance en el modelo, las planillas, los pendientes y hasta 4 fotos de esa semana.</span>
  </section>`;
}

/* ---------- informe semanal (PDF A4 vertical) ---------- */
async function token() { const { data: { session } } = await sb.auth.getSession(); return session?.access_token || ""; }
async function imgData(obraId, key) {
  try {
    const r = await fetch(`/api/fotos?obra=${encodeURIComponent(obraId)}&key=${encodeURIComponent(key)}`, { headers: { Authorization: "Bearer " + await token() } });
    if (!r.ok) return null;
    const url = URL.createObjectURL(await r.blob());
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
    return { data: c.toDataURL("image/jpeg", 0.82), w: c.width, h: c.height };
  } catch (_) { return null; }
}
async function informe() {
  if (!window.jspdf) return toast("No se cargó el generador de PDF. Revisa tu conexión y recarga.");
  const r = R.find((x) => x.o.id === sel), o = r.o, ini = semana, fin = sumar(semana, 6);
  const reps = D.rep.filter((x) => x.obra_id === o.id && x.fecha >= ini && x.fecha <= fin);
  const antes = r.serie.filter((s) => s.fecha < ini).pop(), alFin = r.serie.filter((s) => s.fecha <= fin).pop();
  const progFin = r.plazo.inicio && r.plazo.total ? Math.min(100, Math.max(0, (dias(r.plazo.inicio, fin) + 1) / r.plazo.total * 100)) : null;
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" }); { const _t = doc.text.bind(doc), _l = (s) => typeof s === "string" ? s.replace(/[\u2212\u2013]/g, "-").replace(/\u2713/g, "»").replace(/\u2610/g, "[  ]").replace(/[\u2605\u2606]/g, "*").replace(/\u2197/g, ">").replace(/\u2199/g, "<").replace(/\u2192/g, "->") : s; doc.text = (s, ...a) => _t(Array.isArray(s) ? s.map(_l) : _l(s), ...a); }
  const M = 12, W = 186, NAVY = [29, 53, 87], AMB = [232, 163, 23], GRID = [150, 150, 150], LBL = [236, 235, 227];
  let y = 0, page = 1;
  const fit = (s, w) => { s = String(s ?? ""); while (s && doc.getTextWidth(s) > w) s = s.slice(0, -2) + "…"; return s; };
  const header = () => {
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.rect(M, M, W, 18); doc.line(M + 44, M, M + 44, M + 18); doc.line(M + W - 44, M, M + W - 44, M + 18);
    doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("DLV", M + 5, M + 9.5); doc.setFillColor(...AMB); doc.rect(M + 5, M + 10.8, 15, 1, "F");
    doc.setFontSize(6.2); doc.text("CONSTRUCCIONES CÍA. LTDA.", M + 5, M + 14.6);
    doc.setFontSize(12.5); doc.text("INFORME SEMANAL DE OBRA", M + 44 + (W - 88) / 2, M + 8.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85, 85, 85); doc.text(fit(o.nombre, W - 92), M + 44 + (W - 88) / 2, M + 13.5, { align: "center" });
    [["SEMANA", fmtF(ini)], ["AL", fmtF(fin)], ["PÁGINA", String(page)]].forEach(([k, v], i) => { const x = M + W - 44, yy = M + i * 6; if (i) doc.line(x, yy, M + W, yy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(k, x + 1.5, yy + 4); doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30); doc.text(v, M + W - 1.5, yy + 4, { align: "right" }); });
    doc.setFontSize(5.6); doc.setTextColor(120, 120, 120); doc.text("DLV Construcciones Cía. Ltda. · Av. Primero de Mayo y Av. de las Américas, Cuenca", M, 290);
    y = M + 22;
  };
  const need = (h) => { if (y + h > 282) { doc.addPage(); page++; header(); } };
  const bar = (t) => { need(14); doc.setFillColor(...NAVY); doc.rect(M, y, W, 5.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(7.4); doc.setTextColor(255, 255, 255); doc.text(t, M + 2, y + 3.9); y += 7; };
  const par = (t, size = 8) => { doc.setFont("helvetica", "normal"); doc.setFontSize(size); doc.setTextColor(30, 30, 30); for (const l of doc.splitTextToSize(String(t || ""), W - 4)) { need(4.2); doc.text(l, M + 2, y + 3.2); y += 4; } y += 1.5; };
  const tabla = (heads, widths, rows, al = []) => {
    need(11); let x = M; doc.setFillColor(...LBL); doc.rect(M, y, W, 5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); doc.setTextColor(...NAVY);
    heads.forEach((h, i) => { doc.text(h, al[i] === "r" ? x + widths[i] - 1.5 : x + 1.5, y + 3.5, { align: al[i] === "r" ? "right" : "left" }); x += widths[i]; }); y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(30, 30, 30);
    for (const row of rows) {
      const cells = row.map((c, i) => doc.splitTextToSize(String(c ?? ""), widths[i] - 3)), h = Math.max(5, Math.max(...cells.map((c) => c.length)) * 3.4 + 1.8);
      need(h); x = M; doc.setDrawColor(210, 210, 210); doc.line(M, y + h, M + W, y + h);
      cells.forEach((c, i) => { doc.text(c, al[i] === "r" ? x + widths[i] - 1.5 : x + 1.5, y + 3.6, { align: al[i] === "r" ? "right" : "left" }); x += widths[i]; }); y += h;
    }
    y += 3;
  };
  const kpi = (pares) => {
    const w = W / pares.length; need(15);
    pares.forEach(([k, v], i) => { const x = M + i * w; doc.setDrawColor(...GRID); doc.rect(x, y, w, 13); doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.setTextColor(...NAVY); doc.text(k, x + 2, y + 4);
      doc.setFontSize(10.5); doc.setTextColor(30, 30, 30); doc.text(String(v), x + 2, y + 10.5); });
    y += 16;
  };
  header();
  // 1. datos generales
  bar("1. DATOS GENERALES");
  tabla(["", "", "", ""], [30, 63, 30, 63], [["Cliente", o.cliente || "—", "Contrato", o.contrato || "—"], ["Fiscalización", o.fiscalizador || "—", "Residente", o.residente || "—"],
    ["Inicio", fmtF(r.plazo.inicio), "Término contractual", fmtF(r.plazo.fin)], ["Plazo", (r.plazo.total || "—") + " días", "Días al cierre de semana", r.plazo.inicio ? (dias(r.plazo.inicio, fin) + 1) + " transcurridos" : "—"]]);
  // 2. indicadores
  bar("2. AVANCE");
  kpi([["FÍSICO AL INICIO", antes ? pct(antes.v, 1) : "—"], ["FÍSICO AL CIERRE", alFin ? pct(alFin.v, 1) : "—"], ["PROGRAMADO", progFin == null ? "—" : pct(progFin, 1)], ["DESVIACIÓN", alFin && progFin != null ? (alFin.v - progFin >= 0 ? "+" : "") + pct(alFin.v - progFin, 1) : "—"]]);
  kpi([["AVANCE SEMANAL", antes && alFin ? pct(alFin.v - antes.v, 1) : "—"], ["ECONÓMICO", r.eco.pct == null ? "—" : pct(r.eco.pct, 1)], ["PLANILLADO", moneyK(r.eco.acumulado)], ["POR COBRAR", moneyK(r.eco.porCobrar)]]);
  // 3. recursos y clima por día
  bar("3. PERSONAL, CLIMA Y PARALIZACIONES");
  const pers = (x) => ["directa", "indirecta"].reduce((t, k) => t + ((x.datos || {})[k] || []).reduce((s, p) => s + num(p.n), 0), 0);
  if (reps.length) tabla(["FECHA", "REPORTE", "PERSONAL", "CLIMA (MAÑANA / TARDE)", "H. PARALIZ.", "AVANCE %"], [24, 22, 22, 70, 22, 26],
    reps.map((x) => { const c = (x.datos || {}).clima || {}; return [fmtF(x.fecha), "RDO-" + String(x.numero).padStart(4, "0"), pers(x), (c.manana || "") + " / " + (c.tarde || ""), num(c.horasPar) || "", (x.datos || {}).avance || ""]; }), ["l", "l", "r", "l", "r", "r"]);
  else par("No hay reportes diarios registrados en esta semana.");
  // 4. actividades
  const act = new Map();
  for (const x of reps) for (const a of (x.datos || {}).actividades || []) {
    if (!(a.desc || a.cod)) continue;
    const k = (a.cod || "") + "|" + (a.desc || "").trim().toLowerCase(), e = act.get(k) || { cod: a.cod || "", desc: a.desc || "", und: a.und || "", cant: 0, ubic: new Set(), dias: 0 };
    e.cant += num(a.cant); if (a.ubic) e.ubic.add(a.ubic); e.dias++; act.set(k, e);
  }
  bar("4. ACTIVIDADES EJECUTADAS");
  if (act.size) tabla(["CÓD.", "ACTIVIDAD", "UBICACIÓN", "DÍAS", "CANT. SEMANA", "UND"], [16, 78, 40, 12, 26, 14], [...act.values()].map((e) => [e.cod, e.desc, [...e.ubic].join(", "), e.dias, e.cant ? e.cant.toLocaleString("es-EC", { maximumFractionDigits: 2 }) : "", e.und]), ["l", "l", "l", "r", "r", "l"]);
  else par("Sin actividades registradas.");
  // 5. avance en el modelo 3D
  const bim = D.avreg.filter((x) => x.obra_id === o.id && x.fecha >= ini && x.fecha <= fin);
  if (bim.length) { bar("5. AVANCE REGISTRADO EN EL MODELO 3D"); tabla(["FECHA", "ELEMENTOS", "NIVELES", "ESTADO"], [24, 80, 50, 32], bim.map((x) => [fmtF(x.fecha), x.resumen || x.total + " elementos", x.niveles || "", { ok: "Terminado", ej: "En ejecución " + Math.round(num(x.pct)) + " %", ob: "Observado", ni: "No iniciado" }[x.estado] || x.estado])); }
  // 6. novedades, seguridad y ensayos
  const nov = reps.flatMap((x) => ((x.datos || {}).novedades || []).filter(Boolean).map((t) => fmtC(x.fecha) + ": " + t));
  const inc = reps.map((x) => ((x.datos || {}).sso || {}).incidentes).filter((t) => t && !/^ningun/i.test(t.trim()));
  const charlas = reps.filter((x) => ((x.datos || {}).sso || {}).charla).length;
  bar((bim.length ? "6" : "5") + ". NOVEDADES, SEGURIDAD Y CALIDAD");
  par("Charlas de seguridad: " + charlas + " de " + reps.length + " días reportados · Incidentes: " + (inc.length ? inc.join("; ") : "ninguno"), 7.6);
  if (nov.length) for (const n of nov) par("• " + n, 7.6); else par("Sin novedades registradas.", 7.6);
  // 7. pendientes
  bar((bim.length ? "7" : "6") + ". PENDIENTES");
  const pend = [
    ...r.rdi.abiertos.map((x) => ["RDI-" + String(x.numero).padStart(3, "0"), x.asunto, x.dirigido_a || "", x.plazo ? fmtF(x.plazo) + (x.plazo < hoy() ? " (vencido)" : "") : ""]),
    ...r.acu.pend.map((x) => ["ACT-" + String(x.acta).padStart(3, "0"), x.texto, x.responsable || "", x.plazo ? fmtF(x.plazo) + (x.plazo < hoy() ? " (vencido)" : "") : ""]),
    ...[...r.gar.vencidas, ...r.gar.porVencer].map((g) => ["PÓLIZA", (g.emisor || "") + " " + (g.numero || "") + " · " + money(num(g.monto)), "", fmtF(g.vencimiento) + (g.d < 0 ? " (vencida)" : "")])
  ];
  if (pend.length) tabla(["REF.", "DESCRIPCIÓN", "RESPONSABLE", "PLAZO"], [22, 96, 36, 32], pend); else par("Sin pendientes.");
  // 8. fotos
  const keys = [...reps.flatMap((x) => ((x.datos || {}).fotos || []).map((f) => ({ key: f.key, desc: f.desc || "", fecha: x.fecha }))), ...bim.flatMap((x) => (x.fotos || []).map((f) => ({ key: f.key, desc: x.resumen || "", fecha: x.fecha })))].slice(0, 4);
  if (keys.length) {
    const imgs = await Promise.all(keys.map((k) => imgData(o.id, k.key)));
    bar("REGISTRO FOTOGRÁFICO"); const w = (W - 6) / 2, h = 64;
    for (let i = 0; i < keys.length; i += 2) {
      need(h + 7);
      keys.slice(i, i + 2).forEach((k, j) => { const x = M + j * (w + 6), im = imgs[i + j]; doc.setDrawColor(...GRID); doc.rect(x, y, w, h);
        if (im) { const s = Math.min((w - 2) / im.w, (h - 2) / im.h); doc.addImage(im.data, "JPEG", x + (w - im.w * s) / 2, y + (h - im.h * s) / 2, im.w * s, im.h * s); }
        doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(60, 60, 60); doc.text(fit(fmtC(k.fecha) + " · " + k.desc, w - 2), x + 1, y + h + 3.5); });
      y += h + 7;
    }
  }
  // firmas
  need(30); y += 4; const fw = (W - 6) / 2;
  [["ELABORADO · RESIDENTE DE OBRA", o.residente], ["REVISADO · GERENTE DE PROYECTO", o.gerente]].forEach(([t, n], i) => { const x = M + i * (fw + 6);
    doc.setFillColor(...NAVY); doc.rect(x, y, fw, 4, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); doc.setTextColor(255, 255, 255); doc.text(t, x + fw / 2, y + 2.8, { align: "center" });
    doc.setDrawColor(...GRID); doc.rect(x, y + 4, fw, 18); doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(60, 60, 60); doc.text(fit(n || "Nombre / firma", fw - 4), x + 2, y + 20); });
  const name = `Informe semanal ${(o.nombre || "").replace(/[\\/:*?"<>|]/g, "")} ${ini}.pdf`;
  const blob = doc.output("blob"), file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch((e) => { if (e.name !== "AbortError") doc.save(name); });
  else doc.save(name);
}

/* ---------- eventos ---------- */
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.obra) { sel = b.dataset.obra; view = "obra"; try { localStorage.setItem("dlv-obra", sel); } catch (_) {} render(); window.scrollTo(0, 0); return; }
  if (b.id === "btnVolver") { view = "lista"; render(); window.scrollTo(0, 0); return; }
  if (b.id === "btnPDF") { b.disabled = true; b.textContent = "Armando…"; try { await informe(); } catch (err) { toast("No se pudo generar el informe."); } finally { b.disabled = false; b.textContent = "Informe semanal"; } }
});
document.addEventListener("change", (e) => { if (e.target.id === "semSel" && e.target.value) { semana = lunes(e.target.value); render(); } });

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
  $("#main").innerHTML = `<div class="empty">Reuniendo datos de las obras…</div>`;
  await cargar();
  const want = new URLSearchParams(location.search).get("obra");
  if (want && obras.find((o) => o.id === want)) { sel = want; view = "obra"; }
  render();
})();
})();
