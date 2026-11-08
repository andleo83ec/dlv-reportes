// Worker de WhatsApp con Supabase, Meta, R2 y Claude simulados.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { beforeEach, test } from "node:test";
import worker from "../src/index.js";
import { notificar, procesarMensaje, verificarFirma } from "../src/whatsapp/whatsapp.js";

let T, enviados, claudeLlamadas;
const OB = { turi: "ob-turi", riv: "ob-riv" };
function reset() {
  T = {
    obras: [{ id: OB.turi, nombre: "Edificio Turi", alias: [], activa: true }, { id: OB.riv, nombre: "Edificio Rivoria", alias: [], activa: true }],
    proveedores: [{ ruc: "0190123456001", razon_social: "Ferretería El Constructor" }],
    whatsapp_usuarios: [
      { telefono: "593991112233", nombre: "Carlos Merchán", rol: "residente", obra_id: OB.turi, activo: true },
      { telefono: "593995556677", nombre: "Pedro Bodega", rol: "bodega", obra_id: null, activo: true },
    ],
    whatsapp_mensajes: [], compras_requerimientos: [], compras_req_items: [], compras_ordenes: [], compras_orden_items: [],
    compras_entregas: [], compras_entrega_items: [],
  };
  enviados = []; claudeLlamadas = 0;
}
beforeEach(reset);

let seq = 0;
function cumple(r, k, v) {
  const [op, ...rest] = v.split("."); const val = rest.join(".");
  const lista = (s) => s.replace(/^\(|\)$/g, "").split(",");
  if (op === "eq") return String(r[k]) === val;
  if (op === "neq") return String(r[k]) !== val;
  if (op === "in") return lista(val).includes(String(r[k]));
  if (op === "not" && rest[0] === "in") return !lista(rest.slice(1).join(".")).includes(String(r[k]));
  if (op === "gte") return String(r[k]) >= val;
  return true;
}
const PREF = { compras_entregas: "GE", compras_ordenes: "OC" };
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.host === "graph.facebook.com") {
    if (url.pathname.endsWith("/messages")) {
      const b = JSON.parse(init.body); enviados.push(b);
      return b.to === "593990000000" ? Response.json({ error: { code: 131047, message: "Re-engagement" } }, { status: 400 }) : Response.json({ messages: [{ id: "out" }] });
    }
    if (url.pathname.endsWith("/MEDIA1")) return Response.json({ url: "https://lookaside.fbsbx.com/x", mime_type: "image/jpeg", file_size: 10 });
  }
  if (url.host === "lookaside.fbsbx.com") return new Response(new Uint8Array([1, 2, 3]));
  if (url.host === "api.anthropic.com") {
    claudeLlamadas++;
    return Response.json({ content: [{ type: "text", text: '{"obra":"Edificio Turi","items":[{"cantidad":15,"unidad":"saco","descripcion":"Cemento"},{"cantidad":2,"unidad":"m³","descripcion":"Arena"}],"urgente":false,"notas":null}' }] });
  }
  if (url.pathname === "/auth/v1/user") return init.headers.Authorization === "Bearer buen-token" ? Response.json({ email: "a@dlv.ec" }) : new Response("no", { status: 401 });
  const tabla = url.pathname.split("/").pop();
  const t = (T[tabla] ??= []);
  const filtros = [...url.searchParams].filter(([k]) => !["select", "order", "limit", "on_conflict"].includes(k));
  const filtrar = () => t.filter((r) => filtros.every(([k, v]) => cumple(r, k, v)));
  const m = init.method || "GET";
  if (m === "GET") { let out = filtrar(); const lim = url.searchParams.get("limit"); if (url.searchParams.get("order")?.endsWith(".desc")) out = out.slice().reverse(); return Response.json(lim ? out.slice(0, +lim) : out); }
  if (m === "POST") {
    const conf = url.searchParams.get("on_conflict"); const out = [];
    for (const row of JSON.parse(init.body)) {
      if (conf && t.some((x) => x[conf] === row[conf] && row[conf] != null)) continue;
      const n = { id: "id" + ++seq, created_at: new Date().toISOString(), ...row };
      if (tabla === "compras_requerimientos") n.numero = `${row.tipo === "directo" ? "PD" : "SC"}-2026-${String(t.filter((x) => x.tipo === row.tipo).length + 1).padStart(4, "0")}`;
      if (PREF[tabla] && !n.numero) n.numero = `${PREF[tabla]}-2026-${String(t.length + 1).padStart(4, "0")}`;
      t.push(n); out.push(n);
    }
    return Response.json(out);
  }
  if (m === "PATCH") { filtrar().forEach((r) => Object.assign(r, JSON.parse(init.body))); return new Response(""); }
  return new Response("?", { status: 400 });
};

