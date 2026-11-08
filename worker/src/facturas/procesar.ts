// Núcleo: registrar claves, consultar SRI, guardar en Supabase + R2, sugerir obra.
import { descomponer } from "./clave";
import { parseComprobante, type Comprobante } from "./comprobante";
import { type Env, rucsEmpresa } from "./env";
import { consultarAutorizacion } from "./sri";
import { Supabase } from "./supabase";

export const MAX_INTENTOS = 12;

export interface Origen {
  origen: "correo" | "listado_sri" | "manual";
  email_de?: string;
  email_asunto?: string;
}

export function sb(env: Env): Supabase {
  return new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}

export function rutaR2(clave: string, ext: string): string {
  const c = descomponer(clave);
  const [a, m] = c.fecha_emision.split("-");
  return `facturas/${c.ruc_emisor}/${a}/${m}/${clave}.${ext}`;
}

/** Inserta las claves como pendientes (ignora las ya registradas). Devuelve las nuevas. */
export async function registrarPendientes(
  db: Supabase,
  claves: string[],
  origen: Origen,
): Promise<string[]> {
  const filas = claves.map((clave) => {
    const c = descomponer(clave);
    return {
      clave_acceso: clave,
      cod_doc: c.cod_doc,
      tipo: c.tipo,
      ruc_emisor: c.ruc_emisor,
      numero: c.numero,
      fecha_emision: c.fecha_emision,
      ambiente: c.ambiente,
      estado: "pendiente_sri",
      ...origen,
    };
  });
  const nuevas: { clave_acceso: string }[] = [];
  for (let i = 0; i < filas.length; i += 200) {
    nuevas.push(...(await db.insertarNuevas("facturas_proveedor", filas.slice(i, i + 200), "clave_acceso")));
  }
  return nuevas.map((n) => n.clave_acceso);
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Regla { patron: string; obra_id: string; ruc_emisor: string | null; prioridad: number }

export async function sugerirObra(
  db: Supabase,
  comp: Comprobante,
  extraTexto: string,
  cache: { reglas?: Regla[] },
): Promise<string | null> {
  cache.reglas ??= await db.select<Regla>(
    "reglas_obra",
    "select=patron,obra_id,ruc_emisor,prioridad&activa=eq.true&order=prioridad.desc",
  );
  const texto = normalizar(
    [...comp.info_adicional.map((c) => `${c.nombre} ${c.valor}`), extraTexto].join(" "),
  );
  for (const r of cache.reglas) {
    if (r.ruc_emisor && r.ruc_emisor !== comp.ruc_emisor) continue;
    if (!r.patron || texto.includes(normalizar(r.patron))) return r.obra_id;
  }
  const [prov] = await db.select<{ obra_sugerida_id: string | null }>(
    "proveedores",
    `select=obra_sugerida_id&ruc=eq.${comp.ruc_emisor}`,
  );
  return prov?.obra_sugerida_id ?? null;
}

function proximoIntento(intentos: number): string {
  const minutos = Math.min(15 * 2 ** intentos, 24 * 60);
  return new Date(Date.now() + minutos * 60_000).toISOString();
}

/** Procesa una clave ya registrada. Nunca lanza: deja el error anotado en la fila. */
export async function procesarClave(
  env: Env,
  db: Supabase,
  fila: { clave_acceso: string; intentos: number; email_asunto?: string | null },
  cache: { reglas?: Regla[] },
): Promise<string> {
  const clave = fila.clave_acceso;
  const filtro = `clave_acceso=eq.${clave}`;
  try {
    const aut = await consultarAutorizacion(clave);

    if (aut.estado !== "AUTORIZADO" || !aut.comprobanteXml) {
      const intentos = fila.intentos + 1;
      const definitivo = aut.estado !== "NO_ENCONTRADO" || intentos >= MAX_INTENTOS;
      const estado = !definitivo
        ? "pendiente_sri"
        : aut.estado === "NO_ENCONTRADO" ? "no_encontrada" : "no_autorizada";
      await db.actualizar("facturas_proveedor", filtro, {
        estado,
        estado_sri: aut.estado,
        intentos,
        proximo_intento: proximoIntento(intentos),
        ultimo_error: aut.mensajes ?? null,
      });
      return estado;
    }

    const comp = parseComprobante(aut.comprobanteXml);
    const ajena = !!comp.id_receptor && !rucsEmpresa(env).includes(comp.id_receptor);

    const xmlKey = rutaR2(clave, "xml");
    await env.BUCKET.put(xmlKey, aut.comprobanteXml, {
      httpMetadata: { contentType: "application/xml; charset=utf-8" },
    });

    await db.upsert(
      "proveedores",
      [{ ruc: comp.ruc_emisor, razon_social: comp.razon_social, nombre_comercial: comp.nombre_comercial }],
      "ruc",
    );

    const obra = ajena ? null : await sugerirObra(db, comp, fila.email_asunto ?? "", cache);

    await db.actualizar("facturas_proveedor", filtro, {
      cod_doc: comp.cod_doc,
      ruc_emisor: comp.ruc_emisor,
      razon_social: comp.razon_social,
      numero: comp.numero,
      fecha_emision: comp.fecha_emision,
      id_receptor: comp.id_receptor,
      subtotal: comp.subtotal,
      descuento: comp.descuento,
      iva: comp.iva,
      total: comp.total,
      doc_modificado: comp.doc_modificado,
      info_adicional: comp.info_adicional,
      estado: ajena ? "ajena" : "procesada",
      estado_sri: aut.estado,
      numero_autorizacion: aut.numeroAutorizacion ?? null,
      fecha_autorizacion: aut.fechaAutorizacion ?? null,
      xml_key: xmlKey,
      obra_sugerida_id: obra,
      intentos: fila.intentos + 1,
      ultimo_error: null,
    });

    await db.borrar("facturas_proveedor_detalle", filtro);
    await db.insertar(
      "facturas_proveedor_detalle",
      comp.detalles.map((d) => ({ clave_acceso: clave, ...d })),
    );
    return ajena ? "ajena" : "procesada";
  } catch (e) {
    const intentos = fila.intentos + 1;
    await db
      .actualizar("facturas_proveedor", filtro, {
        estado: intentos >= MAX_INTENTOS ? "error" : "pendiente_sri",
        intentos,
        proximo_intento: proximoIntento(intentos),
        ultimo_error: String((e as Error)?.message ?? e).slice(0, 500),
      })
      .catch(() => {});
    return "error";
  }
}

/** Procesa las pendientes cuya hora de reintento ya llegó. Límite pensado para el plan free de Workers. */
export async function procesarPendientes(env: Env, limite = 6, soloClaves?: string[]) {
  const db = sb(env);
  let q =
    "select=clave_acceso,intentos,email_asunto&estado=eq.pendiente_sri" +
    `&order=creado_en.asc&limit=${limite}`;
  q += soloClaves?.length
    ? `&clave_acceso=in.(${soloClaves.join(",")})`
    : `&or=(proximo_intento.is.null,proximo_intento.lte.${new Date().toISOString()})`;
  const filas = await db.select<{ clave_acceso: string; intentos: number; email_asunto: string | null }>(
    "facturas_proveedor",
    q,
  );
  const cache = {};
  const resultado: Record<string, string> = {};
  for (const f of filas) resultado[f.clave_acceso] = await procesarClave(env, db, f, cache);
  return resultado;
}
