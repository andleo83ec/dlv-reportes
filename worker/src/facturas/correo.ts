// Recepción de correos (Cloudflare Email Routing → Email Worker).
import PostalMime from "postal-mime";
import { descomponer, extraerClaves } from "./clave";
import { type Env, rucsEmpresa } from "./env";
import { procesarPendientes, registrarPendientes, rutaR2, sb } from "./procesar";
import { leerZip } from "./zip";

interface Adjunto { nombre: string; tipo: string; datos: Uint8Array }

const MAX_CLAVES_POR_CORREO = 30;
const PROCESAR_EN_LINEA = 5; // el resto lo toma el cron

async function aplanarAdjuntos(adjs: { filename?: string | null; mimeType?: string; content: ArrayBuffer | string }[]) {
  const out: Adjunto[] = [];
  for (const a of adjs) {
    const nombre = a.filename ?? "";
    const datos = typeof a.content === "string" ? new TextEncoder().encode(a.content) : new Uint8Array(a.content);
    if (/\.zip$/i.test(nombre) || a.mimeType === "application/zip") {
      try {
        for (const f of await leerZip(datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.byteLength) as ArrayBuffer)) {
          out.push({ nombre: f.nombre, tipo: tipoPorNombre(f.nombre), datos: f.datos });
        }
      } catch { /* ZIP dañado: se ignora */ }
    } else {
      out.push({ nombre, tipo: a.mimeType ?? tipoPorNombre(nombre), datos });
    }
  }
  return out;
}

function tipoPorNombre(n: string): string {
  if (/\.xml$/i.test(n)) return "application/xml";
  if (/\.pdf$/i.test(n)) return "application/pdf";
  return "application/octet-stream";
}

const esXml = (a: Adjunto) => /xml/i.test(a.tipo) || /\.xml$/i.test(a.nombre);
const esPdf = (a: Adjunto) => /pdf/i.test(a.tipo) || /\.pdf$/i.test(a.nombre);

export async function manejarCorreo(message: any, env: Env): Promise<void> {
  const raw = await new Response(message.raw).arrayBuffer();
  const email = await PostalMime.parse(raw);
  const adjuntos = await aplanarAdjuntos(email.attachments ?? []);
  const dec = new TextDecoder();

  // 1. Claves de acceso: de los XML, nombres de archivo, asunto y cuerpo.
  const xmlTextos = adjuntos.filter(esXml).map((a) => ({ a, txt: dec.decode(a.datos) }));
  const fuentes = [
    ...xmlTextos.map((x) => x.txt),
    ...adjuntos.map((a) => a.nombre),
    email.subject ?? "",
    email.text ?? (email.html ?? "").replace(/<[^>]+>/g, " "),
  ];
  const propios = new Set(rucsEmpresa(env));
  const claves = extraerClaves(fuentes.join("\n"))
    .filter((c) => !propios.has(descomponer(c).ruc_emisor)) // excluye lo que emitimos nosotros
    .slice(0, MAX_CLAVES_POR_CORREO);

  const db = sb(env);
  const de = email.from?.address ?? message.from;

  // 2. Bitácora del correo (sirve para revisar los que no traían clave).
  await db.insertar("facturas_correos", [{
    message_id: email.messageId ?? null,
    de,
    asunto: email.subject ?? null,
    adjuntos: adjuntos.map((a) => a.nombre),
    claves,
  }]).catch(() => {});

  if (env.FORWARD_TO) await message.forward(env.FORWARD_TO).catch(() => {});
  if (claves.length === 0) return;

  // 3. Registrar las claves (si ya existían por otra vía, no se duplican).
  await registrarPendientes(db, claves, { origen: "correo", email_de: de, email_asunto: email.subject ?? undefined });

  // 4. Guardar en R2 el PDF (RIDE) y el XML recibido, asociados a su clave.
  for (const clave of claves) {
    const sec = descomponer(clave).numero.slice(-9);
    const pdf =
      adjuntos.find((a) => esPdf(a) && a.nombre.includes(clave)) ??
      adjuntos.find((a) => esPdf(a) && a.nombre.includes(sec)) ??
      (claves.length === 1 ? adjuntos.find(esPdf) : undefined);
    if (pdf) {
      const key = rutaR2(clave, "pdf");
      await env.BUCKET.put(key, pdf.datos, { httpMetadata: { contentType: "application/pdf" } });
      await db.actualizar("facturas_proveedor", `clave_acceso=eq.${clave}`, { pdf_key: key }).catch(() => {});
    }
    const xml = xmlTextos.find((x) => x.txt.includes(clave));
    if (xml) {
      await env.BUCKET.put(rutaR2(clave, "recibido.xml"), xml.a.datos, {
        httpMetadata: { contentType: "application/xml; charset=utf-8" },
      });
    }
  }

  // 5. Validar contra el SRI las primeras; el resto queda para el cron.
  await procesarPendientes(env, PROCESAR_EN_LINEA, claves.slice(0, PROCESAR_EN_LINEA));
}