const r2 = new Map();
const env = {
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123",
  WHATSAPP_APP_SECRET: "secreto", WHATSAPP_VERIFY_TOKEN: "verifica", APP_URL: "https://app/",
  BUCKET: { put: async (k, v) => r2.set(k, v), get: async (k) => (r2.has(k) ? { body: "x", httpMetadata: { contentType: "image/jpeg" } } : null) },
};
const txt = (id, from, body) => ({ id, from, type: "text", text: { body } });
const ultimo = () => enviados.at(-1)?.text.body ?? "";

test("pedido de texto crea PD con ítems y responde resumen", async () => {
  const r = await procesarMensaje(env, txt("w1", "593991112233", "Pedido Turi\n20 sacos cemento\n10 varillas 12mm\nUrgente"), "Carlos");
  assert.equal(r, "pedido");
  const req = T.compras_requerimientos[0];
  assert.equal(req.numero, "PD-2026-0001");
  assert.deepEqual([req.tipo, req.origen, req.etapa, req.obra_id, req.urgente], ["directo", "whatsapp", "pedido", OB.turi, true]);
  assert.equal(T.compras_req_items.length, 2);
  assert.match(ultimo(), /✅ Pedido PD-2026-0001 · Edificio Turi · URGENTE\n1\) 20 saco · Cemento/);
  assert.equal(T.whatsapp_mensajes.find((m) => m.wa_id === "w1").resultado, "pedido_creado");
});

test("mensajes seguidos se juntan en el mismo pedido; duplicados se ignoran", async () => {
  await procesarMensaje(env, txt("w1", "593991112233", "20 sacos cemento"));
  await procesarMensaje(env, txt("w2", "593991112233", "2 m3 arena"));
  assert.equal(await procesarMensaje(env, txt("w2", "593991112233", "2 m3 arena")), "duplicado");
  assert.equal(T.compras_requerimientos.length, 1);
  assert.deepEqual(T.compras_req_items.map((i) => i.linea), [1, 2]);
  assert.match(ultimo(), /Agregué al pedido PD-2026-0001/);
});

test("número no registrado: aviso una sola vez", async () => {
  await procesarMensaje(env, txt("w1", "593998887766", "10 sacos cemento"));
  await procesarMensaje(env, txt("w2", "593998887766", "hola?"));
  assert.equal(enviados.length, 1);
  assert.equal(T.compras_requerimientos.length, 0);
});

test("usuario sin obra por defecto: pregunta la obra", async () => {
  await procesarMensaje(env, txt("w1", "593995556677", "10 sacos cemento"));
  assert.match(ultimo(), /¿Para qué obra/);
  assert.equal(T.compras_requerimientos.length, 0);
});

test("foto de lista sin texto: se guarda en R2 y se lee con Claude si hay clave", async () => {
  await procesarMensaje({ ...env, ANTHROPIC_API_KEY: "sk" }, { id: "w9", from: "593991112233", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } });
  assert.equal(claudeLlamadas, 1);
  assert.ok([...r2.keys()].some((k) => k.startsWith("whatsapp/593991112233/") && k.endsWith("w9.jpg")));
  assert.equal(T.compras_req_items.length, 2);
  assert.match(ultimo(), /Leído de tu foto/);
});

test("foto sin Claude: pedido por transcribir", async () => {
  await procesarMensaje(env, { id: "w9", from: "593991112233", type: "image", image: { id: "MEDIA1" } });
  assert.equal(T.compras_requerimientos[0].titulo, "Pedido por WhatsApp (por transcribir)");
  assert.match(ultimo(), /Compras transcribirá/);
});

test("recibido OC completa: crea guía de entrega, marca recibida y pasa a factura", async () => {
  T.compras_requerimientos.push({ id: "rq1", numero: "PD-2026-0001", etapa: "entrega", solicitado_tel: "593991112233" });
  T.compras_ordenes.push({ id: "oc1", numero: "OC-2026-0023", requerimiento_id: "rq1", obra_id: OB.turi, estado: "parcial" });
  T.compras_orden_items.push({ id: "oi1", orden_id: "oc1", linea: 1, descripcion: "Cemento", unidad: "saco", cantidad: 20 });
  T.compras_entregas.push({ id: "ge0", orden_id: "oc1", numero: "GE-2026-0001" });
  T.compras_entrega_items.push({ entrega_id: "ge0", orden_item_id: "oi1", cantidad_recibida: 5 });
  await procesarMensaje(env, { id: "w5", from: "593991112233", type: "image", image: { id: "MEDIA1", caption: "Recibido OC-2026-0023 guía 001-001-123" } });
  const ge = T.compras_entregas.at(-1);
  assert.deepEqual([ge.guia_remision, ge.origen, ge.recibido_por, !!ge.foto_key], ["001-001-000000123", "whatsapp", "Carlos Merchán", true]);
  assert.equal(T.compras_entrega_items.at(-1).cantidad_recibida, 15);
  assert.equal(T.compras_ordenes[0].estado, "recibida");
  assert.equal(T.compras_requerimientos[0].etapa, "factura");
  assert.match(ultimo(), /✅ Recepción GE-2026-0002/);
});

