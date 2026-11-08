import assert from "node:assert/strict";
import { test } from "node:test";
import { aE164, detectarObra, interpretar, leerItem, resumenItems } from "../src/whatsapp/parser.js";

const obras = [
  { id: "turi", nombre: "Edificio Turi", alias: [] },
  { id: "riv", nombre: "Edificio Rivoria", alias: [] },
  { id: "lv", nombre: "Edificio La Vuelta", alias: ["lv"] },
  { id: "rt", nombre: "Edificio Remigio Tamariz", alias: [] },
];
const proveedores = [
  { ruc: "0190123456001", razon_social: "Ferretería El Constructor" },
  { ruc: "0190655512001", razon_social: "Aceros Andinos Cía. Ltda." },
];

test("ítems en formatos comunes", () => {
  const casos = [
    ["20 sacos cemento", 20, "saco", "Cemento"],
    ["20 sacos de cemento", 20, "saco", "Cemento"],
    ["Cemento 20 sacos", 20, "saco", "Cemento"],
    ["cemento x 20", 20, "u", "Cemento"],
    ["10 varillas 12mm", 10, "u", "Varillas 12mm"],
    ["2 m3 arena", 2, "m³", "Arena"],
    ["2m3 de ripio", 2, "m³", "Ripio"],
    ["1,5 m³ de arena fina", 1.5, "m³", "Arena fina"],
    ["1/2 galón de pintura blanca", 0.5, "gl", "Pintura blanca"],
    ["media volqueta de arena", 0.5, "viaje", "Arena"],
    ["- 6 rollos cable 12 AWG", 6, "rollo", "Cable 12 AWG"],
    ["1) 30 breakers 20A", 30, "u", "Breakers 20A"],
    ["Varilla 12 mm x 50", 50, "u", "Varilla 12 mm"],
    ["necesito 4 canecas de impermeabilizante", 4, "caneca", "Impermeabilizante"],
    ["dos rollos de alambre", 2, "rollo", "Alambre"],
    ["Arena: 3 m3", 3, "m³", "Arena"],
    ["40 kg alambre recocido", 40, "kg", "Alambre recocido"],
  ];
  for (const [l, c, u, d] of casos) {
    const it = leerItem(l);
    assert.ok(it, `no leyó: ${l}`);
    assert.deepEqual([it.cantidad, it.unidad, it.descripcion], [c, u, d], l);
  }
});

test("líneas que no son ítems", () => {
  for (const l of ["Buenos días ingeniero", "para el lunes 10", "Pedido Turi piso 3", "a las 8", "gracias", "urgente", "varilla 12 mm"]) {
    assert.equal(leerItem(l), null, l);
  }
});

test("pedido completo con obra, urgente y proveedor", () => {
  const r = interpretar("Pedido Turi\n20 sacos cemento\n10 varillas 12mm, 2 m3 arena\nProveedor: El Constructor\nUrgente por favor", { obras, proveedores });
  assert.equal(r.tipo, "pedido");
  assert.equal(r.obra_id, "turi");
  assert.equal(r.items.length, 3);
  assert.equal(r.proveedor_ruc, "0190123456001");
  assert.equal(r.urgente, true);
  assert.match(resumenItems(r.items), /1\) 20 saco · Cemento/);
});

test("obra en texto libre y alias; sin obra cuando es ambigua", () => {
  const pv = interpretar("Para la vuelta: 5 sacos cemento", { obras });
  assert.deepEqual([pv.tipo, pv.obra_id, pv.items.length], ["pedido", "lv", 1]);
  assert.equal(interpretar("LV\n5 sacos cemento", { obras }).obra_id, "lv");
  assert.equal(interpretar("5 sacos cemento", { obras }).obra_id, null);
  assert.equal(detectarObra("turi y rivoria", obras), null);
});

test("una sola línea con varios ítems separados por y", () => {
  const r = interpretar("Rivoria 20 sacos de cemento y 3 m3 de arena", { obras });
  assert.equal(r.items.length, 2);
});

test("comandos", () => {
  assert.equal(interpretar("estado").tipo, "estado");
  assert.equal(interpretar("Ayuda").tipo, "ayuda");
  assert.deepEqual(interpretar("anular PD-2026-7"), { tipo: "anular", numero: "PD-2026-0007" });
  const r = interpretar("Recibido OC-2026-0023 guía 002-001-4410");
  assert.deepEqual(r, { tipo: "recibido", numero: "OC-2026-0023", parcial: false, guia: "002-001-000004410" });
  assert.equal(interpretar("llegó la oc 2026 23 pero faltan 5 sacos").parcial, true);
  assert.equal(interpretar("Ya llegó").tipo, "recibido");
});

test("teléfonos a formato internacional", () => {
  assert.equal(aE164("0999501112"), "593999501112");
  assert.equal(aE164("+593 99 950 1112"), "593999501112");
  assert.equal(aE164("999501112"), "593999501112");
  assert.equal(aE164("07 288 1234"), "07 288 1234".replace(/\D/g, ""));
});

test("cabeceras con guiones no se leen como ítems", () => {
  const r = interpretar("Pedido La Vuelta — piso 3\n12 planchas gypsum 1/2\n— 3 cajas tornillo", { obras });
  assert.deepEqual(r.items.map((i) => i.cantidad), [12, 3]);
  assert.equal(r.obra_id, "lv");
});
