// Clave de acceso del SRI: 49 dígitos
// ddmmaaaa(8) tipo(2) ruc(13) ambiente(1) estab(3) ptoEmi(3) secuencial(9) codigo(8) tipoEmision(1) dv(1)

export const TIPOS: Record<string, string> = {
  "01": "factura",
  "03": "liquidacion_compra",
  "04": "nota_credito",
  "05": "nota_debito",
  "06": "guia_remision",
  "07": "retencion",
};

export function digitoVerificador(primeros48: string): number {
  let suma = 0;
  let peso = 2;
  for (let i = primeros48.length - 1; i >= 0; i--) {
    suma += Number(primeros48[i]) * peso;
    peso = peso === 7 ? 2 : peso + 1;
  }
  const dv = 11 - (suma % 11);
  if (dv === 11) return 0;
  if (dv === 10) return 1;
  return dv;
}

export function claveValida(clave: string): boolean {
  if (!/^\d{49}$/.test(clave)) return false;
  return digitoVerificador(clave.slice(0, 48)) === Number(clave[48]);
}

export interface ClaveInfo {
  clave: string;
  fecha_emision: string; // ISO yyyy-mm-dd
  cod_doc: string;
  tipo: string;
  ruc_emisor: string;
  ambiente: "1" | "2";
  numero: string; // 001-001-000000123
}

export function descomponer(clave: string): ClaveInfo {
  const dd = clave.slice(0, 2), mm = clave.slice(2, 4), aaaa = clave.slice(4, 8);
  const cod = clave.slice(8, 10);
  return {
    clave,
    fecha_emision: `${aaaa}-${mm}-${dd}`,
    cod_doc: cod,
    tipo: TIPOS[cod] ?? `tipo_${cod}`,
    ruc_emisor: clave.slice(10, 23),
    ambiente: clave[23] as "1" | "2",
    numero: `${clave.slice(24, 27)}-${clave.slice(27, 30)}-${clave.slice(30, 39)}`,
  };
}

/** Busca claves de acceso válidas en cualquier texto (correo, nombre de archivo, XML, TXT del SRI). */
export function extraerClaves(texto: string): string[] {
  const set = new Set<string>();
  for (const m of texto.matchAll(/(?<!\d)\d{49}(?!\d)/g)) {
    if (claveValida(m[0])) set.add(m[0]);
  }
  return [...set];
}
