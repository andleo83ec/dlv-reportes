// DLV Reportes — Avance BIM: visor 3D del IFC de la obra para registrar avance por elemento,
// con fotos en R2 (vía /api/fotos) y datos en Supabase (modelos, avance_elementos, avance_registros).
(function () {
"use strict";
const ST = {
  ni: { label: "No iniciado", v: "--st-ni" },
  ej: { label: "En ejecución", v: "--st-ej" },
  ok: { label: "Terminado", v: "--st-ok" },
  ob: { label: "Observado", v: "--st-ob" }
};
const ST_ORDER = ["ok", "ej", "ob", "ni"];
const MAX_FOTOS = 4;
const S = {
  model: null, modelo: null, text: null, fileName: "", local: false,
  els: [], byGuid: new Map(), prog: new Map(), regs: [], storeyName: new Map(),
  sel: new Set(), multi: false, dim: true, colorMode: "estado",
  hiddenStoreys: new Set(), hiddenCats: new Set(), hiddenStates: new Set(),
  tab: "reg", weight: "vol",
  form: { s: "ej", p: 50, f: hoy(), n: "", fotos: [] },
  history: new Map()
};
let sb = null, user = null, perfil = null, obras = [], obraId = "";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (v, d = 0) => (Number.isFinite(v) ? v : 0).toLocaleString("es-EC", { minimumFractionDigits: d, maximumFractionDigits: d });
function hoy() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function fdate(s) { if (!s) return ""; const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric" }).replace(".", "").replace(/ de /g, " "); }
const lvlTxt = e => "N " + (e >= 0 ? "+" : "−") + fmt(Math.abs(e), 2);
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); }
const stOf = g => (S.prog.get(g) || { s: "ni", p: 0 });
const pctOf = en => en.s === "ok" ? 100 : en.s === "ni" ? 0 : Math.max(0, Math.min(100, Number(en.p) || 0));
const autorNombre = () => (perfil && perfil.nombre) || (user && user.email) || "";

// ================= 3D =================
const V = { ok: typeof THREE !== "undefined" && THREE.OrbitControls };
function initViewer() {
  if (!V.ok) return;
  const cv = $("#cv");
  V.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  V.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  V.scene = new THREE.Scene();
  V.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
  V.camera.position.set(20, 16, 20);
  V.controls = new THREE.OrbitControls(V.camera, cv);
  V.controls.enableDamping = true; V.controls.dampingFactor = 0.12; V.controls.screenSpacePanning = true;
  V.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f94, 0.85));
  const dl = new THREE.DirectionalLight(0xffffff, 0.55); dl.position.set(0.6, 1, 0.35); V.scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.2); dl2.position.set(-0.5, 0.3, -0.8); V.scene.add(dl2);
  V.root = new THREE.Group(); V.root.rotation.x = -Math.PI / 2; V.scene.add(V.root);
  V.edgeMat = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.22 });
  V.ray = new THREE.Raycaster();
  V.dirty = true;
  V.controls.addEventListener("change", () => V.dirty = true);
  new ResizeObserver(resize).observe($("#stage"));
  resize(); applyTheme();
  let down = null;
  cv.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener("pointerup", e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (moved < 7 && dt < 600) pick(e.clientX, e.clientY);
  });
  (function loop() { requestAnimationFrame(loop); const ch = V.controls.update(); if (ch || V.dirty) { V.renderer.render(V.scene, V.camera); V.dirty = false; } })();
}
function resize() {
  if (!V.ok) return;
  const r = $("#stage").getBoundingClientRect();
  if (!r.width || !r.height) return;
  V.renderer.setSize(r.width, r.height, false);
  V.camera.aspect = r.width / r.height; V.camera.updateProjectionMatrix(); V.dirty = true;
}
function applyTheme() {
  if (!V.ok) return;
  V.scene.background = new THREE.Color(cssv("--stage") || "#E2E6E8");
  V.edgeMat.color.set(cssv("--edge") || "#333");
  paintAll();
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => setTimeout(applyTheme, 30));

