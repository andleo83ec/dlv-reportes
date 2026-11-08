// Web service público de autorización del SRI (no requiere usuario ni clave).
import { leaf, section, sections, text } from "./xml";

const ENDPOINTS = {
  "2": "https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline",
  "1": "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline",
} as const;

export interface Autorizacion {
  estado: string; // AUTORIZADO | NO AUTORIZADO | NO_ENCONTRADO | ...
  numeroAutorizacion?: string;
  fechaAutorizacion?: string;
  comprobanteXml?: string;
  mensajes?: string;
}

export function sobreSoap(clave: string): string {
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:ec="http://ec.gob.sri.ws.autorizacion"><soapenv:Header/><soapenv:Body>` +
    `<ec:autorizacionComprobante><claveAccesoComprobante>${clave}</claveAccesoComprobante>` +
    `</ec:autorizacionComprobante></soapenv:Body></soapenv:Envelope>`
  );
}

export function leerRespuesta(xml: string): Autorizacion {
  const auts = sections(xml, "autorizacion");
  if (auts.length === 0) return { estado: "NO_ENCONTRADO" };
  const elegida = auts.find((a) => text(a, "estado") === "AUTORIZADO") ?? auts[0];
  const comp = section(elegida, "comprobante");
  const msgs = sections(elegida, "mensaje")
    .map((m) => [text(m, "identificador"), text(m, "mensaje"), text(m, "informacionAdicional")]
      .filter(Boolean).join(" "))
    .join(" | ");
  return {
    estado: text(elegida, "estado") ?? "DESCONOCIDO",
    numeroAutorizacion: text(elegida, "numeroAutorizacion") ?? undefined,
    fechaAutorizacion: text(elegida, "fechaAutorizacion") ?? undefined,
    comprobanteXml: comp ? leaf(comp) : undefined,
    mensajes: msgs || undefined,
  };
}

export async function consultarAutorizacion(
  clave: string,
  fetchFn: typeof fetch = fetch,
): Promise<Autorizacion> {
  const url = ENDPOINTS[clave[23] as "1" | "2"] ?? ENDPOINTS["2"];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
      body: sobreSoap(clave),
      signal: ctrl.signal,
    });
    const body = await r.text();
    if (!r.ok) throw new Error(`SRI HTTP ${r.status}: ${body.slice(0, 200)}`);
    return leerRespuesta(body);
  } finally {
    clearTimeout(t);
  }
}
