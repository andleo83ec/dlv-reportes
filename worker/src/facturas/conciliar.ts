// Conciliación mensual con el listado "Comprobantes recibidos" (TXT) descargado del SRI.
import { descomponer, extraerClaves } from "./clave";
import { type Env, rucsEmpresa } from "./env";
import { procesarPendientes, registrarPendientes, sb } from "./procesar";

export interface ResultadoConciliacion {
  en_listado: number;
  ya_registradas: number;
  nuevas: { clave: string; ruc: string; proveedor: string | null; numero: string; fecha: string }[];
  en_sistema_no_en_listado: { clave: string; proveedor: string | null; numero: string; total: number | null }[];
  procesadas_ahora: Record<string, string>;
}

/** Del TXT toma la razón social si la fila empieza con el RUC emisor (formato habitual del SRI). */
function nombresDesdeTxt(txt: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const linea of txt.split(/\r?\n/)) {
    const [clave] = extraerClaves(linea);
    if (!clave) continue;
    const cols = linea.split("\t").map((c) => c.trim());
    const i = cols.findIndex((c) => /^\d{13}$/.test(c));
    if (i >= 0 && cols[i + 1] && !/^\d+$/.test(cols[i + 1])) m.set(clave, cols[i + 1]);
  }
  return m;
}

export async function conciliar(env: Env, txt: string): Promise<ResultadoConciliacion> {
  const db = sb(env);
  const propios = new Set(rucsEmpresa(env));
  const claves = extraerClaves(txt).filter((c) => !propios.has(descomponer(c).ruc_emisor));
  const nombres = nombresDesdeTxt(txt);

  const nuevas = await registrarPendientes(db, claves, { origen: "listado_sri" });

  // Marcar todas las del listado como confirmadas por el SRI.
  for (let i = 0; i < claves.length; i += 80) {
    await db.actualizar(
      "facturas_proveedor",
      `clave_acceso=in.(${claves.slice(i, i + 80).join(",")})`,
      { en_listado_sri: true },
    );
  }

  // Lo que está en el sistema (llegó por correo) en el mismo rango de fechas pero el SRI no lista:
  // posible anulación o comprobante ajeno. Revisar a mano.
  let enSistemaNoListado: ResultadoConciliacion["en_sistema_no_en_listado"] = [];
  if (claves.length) {
    const fechas = claves.map((c) => descomponer(c).fecha_emision).sort();
    const set = new Set(claves);
    const filas = await db.select<{ clave_acceso: string; razon_social: string | null; numero: string; total: number | null }>(
      "facturas_proveedor",
      `select=clave_acceso,razon_social,numero,total&fecha_emision=gte.${fechas[0]}` +
        `&fecha_emision=lte.${fechas[fechas.length - 1]}&estado=in.(procesada,pendiente_sri)`,
    );
    enSistemaNoListado = filas
      .filter((f) => !set.has(f.clave_acceso))
      .map((f) => ({ clave: f.clave_acceso, proveedor: f.razon_social, numero: f.numero, total: f.total }));
  }

  const procesadas = await procesarPendientes(env, 3, nuevas.slice(0, 3));

  return {
    en_listado: claves.length,
    ya_registradas: claves.length - nuevas.length,
    nuevas: nuevas.map((c) => {
      const d = descomponer(c);
      return { clave: c, ruc: d.ruc_emisor, proveedor: nombres.get(c) ?? null, numero: d.numero, fecha: d.fecha_emision };
    }),
    en_sistema_no_en_listado: enSistemaNoListado,
    procesadas_ahora: procesadas,
  };
}