function clearScene() {
  if (!V.ok) return;
  for (const el of S.els) { if (el.mesh) { el.mesh.geometry.dispose(); el.mesh.material.dispose(); if (el.edges) el.edges.geometry.dispose(); } }
  V.root.clear(); V.dirty = true;
}
function buildScene(model) {
  const totalTris = model.elements.reduce((s, e) => s + e.pos.length / 9, 0);
  const withEdges = totalTris < 500000;
  for (const el of model.elements) {
    if (!V.ok) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(el.pos, 3));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const mesh = new THREE.Mesh(g, m); mesh.userData.guid = el.guid;
    el.mesh = mesh; V.root.add(mesh);
    if (withEdges) { const eg = new THREE.EdgesGeometry(g, 28); el.edges = new THREE.LineSegments(eg, V.edgeMat); mesh.add(el.edges); }
    el.pos = null;
  }
}
function fitView(meshes) {
  if (!V.ok) return;
  const box = new THREE.Box3();
  for (const m of meshes) if (m && m.visible) { m.updateWorldMatrix(true, false); box.expandByObject(m); }
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const dist = r / Math.sin(THREE.MathUtils.degToRad(V.camera.fov / 2)) * 0.95;
  const dir = new THREE.Vector3(1, 0.78, 1.15).normalize();
  V.controls.target.copy(c);
  V.camera.position.copy(c).addScaledVector(dir, dist);
  V.camera.near = Math.max(0.01, dist / 500); V.camera.far = dist * 50; V.camera.updateProjectionMatrix();
  V.controls.update(); V.dirty = true;
}
const allMeshes = () => S.els.map(e => e.mesh).filter(Boolean);
function pick(x, y) {
  if (!V.ok || !S.els.length) return;
  const r = $("#cv").getBoundingClientRect();
  const v = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  V.ray.setFromCamera(v, V.camera);
  const hits = V.ray.intersectObjects(S.els.filter(e => e.mesh && e.mesh.visible).map(e => e.mesh), false);
  const g = hits.length ? hits[0].object.userData.guid : null;
  if (!g) { if (!S.multi) setSel([]); return; }
  if (S.multi) { const n = new Set(S.sel); n.has(g) ? n.delete(g) : n.add(g); setSel([...n]); }
  else setSel(S.sel.size === 1 && S.sel.has(g) ? [] : [g]);
  if (S.tab !== "reg") setTab("reg");
}
const colCache = {};
function col(v) { const k = v + cssv(v); return colCache[k] || (colCache[k] = new THREE.Color(cssv(v) || "#999")); }
const CAT_COL = { "Muros": "#C9A58C", "Losas": "#B9BCBE", "Columnas": "#A9ADB1", "Vigas": "#A9ADB1", "Cimentación": "#9A9D9F", "Ventanas": "#8DB8D3", "Puertas": "#9C7350", "Escaleras": "#B1B4B6", "Pasamanos": "#5D6267", "Cubierta": "#A86C55" };
function paint(el) {
  if (!V.ok || !el.mesh) return;
  const m = el.mesh.material, en = stOf(el.guid), selected = S.sel.has(el.guid);
  let c, op = 1;
  if (selected) c = col("--sel");
  else if (S.colorMode === "estado") { c = col(ST[en.s].v); if (en.s === "ni" && S.dim) op = 0.2; }
  else { if (el.color) { c = new THREE.Color(el.color[0], el.color[1], el.color[2]); op = Math.max(0.25, el.color[3]); } else c = new THREE.Color(CAT_COL[el.cat] || "#B4B8BB"); }
  m.color.copy(c);
  m.emissive.setRGB(selected ? 0.08 : 0, selected ? 0.1 : 0, selected ? 0.25 : 0);
  m.transparent = op < 1; m.opacity = op; m.depthWrite = op >= 0.6; m.needsUpdate = true;
  if (el.edges) el.edges.visible = op >= 0.6 || selected;
  el.mesh.renderOrder = op < 1 ? 2 : 0;
}
function paintAll() { for (const el of S.els) paint(el); applyVisibility(); if (V.ok) V.dirty = true; }
const isVisible = el => !S.hiddenStoreys.has(el.storey) && !S.hiddenCats.has(el.cat) && !S.hiddenStates.has(stOf(el.guid).s);
function applyVisibility() { if (!V.ok) return; for (const el of S.els) if (el.mesh) el.mesh.visible = isVisible(el); V.dirty = true; }

