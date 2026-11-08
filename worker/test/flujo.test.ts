// Flujo completo con SRI, Supabase y R2 simulados.
import assert from "node:assert/strict";
import { test } from "node:test";
import { digitoVerificador } from "../src/facturas/clave";
import { conciliar } from "../src/facturas/conciliar";
import type { Env } from "../src/facturas/env";
import { procesarPendientes, registrarPendientes, sb } from "../src/facturas/procesar";

const b48 = "05112026" + "01" + "0190123456001" + "2" + "001002" + "000004567" + "12345678" + "1";
const CLAVE = b48 + digitoVerificador(b48);
const b48b = "06112026" + "01" + "0190999999001" + "2" + "001001" + "000000099" + "87654321" + "1";
const CLAVE_B = b48b + digitoVerificador(b48b);

const FACTURA = `<factura id="comprobante"><infoTributaria><razonSocial>FERRETERIA</razonSocial><ruc>0190123456001</ruc>
<claveAcceso>${CLAVE}</claveAcceso><codDoc>01</codDoc><estab>001</estab><ptoEmi>002</ptoEmi><secuencial>000004567</secuencial></infoTributaria>
<infoFactura><fechaEmision>05/11/2026</fechaEmision><identificacionComprador>0190000000001</identificacionComprador>
<totalSinImpuestos>100.00</totalSinImpuestos><totalConImpuestos><totalImpuesto><codigo>2</codigo><valor>15.00</valor></totalImpuesto></totalConImpuestos>
<importeTotal>115.00</importeTotal></infoFactura><detalles><detalle><codigoPrincipal>A</codigoPrincipal><descripcion>Arena</descripcion>
<cantidad>10</cantidad><precioUnitario>10</precioUnitario><descuento>0</descuento><precioTotalSinImpuesto>100</precioTotalSinImpuesto>
<impuestos><impuesto><codigo>2</codigo><tarifa>15</tarifa><valor>15</valor></impuesto></impuestos></detalle></detalles>
<infoAdicional><campoAdicional nombre="Observación">Entrega obra TURÍ</campoAdicional></infoAdicional></factura>`;

// --- Supabase en memoria (solo lo que usa el Worker) ---
const tablas: Record<string, any[]> = {
  facturas_proveedor: [], facturas_proveedor_detalle: [], proveedores: [],
  reglas_obra: [{ patron: "turi", obra_id: "obra-turi", ruc_emisor: null, prioridad: 1, activa: true }],
};
function filtrar(filas: any[], params: URLSearchParams) {
  return filas.filter((f) => {
    for (const [k, v] of params) {
      if (["select", "order", "limit", "on_conflict", "or"].includes(k)) continue;
      const [op, ...rest] = v.split(".");
      const val = rest.join(".");
      if (op === "eq" && String(f[k]) !== val) return false;
      if (op === "in" && !val.slice(1, -1).split(",").includes(String(f[k]))) return false;
      if (op === "gte" && !(f[k] >= val)) return false;
      if (op === "lte" && !(f[k] <= val)) return false;
    }
    return true;
  });
}
let sriLlamadas = 0;
const fakeFetch = async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  if (url.host.includes("sri.gob.ec")) {
    sriLlamadas++;
    const clave = String(init.body).match(/\d{49}/)![0];
    const body = clave === CLAVE
      ? `<RespuestaAutorizacionComprobante><autorizaciones><autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>${CLAVE}</numeroAutorizacion><fechaAutorizacion>2026-11-05T10:00:00-05:00</fechaAutorizacion><comprobante><![CDATA[${FACTURA}]]></comprobante></autorizacion></autorizaciones></RespuestaAutorizacionComprobante>`
      : `<RespuestaAutorizacionComprobante><numeroComprobantes>0</numeroComprobantes><autorizaciones/></RespuestaAutorizacionComprobante>`;
    return new Response(body);
  }
  const tabla = url.pathname.split("/").pop()!;
  const t = (tablas[tabla] ??= []);
  const pref = init.headers?.Prefer ?? "";
  if (tabla === "reglas_obra" || (!init.method || init.method === "GET")) return Response.json(filtrar(t, url.searchParams));
  if (init.method === "POST") {
    const filas = JSON.parse(init.body);
    const pk = url.searchParams.get("on_conflict");
    const insertadas: any[] = [];
    for (const f of filas) {
      const ex = pk ? t.find((x) => x[pk] === f[pk]) : undefined;
      if (ex) { if (pref.includes("merge")) Object.assign(ex, f); continue; }
      const nueva = { intentos: 0, ...f }; t.push(nueva); insertadas.push(nueva);
    }
    return pref.includes("representation") ? Response.json(insertadas) : new Response("");
  }
  if (init.method === "PATCH") { for (const f of filtrar(t, url.searchParams)) Object.assign(f, JSON.parse(init.body)); return new Response(""); }
  if (init.method === "DELETE") { tablas[tabla] = t.filter((f) => !filtrar([f], url.searchParams).length); return new Response(""); }
  return new Response("?", { status: 400 });
};
(globalThis as any).fetch = fakeFetch;