test("recibido parcial: no registra cantidades, manda a la app", async () => {
  T.compras_ordenes.push({ id: "oc1", numero: "OC-2026-0023", requerimiento_id: "rq1", obra_id: OB.turi, estado: "emitida" });
  await procesarMensaje(env, txt("w5", "593991112233", "llegó la OC-2026-0023 pero faltan 5 sacos"));
  assert.equal(T.compras_entregas.length, 0);
  assert.match(ultimo(), /https:\/\/app\/#p-rq1/);
});

test("residente no puede recibir órdenes de otra obra", async () => {
  T.compras_ordenes.push({ id: "oc2", numero: "OC-2026-0030", requerimiento_id: "rq2", obra_id: OB.riv, estado: "emitida" });
  await procesarMensaje(env, txt("w6", "593991112233", "recibido OC-2026-0030"));
  assert.match(ultimo(), /No encuentro la orden/);
});

test("estado y anular", async () => {
  await procesarMensaje(env, txt("w1", "593991112233", "Pedido Turi\n5 sacos cemento"));
  await procesarMensaje(env, txt("w2", "593991112233", "estado"));
  assert.match(ultimo(), /PD-2026-0001: por aprobar/);
  await procesarMensaje(env, txt("w3", "593991112233", "anular PD-2026-0001"));
  assert.equal(T.compras_requerimientos[0].etapa, "rechazado");
});

test("aviso de aprobación y fuera de la ventana de 24 h", async () => {
  T.compras_requerimientos.push({ id: "rq1", numero: "PD-2026-0001", solicitado_tel: "593991112233" }, { id: "rq2", numero: "PD-2026-0002", solicitado_tel: "593990000000" });
  T.compras_ordenes.push({ id: "oc1", numero: "OC-2026-0023", requerimiento_id: "rq1", proveedor_ruc: "0190123456001", fecha_entrega: "2026-11-09", estado: "emitida" });
  assert.deepEqual(await notificar(env, { requerimiento_id: "rq1", evento: "aprobado" }), { ok: true });
  assert.match(ultimo(), /OC-2026-0023 · Ferretería El Constructor · entrega 09\/11\/2026/);
  assert.equal((await notificar(env, { requerimiento_id: "rq2", evento: "rechazado" })).motivo, "ventana_24h");
});

test("webhook: verificación, firma y API protegida", async () => {
  const ctx = { waitUntil: (p) => p };
  let r = await worker.fetch(new Request("https://w/webhook?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=42"), env, ctx);
  assert.equal(await r.text(), "42");
  const body = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: "593991112233", profile: { name: "Carlos" } }], messages: [txt("wh1", "593991112233", "Pedido Turi\n3 sacos cemento")] } }] }] });
  r = await worker.fetch(new Request("https://w/webhook", { method: "POST", body, headers: { "X-Hub-Signature-256": "sha256=malo" } }), env, ctx);
  assert.equal(r.status, 401);
  const firma = "sha256=" + createHmac("sha256", "secreto").update(body).digest("hex");
  assert.ok(await verificarFirma(env, body, firma));
  const tareas = [];
  r = await worker.fetch(new Request("https://w/webhook", { method: "POST", body, headers: { "X-Hub-Signature-256": firma } }), env, { waitUntil: (p) => tareas.push(p) });
  assert.equal(r.status, 200);
  await Promise.all(tareas);
  assert.equal(T.compras_requerimientos.length, 1);
  r = await worker.fetch(new Request("https://w/api/whatsapp/notificar", { method: "POST", body: "{}" }), env, ctx);
  assert.equal(r.status, 401);
});

test("la respuesta queda ligada al pedido", async () => {
  await procesarMensaje(env, txt("w1", "593991112233", "Pedido Turi\n5 sacos cemento"));
  const salida = T.whatsapp_mensajes.find((m) => m.direccion === "salida");
  assert.equal(salida.requerimiento_id, T.compras_requerimientos[0].id);
});