// ================= Supabase y R2 =================
async function token() { const { data: { session } } = await sb.auth.getSession(); return session?.access_token || ""; }
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const urlCache = {};
async function fotoURL(key) {
  if (urlCache[key]) return urlCache[key];
  const r = await fetch(`/api/fotos?obra=${encodeURIComponent(obraId)}&key=${encodeURIComponent(key)}`, { headers: { Authorization: "Bearer " + await token() } });
  if (!r.ok) throw new Error("foto");
  return (urlCache[key] = URL.createObjectURL(await r.blob()));
}
async function pintarFotos() {
  for (const img of document.querySelectorAll("img[data-key]")) {
    if (img.src) continue;
    fotoURL(img.dataset.key).then(u => { img.src = u; }).catch(() => {});
  }
}
async function decodificar(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) {}
  return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
}
async function comprimir(file) {
  const img = await decodificar(file);
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  const k = Math.min(1, 1400 / Math.max(w0, h0)), w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
  return { blob: await new Promise(r => c.toBlob(r, "image/jpeg", 0.78)), w, h };
}
let subiendo = 0;
async function subirFotos(files) {
  for (const file of files) {
    if (S.form.fotos.length >= MAX_FOTOS) { toast("Máximo " + MAX_FOTOS + " fotos por registro."); break; }
    subiendo++; renderPane();
    try {
      const { blob, w, h } = await comprimir(file);
      const r = await fetch(`/api/fotos?obra=${encodeURIComponent(obraId)}`, { method: "POST", body: blob, headers: { "Content-Type": "image/jpeg", Authorization: "Bearer " + await token() } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "error del servidor");
      urlCache[j.key] = URL.createObjectURL(blob);
      S.form.fotos.push({ key: j.key, w, h });
    } catch (err) { toast("No se pudo subir la foto: " + err.message); }
    finally { subiendo--; renderPane(); }
  }
}

// ================= carga de obra y modelo =================
function setLoading(on, title, frac, stage) {
  $("#loading").hidden = !on;
  if (title) $("#loadT").textContent = title;
  if (frac != null) $("#loadBar").style.width = Math.round(frac * 100) + "%";
  if (stage != null) $("#loadS").textContent = stage;
}
function showMsg(html) { const m = $("#msg"); m.innerHTML = html ? `<div class="box">${html}</div>` : ""; m.hidden = !html; }
function triangulate(o, holes) {
  if (!V.ok) return [];
  return THREE.ShapeUtils.triangulateShape(o.map(p => new THREE.Vector2(p[0], p[1])), holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1]))));
}
function resetModel() {
  clearScene();
  S.model = null; S.modelo = null; S.text = null; S.local = false; S.fileName = "";
  S.els = []; S.byGuid = new Map(); S.sel = new Set(); S.history = new Map();
  S.hiddenStoreys = new Set(); S.hiddenCats = new Set(); S.hiddenStates = new Set();
  $("#tools").hidden = true;
}
async function openText(text, opts) {
  setLoading(true, opts.title || "Abriendo modelo", 0, "Leyendo archivo");
  let model;
  try { model = await IfcReader.load(text, { triangulate, onProgress: (s, f) => setLoading(true, null, f, s) }); }
  catch (err) { setLoading(false); toast("No se pudo leer el archivo: " + (err.message || err)); return false; }
  if (!model.elements.length) { setLoading(false); toast("El archivo no tiene elementos con geometría que se puedan mostrar."); return false; }
  resetModel();
  S.model = model; S.modelo = opts.modelo || null; S.local = !!opts.local; S.fileName = opts.fileName || "";
  S.text = opts.local ? text : null;
  S.els = model.elements; S.byGuid = new Map(S.els.map(e => [e.guid, e]));
  S.storeyName = new Map(model.storeys.map(s => [s.id, s]));
  buildScene(model);
  setLoading(false); showMsg(""); $("#tools").hidden = false;
  paintAll(); fitView(allMeshes());
  renderAll();
  return true;
}
async function readFile(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return new TextDecoder("iso-8859-1").decode(buf); }
}
async function cargarObra() {
  resetModel(); S.prog = new Map(); S.regs = []; renderAll();
  if (!obraId) { showMsg(`<h2>Sin obras asignadas</h2><span>Pide al gerente de proyecto que te agregue a una obra.</span>`); return; }
  ls.set("dlv-obra", obraId);
  const oid = obraId;
  showMsg(""); setLoading(true, "Buscando el modelo de la obra", 0.02, "");
  try {
    const [{ data: mods, error: em }] = await Promise.all([
      sb.from("modelos").select("*").eq("obra_id", oid).order("creado", { ascending: false }).limit(1),
      cargarAvance(oid)
    ]);
    if (oid !== obraId) return;
    if (em) throw em;
    const modelo = (mods || [])[0];
    if (!modelo) {
      setLoading(false);
      showMsg(`<h2>Esta obra aún no tiene modelo</h2><span>Sube el IFC exportado desde ArchiCAD (Archivo › Guardar como › IFC). Lo verá todo el equipo de la obra.</span><button class="btn hivis" type="button" id="msgOpen">Subir IFC de la obra</button>`);
      $("#msgOpen").onclick = () => $("#fileIn").click();
      renderAll(); return;
    }
    setLoading(true, "Descargando " + (modelo.nombre || "modelo"), 0.05, "Descargando modelo");
    const r = await fetch(`/api/modelos?obra=${encodeURIComponent(oid)}&key=${encodeURIComponent(modelo.storage_key)}`, { headers: { Authorization: "Bearer " + await token() } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "HTTP " + r.status);
    let text;
    if (modelo.comprimido) {
      if (typeof DecompressionStream === "undefined") throw new Error("Este navegador no puede abrir modelos comprimidos. Actualiza iOS o usa otro navegador.");
      text = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
    } else text = await r.text();
    if (oid !== obraId) return;
    await openText(text, { modelo, fileName: modelo.archivo, title: "Abriendo " + (modelo.nombre || "modelo") });
  } catch (err) {
    setLoading(false);
    showMsg(`<h2>No se pudo abrir el modelo</h2><span>${esc(err.message || "Revisa tu conexión.")}</span><button class="btn" type="button" id="msgRetry">Reintentar</button>`);
    $("#msgRetry").onclick = cargarObra;
  }
}
async function cargarAvance(oid) {
  const [els, regs] = await Promise.all([
    fetchAll(() => sb.from("avance_elementos").select("guid,estado,pct,fecha,nota,autor,actualizado").eq("obra_id", oid)),
    sb.from("avance_registros").select("*").eq("obra_id", oid).order("creado", { ascending: false }).limit(60)
  ]);
  if (oid !== obraId) return;
  S.prog = new Map(els.map(e => [e.guid, { s: e.estado, p: Number(e.pct), f: e.fecha, n: e.nota || "", autor: e.autor || "" }]));
  S.regs = regs.data || [];
  paintAll(); renderLegend(); renderPane();
}
$("#openBtn").addEventListener("click", () => $("#fileIn").click());
$("#fileIn").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  if (!/\.ifc$/i.test(f.name)) { toast("Elige un archivo .ifc exportado desde ArchiCAD u otro programa BIM."); return; }
  const text = await readFile(f);
  const ok = await openText(text, { local: true, fileName: f.name, title: "Abriendo " + f.name });
  if (ok) { setTab("reg"); toast("Revisa el modelo y guárdalo para la obra desde el panel."); }
});
async function guardarModelo() {
  if (!S.text || !obraId) return;
  const btn = $("#saveModel"); if (btn) { btn.disabled = true; btn.textContent = "Subiendo…"; }
  try {
    let body = new Blob([S.text], { type: "text/plain" }), tipo = "text/plain", comprimido = false;
    if (typeof CompressionStream !== "undefined") {
      body = await new Response(body.stream().pipeThrough(new CompressionStream("gzip"))).blob();
      tipo = "application/gzip"; comprimido = true;
    }
    if (body.size > 95 * 1024 * 1024) throw new Error("El modelo pesa más de 95 MB. Expórtalo sin mobiliario o por partes.");
    const r = await fetch(`/api/modelos?obra=${encodeURIComponent(obraId)}`, { method: "POST", body, headers: { "Content-Type": tipo, Authorization: "Bearer " + await token() } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "error del servidor");
    const { data, error } = await sb.from("modelos").insert({
      obra_id: obraId, nombre: S.model.project.name || S.fileName, archivo: S.fileName, storage_key: j.key, tamano: j.size,
      comprimido, elementos: S.els.length, proyecto_guid: S.model.project.guid || null
    }).select().single();
    if (error) throw error;
    S.modelo = data; S.local = false; S.text = null;
    toast("Modelo guardado. El equipo de la obra ya lo ve."); renderAll();
  } catch (err) {
    toast("No se pudo guardar el modelo: " + (err.message || "revisa tu conexión"));
    if (btn) { btn.disabled = false; btn.textContent = "Guardar como modelo de la obra"; }
  }
}

// ================= registro de avance =================
function summaryOf(guids) {
  const c = {}; for (const g of guids) { const el = S.byGuid.get(g); if (el) c[el.cat] = (c[el.cat] || 0) + 1; }
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => v + " " + k).join(", ");
}
function nivelesOf(guids) {
  const n = new Map();
  for (const g of guids) { const el = S.byGuid.get(g); const s = el && S.storeyName.get(el.storey); if (s) n.set(s.id, s); }
  return [...n.values()].sort((a, b) => a.elev - b.elev).map(s => s.name).join(", ");
}
let saving = false;
async function registrar() {
  if (saving || !S.sel.size || !obraId) return;
  if (S.local) { toast("Primero guarda el modelo para la obra."); return; }
  const guids = [...S.sel], f = S.form;
  const estado = f.s, pct = estado === "ok" ? 100 : estado === "ni" ? 0 : Number(f.p) || 0;
  const fecha = f.f || hoy(), nota = (f.n || "").trim(), autor = autorNombre();
  const vol = guids.reduce((s, g) => s + ((S.byGuid.get(g) || {}).vol || 0), 0);
  saving = true; renderPane();
  try {
    const { data: reg, error } = await sb.from("avance_registros").insert({
      obra_id: obraId, fecha, estado, pct, nota: nota || null, guids, total: guids.length,
      resumen: summaryOf(guids), niveles: nivelesOf(guids), volumen: Math.round(vol * 1000) / 1000,
      fotos: f.fotos.map(x => ({ key: x.key, w: x.w, h: x.h })), autor
    }).select().single();
    if (error) throw error;
    const now = new Date().toISOString();
    for (let i = 0; i < guids.length; i += 500) {
      const rows = guids.slice(i, i + 500).map(g => ({ obra_id: obraId, guid: g, estado, pct, fecha, nota: nota || null, autor, registro_id: reg.id, actualizado: now }));
      const { error: e2 } = await sb.from("avance_elementos").upsert(rows, { onConflict: "obra_id,guid" });
      if (e2) throw e2;
    }
    for (const g of guids) S.prog.set(g, { s: estado, p: pct, f: fecha, n: nota, autor });
    S.regs.unshift(reg); S.history = new Map();
    S.form.n = ""; S.form.fotos = [];
    setSel([]); paintAll(); renderLegend();
    toast("Avance registrado en " + guids.length + (guids.length === 1 ? " elemento" : " elementos"));
  } catch (err) {
    toast("No se pudo guardar: " + (err.message || "revisa tu conexión"));
  } finally { saving = false; renderPane(); }
}

