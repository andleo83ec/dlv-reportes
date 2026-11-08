import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";
import { claveValida, descomponer, digitoVerificador, extraerClaves } from "../src/facturas/clave";
import { parseComprobante } from "../src/facturas/comprobante";
import { leerRespuesta, sobreSoap } from "../src/facturas/sri";
import { leerZip } from "../src/facturas/zip";

// Clave sintética: 05/11/2026, factura, RUC 0190123456001, producción, 001-002-000004567
const base48 = "05112026" + "01" + "0190123456001" + "2" + "001002" + "000004567" + "12345678" + "1";
const CLAVE = base48 + digitoVerificador(base48);

const FACTURA = `<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="1.1.0">
 <infoTributaria><ambiente>2</ambiente><tipoEmision>1</tipoEmision>
  <razonSocial>FERRETERIA EL CONSTRUCTOR CIA. LTDA.</razonSocial><nombreComercial>EL CONSTRUCTOR</nombreComercial>
  <ruc>0190123456001</ruc><claveAcceso>${CLAVE}</claveAcceso><codDoc>01</codDoc>
  <estab>001</estab><ptoEmi>002</ptoEmi><secuencial>000004567</secuencial><dirMatriz>Cuenca</dirMatriz></infoTributaria>
 <infoFactura><fechaEmision>05/11/2026</fechaEmision><tipoIdentificacionComprador>04</tipoIdentificacionComprador>
  <razonSocialComprador>DLV CONSTRUCCIONES CIA. LTDA.</razonSocialComprador><identificacionComprador>0190000000001</identificacionComprador>
  <totalSinImpuestos>200.00</totalSinImpuestos><totalDescuento>5.00</totalDescuento>
  <totalConImpuestos><totalImpuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><baseImponible>200.00</baseImponible><valor>30.00</valor></totalImpuesto></totalConImpuestos>
  <propina>0.00</propina><importeTotal>230.00</importeTotal><moneda>DOLAR</moneda></infoFactura>
 <detalles>
  <detalle><codigoPrincipal>CEM50</codigoPrincipal><descripcion>Cemento Guapán 50 kg &amp; aditivo</descripcion><cantidad>20</cantidad><precioUnitario>8.25</precioUnitario><descuento>5.00</descuento><precioTotalSinImpuesto>160.00</precioTotalSinImpuesto>
   <impuestos><impuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><tarifa>15</tarifa><baseImponible>160.00</baseImponible><valor>24.00</valor></impuesto></impuestos></detalle>
  <detalle><codigoPrincipal>VAR12</codigoPrincipal><descripcion>Varilla 12 mm</descripcion><cantidad>4</cantidad><precioUnitario>10</precioUnitario><descuento>0</descuento><precioTotalSinImpuesto>40.00</precioTotalSinImpuesto>
   <impuestos><impuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><tarifa>15</tarifa><baseImponible>40.00</baseImponible><valor>6.00</valor></impuesto></impuestos></detalle>
 </detalles>
 <infoAdicional><campoAdicional nombre="Obra">Edificio Turi</campoAdicional><campoAdicional nombre="Email">x@y.com</campoAdicional></infoAdicional>
</factura>`;

test("dígito verificador módulo 11 y validación", () => {
  assert.equal(CLAVE.length, 49);
  assert.ok(claveValida(CLAVE));
  const mala = CLAVE.slice(0, 48) + ((Number(CLAVE[48]) + 1) % 10);
  assert.ok(!claveValida(mala));
  assert.ok(!claveValida("123"));
});

test("descomponer clave", () => {
  const d = descomponer(CLAVE);
  assert.equal(d.fecha_emision, "2026-11-05");
  assert.equal(d.tipo, "factura");
  assert.equal(d.ruc_emisor, "0190123456001");
  assert.equal(d.numero, "001-002-000004567");
  assert.equal(d.ambiente, "2");
});

test("extraer claves de texto mezclado (TXT del SRI, asunto, nombres)", () => {
  const txt = `RUC_EMISOR\tRAZON_SOCIAL\tCLAVE\n0190123456001\tFERRETERIA\t${CLAVE}\t05/11/2026\n` +
    `basura ${"9".repeat(49)} y ${CLAVE}1 (50 dígitos) y ${CLAVE}.pdf`;
  assert.deepEqual(extraerClaves(txt), [CLAVE]);
});

test("parsear factura", () => {
  const c = parseComprobante(FACTURA);
  assert.equal(c.clave_acceso, CLAVE);
  assert.equal(c.razon_social, "FERRETERIA EL CONSTRUCTOR CIA. LTDA.");
  assert.equal(c.numero, "001-002-000004567");
  assert.equal(c.fecha_emision, "2026-11-05");
  assert.equal(c.id_receptor, "0190000000001");
  assert.equal(c.subtotal, 200);
  assert.equal(c.iva, 30);
  assert.equal(c.total, 230);
  assert.equal(c.detalles.length, 2);
  assert.equal(c.detalles[0].descripcion, "Cemento Guapán 50 kg & aditivo");
  assert.equal(c.detalles[0].iva, 24);
  assert.equal(c.detalles[0].tarifa_iva, 15);
  assert.equal(c.detalles[1].codigo, "VAR12");
  assert.deepEqual(c.info_adicional[0], { nombre: "Obra", valor: "Edificio Turi" });
});