const r2 = new Map<string, any>();
const env: Env = {
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", API_TOKEN: "t",
  RUC_EMPRESA: "0190000000001",
  BUCKET: { put: async (k, v) => { r2.set(k, v); }, get: async () => null },
};

test("registrar + procesar: factura autorizada queda completa y con obra sugerida", async () => {
  const nuevas = await registrarPendientes(sb(env), [CLAVE], { origen: "correo", email_asunto: "Factura 4567" });
  assert.deepEqual(nuevas, [CLAVE]);
  const again = await registrarPendientes(sb(env), [CLAVE], { origen: "correo" });
  assert.deepEqual(again, [], "no se duplica");

  const res = await procesarPendientes(env, 6, [CLAVE]);
  assert.equal(res[CLAVE], "procesada");
  const f = tablas.facturas_proveedor.find((x) => x.clave_acceso === CLAVE);
  assert.equal(f.total, 115);
  assert.equal(f.iva, 15);
  assert.equal(f.razon_social, "FERRETERIA");
  assert.equal(f.obra_sugerida_id, "obra-turi");
  assert.equal(f.obra_id, undefined, "la obra la confirma una persona");
  assert.equal(tablas.facturas_proveedor_detalle.length, 1);
  assert.ok(r2.has(`facturas/0190123456001/2026/11/${CLAVE}.xml`));
  assert.equal(tablas.proveedores[0].ruc, "0190123456001");
});

test("clave que el SRI aún no devuelve queda pendiente con reintento", async () => {
  await registrarPendientes(sb(env), [CLAVE_B], { origen: "manual" });
  const res = await procesarPendientes(env, 6, [CLAVE_B]);
  assert.equal(res[CLAVE_B], "pendiente_sri");
  const f = tablas.facturas_proveedor.find((x) => x.clave_acceso === CLAVE_B);
  assert.equal(f.intentos, 1);
  assert.ok(new Date(f.proximo_intento) > new Date());
});

test("conciliación: detecta lo que no llegó por correo y marca en listado", async () => {
  const b = "07112026" + "01" + "0190777777001" + "2" + "002001" + "000000555" + "11112222" + "1";
  const nueva = b + digitoVerificador(b);
  const txt = `RUC_EMISOR\tRAZON_SOCIAL_EMISOR\tTIPO\tSERIE\tCLAVE_ACCESO\n` +
    `0190123456001\tFERRETERIA\tFactura\t001-002-000004567\t${CLAVE}\n` +
    `0190777777001\tHORMIGONES DEL AUSTRO\tFactura\t002-001-000000555\t${nueva}\n`;
  const r = await conciliar(env, txt);
  assert.equal(r.en_listado, 2);
  assert.equal(r.ya_registradas, 1);
  assert.equal(r.nuevas[0].proveedor, "HORMIGONES DEL AUSTRO");
  assert.equal(tablas.facturas_proveedor.find((x) => x.clave_acceso === CLAVE).en_listado_sri, true);
  // CLAVE_B (06/11) está en el sistema dentro del rango y no en el TXT → se reporta
  assert.deepEqual(r.en_sistema_no_en_listado.map((x) => x.clave), [CLAVE_B]);
});