// ================= selección =================
function setSel(guids) {
  const before = S.sel; S.sel = new Set(guids);
  for (const g of before) if (!S.sel.has(g)) { const el = S.byGuid.get(g); if (el) paint(el); }
  for (const g of S.sel) { const el = S.byGuid.get(g); if (el) paint(el); }
  if (V.ok) V.dirty = true;
  if (S.sel.size === 1) { const en = S.prog.get([...S.sel][0]); if (en) { S.form.s = en.s; S.form.p = en.p || 50; } }
  renderSelCount(); renderPane();
}
function renderSelCount() {
  const el = $("#selCount");
  if (S.sel.size > 1 || (S.multi && S.sel.size)) { el.hidden = false; el.innerHTML = `${S.sel.size} seleccionados <button type="button" id="selClear">Quitar</button>`; $("#selClear").onclick = () => setSel([]); }
  else el.hidden = true;
}
$("#tHome").onclick = () => fitView(allMeshes());
$("#tFocus").onclick = () => { const ms = [...S.sel].map(g => S.byGuid.get(g)).filter(e => e && e.mesh).map(e => e.mesh); fitView(ms.length ? ms : allMeshes()); };
$("#tMulti").onclick = () => { S.multi = !S.multi; $("#tMulti").setAttribute("aria-pressed", S.multi); toast(S.multi ? "Selección múltiple: toca varios elementos" : "Selección simple"); renderSelCount(); };
$("#tDim").onclick = () => { S.dim = !S.dim; $("#tDim").setAttribute("aria-pressed", S.dim); ls.set("avance.dim", S.dim ? "1" : "0"); paintAll(); };
$("#grip").onclick = () => { $("#panel").classList.toggle("compact"); setTimeout(resize, 220); };

// ================= cálculo de avance =================
function stats(els) {
  const r = { n: els.length, vol: 0, wPct: 0, cPct: 0, by: { ni: { n: 0, v: 0 }, ej: { n: 0, v: 0 }, ok: { n: 0, v: 0 }, ob: { n: 0, v: 0 } } };
  for (const el of els) {
    const en = stOf(el.guid), p = pctOf(en), v = el.vol || 0;
    r.vol += v; r.wPct += v * p; r.cPct += p; r.by[en.s].n++; r.by[en.s].v += v;
  }
  r.pctVol = r.vol > 0 ? r.wPct / r.vol : (r.n ? r.cPct / r.n : 0);
  r.pctCnt = r.n ? r.cPct / r.n : 0;
  r.pct = S.weight === "vol" ? r.pctVol : r.pctCnt;
  return r;
}
function stackBar(st) {
  const useVol = S.weight === "vol" && st.vol > 0, tot = useVol ? st.vol : st.n;
  if (!tot) return `<div class="stack"></div>`;
  return `<div class="stack">${ST_ORDER.map(k => { const v = useVol ? st.by[k].v : st.by[k].n; return v ? `<i style="width:${(v / tot * 100).toFixed(2)}%;background:var(${ST[k].v})"></i>` : ""; }).join("")}</div>`;
}