test("parsear nota de crédito", () => {
  const nc = `<notaCredito id="comprobante" version="1.1.0"><infoTributaria><razonSocial>PROV</razonSocial><ruc>0190123456001</ruc>
   <claveAcceso>X</claveAcceso><codDoc>04</codDoc><estab>001</estab><ptoEmi>001</ptoEmi><secuencial>000000010</secuencial></infoTributaria>
   <infoNotaCredito><fechaEmision>06/11/2026</fechaEmision><identificacionComprador>0190000000001</identificacionComprador>
   <codDocModificado>01</codDocModificado><numDocModificado>001-002-000004567</numDocModificado>
   <totalSinImpuestos>10.00</totalSinImpuestos><valorModificacion>11.50</valorModificacion>
   <totalConImpuestos><totalImpuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><baseImponible>10</baseImponible><valor>1.50</valor></totalImpuesto></totalConImpuestos>
   <motivo>Devolución</motivo></infoNotaCredito>
   <detalles><detalle><codigoInterno>CEM50</codigoInterno><descripcion>Cemento</descripcion><cantidad>1</cantidad><precioUnitario>10</precioUnitario><descuento>0</descuento><precioTotalSinImpuesto>10</precioTotalSinImpuesto>
   <impuestos><impuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><tarifa>15</tarifa><baseImponible>10</baseImponible><valor>1.50</valor></impuesto></impuestos></detalle></detalles></notaCredito>`;
  const c = parseComprobante(nc);
  assert.equal(c.total, 11.5);
  assert.equal(c.iva, 1.5);
  assert.equal(c.doc_modificado, "001-002-000004567");
  assert.equal(c.detalles[0].codigo, "CEM50");
});

function respuestaSri(comprobante: string) {
  return `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
  <ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion">
  <RespuestaAutorizacionComprobante><claveAccesoConsultada>${CLAVE}</claveAccesoConsultada><numeroComprobantes>1</numeroComprobantes>
  <autorizaciones><autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>${CLAVE}</numeroAutorizacion>
  <fechaAutorizacion>2026-11-05T10:22:31-05:00</fechaAutorizacion><ambiente>PRODUCCIÓN</ambiente>
  <comprobante>${comprobante}</comprobante><mensajes/></autorizacion></autorizaciones>
  </RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse></soap:Body></soap:Envelope>`;
}

test("respuesta SRI con CDATA", () => {
  const a = leerRespuesta(respuestaSri(`<![CDATA[${FACTURA}]]>`));
  assert.equal(a.estado, "AUTORIZADO");
  assert.equal(a.numeroAutorizacion, CLAVE);
  assert.equal(parseComprobante(a.comprobanteXml!).total, 230);
});

test("respuesta SRI con XML escapado", () => {
  const esc = FACTURA.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const a = leerRespuesta(respuestaSri(esc));
  const c = parseComprobante(a.comprobanteXml!);
  assert.equal(c.detalles[0].descripcion, "Cemento Guapán 50 kg & aditivo");
});

test("respuesta SRI sin comprobantes", () => {
  const r = `<RespuestaAutorizacionComprobante><claveAccesoConsultada>${CLAVE}</claveAccesoConsultada><numeroComprobantes>0</numeroComprobantes><autorizaciones/></RespuestaAutorizacionComprobante>`;
  assert.equal(leerRespuesta(r).estado, "NO_ENCONTRADO");
});

test("sobre SOAP incluye la clave", () => {
  assert.ok(sobreSoap(CLAVE).includes(`<claveAccesoComprobante>${CLAVE}</claveAccesoComprobante>`));
});

// ZIP construido a mano: un archivo deflate y uno almacenado.
function crearZip(archivos: { nombre: string; datos: Buffer; deflate: boolean }[]): ArrayBuffer {
  const locales: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const a of archivos) {
    const comp = a.deflate ? deflateRawSync(a.datos) : a.datos;
    const nom = Buffer.from(a.nombre);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(a.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(a.datos.length, 22); lh.writeUInt16LE(nom.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(a.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(a.datos.length, 24); ch.writeUInt16LE(nom.length, 28);
    ch.writeUInt32LE(off, 42);
    locales.push(lh, nom, comp); central.push(ch, nom);
    off += 30 + nom.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(archivos.length, 8); end.writeUInt16LE(archivos.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  const b = Buffer.concat([...locales, cd, end]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

test("leer ZIP con XML comprimido y PDF almacenado", async () => {
  const zip = crearZip([
    { nombre: `${CLAVE}.xml`, datos: Buffer.from(FACTURA), deflate: true },
    { nombre: "RIDE.pdf", datos: Buffer.from("%PDF-1.4 prueba"), deflate: false },
  ]);
  const arch = await leerZip(zip);
  assert.equal(arch.length, 2);
  assert.equal(new TextDecoder().decode(arch[0].datos), FACTURA);
  assert.equal(new TextDecoder().decode(arch[1].datos), "%PDF-1.4 prueba");
});
