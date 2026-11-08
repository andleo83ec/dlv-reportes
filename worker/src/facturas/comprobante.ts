// Convierte el XML de un comprobante electrónico (factura, NC, ND, etc.) en datos planos.
import { camposAdicionales, num, section, sections, text } from "./xml";

export interface Detalle {
  linea: number;
  codigo: string | null;
  descripcion: string;
  cantidad: number | null;
  precio_unitario: number | null;
  descuento: number | null;
  subtotal: number | null;
  iva: number;
  tarifa_iva: number | null;
}

export interface Comprobante {
  cod_doc: string;
  clave_acceso: string;
  ruc_emisor: string;
  razon_social: string;
  nombre_comercial: string | null;
  numero: string;
  fecha_emision: string; // ISO
  id_receptor: string | null;
  razon_social_receptor: string | null;
  subtotal: number | null;
  descuento: number | null;
  iva: number;
  total: number | null;
  doc_modificado: string | null;
  info_adicional: { nombre: string; valor: string }[];
  detalles: Detalle[];
}

const INFO: Record<string, string> = {
  factura: "infoFactura",
  notaCredito: "infoNotaCredito",
  notaDebito: "infoNotaDebito",
  liquidacionCompra: "infoLiquidacionCompra",
  comprobanteRetencion: "infoCompRetencion",
  guiaRemision: "infoGuiaRemision",
};

function raiz(xml: string): string {
  const sinDecl = xml.replace(/<\?xml[^>]*\?>/, "");
  const m = sinDecl.match(/<([A-Za-z]+)[\s>]/);
  if (!m || !(m[1] in INFO)) throw new Error(`Comprobante no reconocido: <${m?.[1] ?? "?"}>`);
  return m[1];
}

function fechaIso(ddmmaaaa: string | null): string {
  const m = ddmmaaaa?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new Error(`Fecha inválida: ${ddmmaaaa}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Suma el IVA (código de impuesto 2) de una lista de bloques de impuesto. */
function sumaIva(bloques: string[]): { iva: number; tarifa: number | null } {
  let iva = 0;
  let tarifa: number | null = null;
  for (const b of bloques) {
    if (text(b, "codigo") !== "2") continue;
    iva += num(b, "valor") ?? 0;
    tarifa = num(b, "tarifa") ?? tarifa;
  }
  return { iva: redondear(iva), tarifa };
}

const redondear = (n: number) => Math.round(n * 100) / 100;

export function parseComprobante(xml: string): Comprobante {
  const root = raiz(xml);
  const it = section(xml, "infoTributaria");
  const info = section(xml, INFO[root]);
  if (!it || !info) throw new Error("Faltan infoTributaria / info del comprobante");

  const total =
    num(info, "importeTotal") ?? num(info, "valorModificacion") ?? num(info, "valorTotal");

  const impuestosCab = [...sections(info, "totalImpuesto"), ...sections(info, "impuesto")];

  const detallesXml = section(xml, "detalles");
  const detalles: Detalle[] = detallesXml
    ? sections(detallesXml, "detalle").map((d, i) => {
        const { iva, tarifa } = sumaIva(sections(d, "impuesto"));
        return {
          linea: i + 1,
          codigo: text(d, "codigoPrincipal") ?? text(d, "codigoInterno"),
          descripcion: text(d, "descripcion") ?? "",
          cantidad: num(d, "cantidad"),
          precio_unitario: num(d, "precioUnitario"),
          descuento: num(d, "descuento"),
          subtotal: num(d, "precioTotalSinImpuesto"),
          iva,
          tarifa_iva: tarifa,
        };
      })
    : [];

  const infoAd = section(xml, "infoAdicional");

  return {
    cod_doc: text(it, "codDoc") ?? "",
    clave_acceso: text(it, "claveAcceso") ?? "",
    ruc_emisor: text(it, "ruc") ?? "",
    razon_social: text(it, "razonSocial") ?? "",
    nombre_comercial: text(it, "nombreComercial"),
    numero: `${text(it, "estab")}-${text(it, "ptoEmi")}-${text(it, "secuencial")}`,
    fecha_emision: fechaIso(text(info, "fechaEmision")),
    id_receptor:
      text(info, "identificacionComprador") ??
      text(info, "identificacionSujetoRetenido") ??
      text(info, "identificacionProveedor"),
    razon_social_receptor:
      text(info, "razonSocialComprador") ??
      text(info, "razonSocialSujetoRetenido") ??
      text(info, "razonSocialProveedor"),
    subtotal: num(info, "totalSinImpuestos"),
    descuento: num(info, "totalDescuento"),
    iva: sumaIva(impuestosCab).iva,
    total,
    doc_modificado: text(info, "numDocModificado"),
    info_adicional: infoAd ? camposAdicionales(infoAd) : [],
    detalles,
  };
}