// ================= render =================
function renderLegend() {
  if (!S.els.length || S.colorMode !== "estado") { $("#legend").innerHTML = ""; return; }
  const st = stats(S.els);
  $("#legend").innerHTML = ST_ORDER.map(k => `<span class="chip"><span class="dot" style="background:var(${ST[k].v})"></span>${ST[k].label} <b class="num">${st.by[k].n}</b></span>`).join("");
}
function setTab(t) {
  S.tab = t;
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
  renderPane(); $("#pane").scrollTop = 0;
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => { if ($("#panel").classList.contains("compact")) { $("#panel").classList.remove("compact"); setTimeout(resize, 220); } setTab(b.dataset.tab); });
function updateBanner() {
  const b = $("#banner");
  const html = S.local ? "<span><b>Modelo sin guardar.</b> Guárdalo para la obra antes de registrar avances.</span>" : "";
  b.innerHTML = html; b.hidden = !html;
}
function renderAll() { renderLegend(); renderSelCount(); updateBanner(); renderPane(); }
function renderPane() {
  const p = $("#pane");
  if (!user) { p.innerHTML = ""; return; }
  if (!S.model) {
    p.innerHTML = S.tab === "log" && S.regs.length ? paneLog() : `<div class="empty"><strong>${obraId ? "Sin modelo abierto" : "Sin obra"}</strong><span>Cuando la obra tenga su modelo IFC, aquí registras el avance de cada elemento con fotos.</span></div>`;
    bindPane(); return;
  }
  p.innerHTML = S.tab === "reg" ? paneReg() : S.tab === "res" ? paneRes() : S.tab === "fil" ? paneFil() : paneLog();
  bindPane(); pintarFotos();
}
function storeyLabel(id) { const s = S.storeyName.get(id); return s ? esc(s.name) + `<span class="lvl">${lvlTxt(s.elev)}</span>` : "Sin nivel"; }
function stPill(en) { const k = en.s; return `<span class="pill"><span class="dot" style="background:var(${ST[k].v})"></span>${ST[k].label}${k === "ej" || k === "ob" ? ` · ${fmt(pctOf(en))} %` : ""}</span>`; }
const thumbs = (fotos, size) => fotos && fotos.length ? `<div class="thumbs">${fotos.map(f => `<button class="thumb" type="button" data-photo="${esc(f.key)}" ${size ? `style="width:${size}px;height:${size}px"` : ""}><img data-key="${esc(f.key)}" alt="Foto de avance"></button>`).join("")}</div>` : "";

function paneReg() {
  let h = "";
  if (S.local) {
    h += `<div class="note-card"><h3>Este modelo aún no está guardado en la obra</h3><p>Guárdalo para que el equipo lo abra aquí y para poder registrar avances.${S.modelo ? "" : ""}</p><div><button class="btn small primary" type="button" id="saveModel">Guardar como modelo de la obra</button></div></div>`;
  }
  if (!S.sel.size) {
    return h + `<div class="empty"><strong>Toca un elemento del modelo</strong>
      <span>Verás sus datos y podrás registrar su avance con fotos. Para marcar varios a la vez, activa la selección múltiple o elige un nivel o categoría en <b>Vista</b>.</span></div>`;
  }
  const els = [...S.sel].map(g => S.byGuid.get(g)).filter(Boolean);
  if (els.length === 1) {
    const el = els[0], en = stOf(el.guid);
    h += `<div style="display:grid;gap:8px"><div class="eyebrow">${esc(el.cat)} · ${storeyLabel(el.storey)}</div>
      <h2>${esc(el.name || el.objType || el.cat)}</h2>
      <div class="row">${stPill(en)}${en.f ? `<span class="eyebrow" style="text-transform:none;letter-spacing:0">${fdate(en.f)}${en.autor ? " · " + esc(en.autor) : ""}</span>` : ""}</div>
      ${en.n ? `<div style="font-size:14px;color:var(--muted)">${esc(en.n)}</div>` : ""}</div>`;
    h += `<dl class="kv">${el.objType || el.typeName ? `<dt>Tipo</dt><dd>${esc(el.typeName || el.objType)}</dd>` : ""}${el.material ? `<dt>Material</dt><dd>${esc(el.material)}</dd>` : ""}
      ${el.vol ? `<dt>Volumen</dt><dd class="num">${fmt(el.vol, 3)} m³${el.volQto ? "" : " <span style='color:var(--muted)'>(calculado)</span>"}</dd>` : ""}
      ${el.tag ? `<dt>ID ArchiCAD</dt><dd class="mono">${esc(el.tag)}</dd>` : ""}<dt>GUID</dt><dd class="mono">${esc(el.guid)}</dd></dl>`;
  } else {
    const st = stats(els);
    h += `<div style="display:grid;gap:8px"><div class="eyebrow">Selección</div><h2>${els.length} elementos</h2>
      <div style="font-size:14px;color:var(--muted)">${esc(summaryOf(els.map(e => e.guid)))}${st.vol ? ` · ${fmt(st.vol, 2)} m³` : ""}</div>${stackBar(st)}</div>`;
  }
  const f = S.form;
  h += `<div class="form"><h3>Registrar avance</h3>
    <div class="seg" role="group" aria-label="Estado">${["ni", "ej", "ok", "ob"].map(k => `<button type="button" data-st="${k}" aria-pressed="${f.s === k}"><span class="dot" style="background:var(${ST[k].v})"></span>${ST[k].label}</button>`).join("")}</div>
    ${f.s === "ej" || f.s === "ob" ? `<div class="field"><label for="fPct">Porcentaje ejecutado</label><div class="range"><input type="range" id="fPct" min="0" max="100" step="5" value="${f.p}"><output id="fPctO">${f.p} %</output></div></div>` : ""}
    <div class="field"><label for="fDate">Fecha (sale en el reporte diario de ese día)</label><input type="date" id="fDate" value="${esc(f.f)}"></div>
    <div class="field"><label for="fNote">Nota ${f.s === "ob" ? "(qué se observó)" : "(opcional)"}</label><textarea id="fNote" placeholder="${f.s === "ob" ? "Ej.: fisura en la losa, revisar con el estructural" : "Ej.: fundido con hormigón premezclado"}">${esc(f.n)}</textarea></div>
    <div class="field"><label>Fotos (${f.fotos.length}/${MAX_FOTOS})</label><div class="thumbs">${f.fotos.map((x, i) => `<span class="thumb"><img data-key="${esc(x.key)}" alt="Foto ${i + 1}"><button class="rm" type="button" data-rmfoto="${i}" aria-label="Quitar foto ${i + 1}">×</button></span>`).join("")}
      ${f.fotos.length < MAX_FOTOS ? `<button class="addph" type="button" id="addFoto" ${subiendo ? "disabled" : ""}>${subiendo ? "Subiendo…" : "+ Foto"}</button>` : ""}</div></div>
    <button class="btn primary" type="button" id="fSave" ${saving || subiendo || S.local ? "disabled" : ""}>${saving ? "Guardando…" : `Registrar en ${els.length === 1 ? "1 elemento" : els.length + " elementos"}`}</button></div>`;
  if (els.length === 1) {
    const g = els[0].guid;
    const hist = S.history.get(g) || S.regs.filter(r => (r.guids || []).includes(g));
    if (hist.length) h += `<div style="display:grid;gap:4px"><h3>Historial con fotos</h3><div class="log">${hist.slice(0, 10).map(logEntry).join("")}</div></div>`;
    if (!S.history.has(g)) loadHistory(g);
    h += `<div id="propsBox"></div>`;
  }
  return h;
}
const histBusy = new Set();
async function loadHistory(g) {
  if (histBusy.has(g) || !obraId) return; histBusy.add(g);
  try {
    const { data, error } = await sb.from("avance_registros").select("*").eq("obra_id", obraId).contains("guids", [g]).order("creado", { ascending: false }).limit(10);
    if (error) throw error;
    S.history.set(g, data || []);
    if (S.sel.has(g) && S.tab === "reg") renderPane();
  } catch (e) { S.history.set(g, []); } finally { histBusy.delete(g); }
}
function renderProps() {
  const box = $("#propsBox"); if (!box || S.sel.size !== 1) return;
  const el = S.byGuid.get([...S.sel][0]); if (!el) return;
  let groups = []; try { groups = S.model.properties(el); } catch (e) {}
  if (!groups.length) return;
  box.innerHTML = `<div style="display:grid;gap:8px"><h3>Propiedades IFC</h3>${groups.map(g => `<details class="props"><summary>${esc(g.name)}</summary><dl class="kv">${g.rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join("")}</dl></details>`).join("")}</div>`;
}
function paneRes() {
  const st = stats(S.els);
  const storeys = [...S.model.storeys].reverse();
  const noLvl = S.els.filter(e => !S.storeyName.has(e.storey));
  const cats = [...new Set(S.els.map(e => e.cat))].map(c => ({ c, els: S.els.filter(e => e.cat === c) })).sort((a, b) => b.els.length - a.els.length);
  const hasVol = st.vol > 0;
  const row = (label, s, attr) => `<button class="prow" type="button" ${attr}><span class="n">${label}</span><span class="p num">${fmt(s.pct, 1)} %</span>${stackBar(s)}<span class="sub">${s.n} ${s.n === 1 ? "elemento" : "elementos"}${hasVol ? " · " + fmt(s.vol, 1) + " m³" : ""}${s.by.ob.n ? ` · <span style="color:var(--st-ob)">${s.by.ob.n} observado${s.by.ob.n > 1 ? "s" : ""}</span>` : ""}</span></button>`;
  return `<div style="display:grid;gap:10px">
    <div class="row"><div class="eyebrow">Avance físico según el modelo</div><span class="spacer"></span>
      ${hasVol ? `<div class="seg2" role="group" aria-label="Ponderar por"><button type="button" data-w="vol" aria-pressed="${S.weight === "vol"}">Por volumen</button><button type="button" data-w="cnt" aria-pressed="${S.weight === "cnt"}">Por elementos</button></div>` : ""}</div>
    <div class="big"><span class="v">${fmt(st.pct, 1)} %</span><span class="l">${st.n} elementos${hasVol ? " · " + fmt(st.vol, 1) + " m³" : ""}</span></div>
    ${stackBar(st)}
    <div class="row" style="gap:6px 14px;font-size:13px">${ST_ORDER.map(k => `<span class="row" style="gap:6px"><span class="dot" style="background:var(${ST[k].v})"></span>${ST[k].label} <b class="num">${st.by[k].n}</b></span>`).join("")}</div>
  </div>
  <div><h3 style="margin-bottom:4px">Por nivel</h3>${storeys.map(s => { const e = S.els.filter(x => x.storey === s.id); return e.length ? row(`${esc(s.name)}<span class="lvl">${lvlTxt(s.elev)}</span>`, stats(e), `data-iso-storey="${s.id}"`) : ""; }).join("")}${noLvl.length ? row("Sin nivel", stats(noLvl), "") : ""}</div>
  <div><h3 style="margin-bottom:4px">Por categoría</h3>${cats.map(c => row(esc(c.c), stats(c.els), `data-iso-cat="${esc(c.c)}"`)).join("")}</div>
  <p style="margin:0;font-size:12.5px;color:var(--muted)">${hasVol ? "Por volumen pesa cada elemento según sus m³ (del IFC o calculados del modelo). " : ""}Toca un nivel o categoría para verlo solo en el visor.</p>`;
}
function paneFil() {
  const cats = [...new Set(S.els.map(e => e.cat))].sort((a, b) => a.localeCompare(b, "es"));
  const cnt = f => S.els.filter(f).length;
  const storeys = [...S.model.storeys].reverse().filter(s => S.els.some(e => e.storey === s.id));
  const visN = S.els.filter(isVisible).length;
  const m = S.modelo;
  return `<div style="display:grid;gap:10px">
    <div class="row"><h3>Colorear por</h3><span class="spacer"></span><div class="seg2" role="group"><button type="button" data-cm="estado" aria-pressed="${S.colorMode === "estado"}">Estado</button><button type="button" data-cm="modelo" aria-pressed="${S.colorMode === "modelo"}">Materiales</button></div></div>
    <div class="row"><span style="font-size:14px;color:var(--muted)">${visN} de ${S.els.length} elementos visibles</span><span class="spacer"></span>
      <button class="btn small" type="button" id="selVisible">Seleccionar visibles</button><button class="btn small ghost" type="button" id="showAll">Mostrar todo</button></div>
  </div>
  <div><div class="eyebrow" style="margin-bottom:4px">Niveles</div><div class="toggle-list">${storeys.map(s => `<div class="tl"><input type="checkbox" id="sv${s.id}" data-sv="${s.id}" ${S.hiddenStoreys.has(s.id) ? "" : "checked"}><label for="sv${s.id}">${esc(s.name)}<span class="lvl">${lvlTxt(s.elev)}</span><span class="c">${cnt(e => e.storey === s.id)}</span></label><button class="btn small ghost" type="button" data-only-storey="${s.id}">Solo este</button></div>`).join("")}</div></div>
  <div><div class="eyebrow" style="margin-bottom:4px">Estado</div><div class="toggle-list">${ST_ORDER.map(k => `<div class="tl"><input type="checkbox" id="ss${k}" data-ss="${k}" ${S.hiddenStates.has(k) ? "" : "checked"}><label for="ss${k}"><span class="dot" style="background:var(${ST[k].v});align-self:center"></span>${ST[k].label}<span class="c">${cnt(e => stOf(e.guid).s === k)}</span></label></div>`).join("")}</div></div>
  <div><div class="eyebrow" style="margin-bottom:4px">Categorías</div><div class="toggle-list">${cats.map((c, i) => `<div class="tl"><input type="checkbox" id="sc${i}" data-sc="${esc(c)}" ${S.hiddenCats.has(c) ? "" : "checked"}><label for="sc${i}">${esc(c)}<span class="c">${cnt(e => e.cat === c)}</span></label><button class="btn small ghost" type="button" data-only-cat="${esc(c)}">Solo esta</button></div>`).join("")}</div></div>
  <div class="note-card"><h3>Modelo</h3><p>${esc((m && m.nombre) || S.model.project.name)} · ${esc(S.fileName || "")}${m ? " · subido " + fdate(m.creado) : ""}<br>${esc(S.model.schema)}${S.model.app ? " · " + esc(S.model.app) : ""} · ${fmt(S.model.entityCount)} entidades</p>
    <div><button class="btn small" type="button" id="newModel">Subir nueva versión del IFC</button></div>
    <p style="font-size:12.5px">Los avances se guardan por GUID, así que una nueva exportación del mismo proyecto de ArchiCAD conserva lo registrado.</p></div>`;
}
function logEntry(r) {
  const en = { s: r.estado, p: r.pct };
  return `<div class="entry" data-reg="${esc(r.id)}" role="button" tabindex="0"><span class="d">${fdate(r.fecha)}</span><span class="m row" style="gap:6px">${stPill(en)}<span style="font-size:13.5px">${esc(r.resumen || r.total + " elementos")}</span></span>
    <span class="note">${r.niveles ? esc(r.niveles) + " · " : ""}${esc(r.nota || "")}${r.nota && r.autor ? " · " : ""}${esc(r.autor || "")}</span>${thumbs(r.fotos, 56)}</div>`;
}
function paneLog() {
  if (!S.regs.length) return `<div class="empty"><strong>Sin registros todavía</strong><span>Cada avance registrado aparece aquí con fecha, estado, nota y fotos. El reporte diario de ese día los puede traer con un toque.</span></div>`;
  return `<div class="log">${S.regs.map(logEntry).join("")}</div>`;
}
function bindPane() {
  const q = s => $("#pane").querySelectorAll(s);
  q("[data-st]").forEach(b => b.onclick = () => { S.form.s = b.dataset.st; if ((S.form.s === "ej" || S.form.s === "ob") && !S.form.p) S.form.p = 50; renderPane(); });
  const pct = $("#fPct"); if (pct) pct.oninput = () => { S.form.p = Number(pct.value); $("#fPctO").textContent = pct.value + " %"; };
  const fd = $("#fDate"); if (fd) fd.onchange = () => S.form.f = fd.value;
  const fn = $("#fNote"); if (fn) fn.oninput = () => S.form.n = fn.value;
  const sv = $("#fSave"); if (sv) sv.onclick = () => { if (S.form.s === "ob" && !S.form.n.trim()) { toast("Escribe qué se observó."); $("#fNote").focus(); return; } registrar(); };
  const af = $("#addFoto"); if (af) af.onclick = () => $("#fotoIn").click();
  q("[data-rmfoto]").forEach(b => b.onclick = () => { S.form.fotos.splice(Number(b.dataset.rmfoto), 1); renderPane(); });
  const sm = $("#saveModel"); if (sm) sm.onclick = guardarModelo;
  const nm = $("#newModel"); if (nm) nm.onclick = () => $("#fileIn").click();
  q("[data-w]").forEach(b => b.onclick = () => { S.weight = b.dataset.w; renderPane(); });
  q("[data-cm]").forEach(b => b.onclick = () => { S.colorMode = b.dataset.cm; paintAll(); renderLegend(); renderPane(); });
  q("[data-sv]").forEach(i => i.onchange = () => { const id = Number(i.dataset.sv); i.checked ? S.hiddenStoreys.delete(id) : S.hiddenStoreys.add(id); applyVisibility(); renderPane(); });
  q("[data-ss]").forEach(i => i.onchange = () => { i.checked ? S.hiddenStates.delete(i.dataset.ss) : S.hiddenStates.add(i.dataset.ss); applyVisibility(); renderPane(); });
  q("[data-sc]").forEach(i => i.onchange = () => { const c = i.dataset.sc; i.checked ? S.hiddenCats.delete(c) : S.hiddenCats.add(c); applyVisibility(); renderPane(); });
  const onlyStorey = id => { S.hiddenStoreys = new Set(S.model.storeys.map(s => s.id).filter(x => x !== id)); S.hiddenStoreys.add(0); applyVisibility(); fitView(S.els.filter(isVisible).map(e => e.mesh)); renderPane(); };
  const onlyCat = c => { S.hiddenCats = new Set(S.els.map(e => e.cat).filter(x => x !== c)); applyVisibility(); fitView(S.els.filter(isVisible).map(e => e.mesh)); renderPane(); };
  q("[data-only-storey]").forEach(b => b.onclick = () => onlyStorey(Number(b.dataset.onlyStorey)));
  q("[data-only-cat]").forEach(b => b.onclick = () => onlyCat(b.dataset.onlyCat));
  q("[data-iso-storey]").forEach(b => b.onclick = () => { onlyStorey(Number(b.dataset.isoStorey)); toast("Mostrando solo ese nivel. «Mostrar todo» en Vista lo restablece."); });
  q("[data-iso-cat]").forEach(b => b.onclick = () => { onlyCat(b.dataset.isoCat); toast("Mostrando solo esa categoría. «Mostrar todo» en Vista lo restablece."); });
  const all = $("#showAll"); if (all) all.onclick = () => { S.hiddenStoreys = new Set(); S.hiddenCats = new Set(); S.hiddenStates = new Set(); applyVisibility(); fitView(allMeshes()); renderPane(); };
  const sv2 = $("#selVisible"); if (sv2) sv2.onclick = () => { setSel(S.els.filter(isVisible).map(e => e.guid)); setTab("reg"); };
  renderProps();
}
// clics delegados: fotos (ampliar) y registros de bitácora (ir a los elementos)
$("#pane").addEventListener("click", e => {
  const ph = e.target.closest("[data-photo]");
  if (ph) { e.stopPropagation(); return verFoto(ph.dataset.photo); }
  const en = e.target.closest("[data-reg]");
  if (!en || !S.model) return;
  const r = S.regs.find(x => x.id === en.dataset.reg) || [...S.history.values()].flat().find(x => x.id === en.dataset.reg);
  if (!r) return;
  const gs = (r.guids || []).filter(g => S.byGuid.has(g));
  if (!gs.length) { toast("Esos elementos ya no están en este modelo."); return; }
  S.hiddenStoreys = new Set(); S.hiddenCats = new Set(); S.hiddenStates = new Set(); applyVisibility();
  setSel(gs); fitView(gs.map(g => S.byGuid.get(g).mesh)); setTab("reg");
});
async function verFoto(key) {
  const root = $("#sheetRoot");
  root.innerHTML = `<div class="lightbox" id="lb"><img alt="Foto de avance"><button type="button" id="lbClose">Cerrar</button></div>`;
  $("#lb").onclick = () => root.innerHTML = "";
  try { $("#lb img").src = await fotoURL(key); } catch (e) { root.innerHTML = ""; toast("No se pudo abrir la foto."); }
}
$("#fotoIn").addEventListener("change", e => { const files = [...e.target.files]; e.target.value = ""; if (files.length) subirFotos(files); });

// ================= arranque =================
function renderObras() {
  const s = $("#obraSel");
  s.innerHTML = obras.length ? obras.map(o => `<option value="${esc(o.id)}"${o.id === obraId ? " selected" : ""}>${esc(o.nombre)}</option>`).join("") : `<option value="">Sin obras asignadas</option>`;
}
$("#obraSel").addEventListener("change", e => { obraId = e.target.value; S.form.fotos = []; cargarObra(); });
async function boot() {
  if (ls.get("avance.dim") === "0") { S.dim = false; $("#tDim").setAttribute("aria-pressed", "false"); }
  initViewer();
  if (!V.ok) toast("No se pudo cargar el motor 3D. Revisa la conexión y recarga.");
  try {
    const cfg = await (await fetch("/api/config")).json();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("config");
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch (_) { showMsg(`<h2>Falta configurar la app</h2><span>Revisa las variables de Supabase en Cloudflare Pages.</span>`); return; }
  const { data: { session } } = await sb.auth.getSession();
  user = session ? session.user : null;
  if (!user) { showMsg(`<h2>Inicia sesión</h2><span>Entra con tu correo en la app de reportes y vuelve al visor.</span><a class="btn primary" href="/">Ir a iniciar sesión</a>`); return; }
  const { data: pf } = await sb.from("perfiles").select("*").eq("id", user.id).maybeSingle();
  perfil = pf || { rol: "residente" };
  $("#openBtn").hidden = false;
  const { data, error } = await sb.from("obras").select("id,nombre").eq("activa", true).order("nombre");
  if (error) { showMsg(`<h2>No se pudieron cargar las obras</h2><span>Revisa tu conexión y recarga.</span>`); return; }
  obras = data || [];
  const want = new URLSearchParams(location.search).get("obra") || ls.get("dlv-obra") || "";
  obraId = (obras.find(o => o.id === want) || obras[0] || {}).id || "";
  renderObras();
  await cargarObra();
}
boot();
})();
