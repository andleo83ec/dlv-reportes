// Extractor ZIP mínimo (algunos proveedores envían XML+PDF comprimidos).
// Usa el directorio central y DecompressionStream("deflate-raw"), disponible en Workers.

export interface ArchivoZip {
  nombre: string;
  datos: Uint8Array;
}

async function inflar(datos: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const out = new Response(new Blob([datos.slice()]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

export async function leerZip(buf: ArrayBuffer, maxBytes = 15_000_000): Promise<ArchivoZip[]> {
  const b = new Uint8Array(buf);
  const v = new DataView(buf);
  // Fin del directorio central (firma 0x06054b50), buscado desde el final.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP inválido");
  const total = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ArchivoZip[] = [];
  let acumulado = 0;

  for (let n = 0; n < total; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true);
    const comp = v.getUint32(p + 20, true);
    const tam = v.getUint32(p + 24, true);
    const lNom = v.getUint16(p + 28, true);
    const lExtra = v.getUint16(p + 30, true);
    const lCom = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nombre = dec.decode(b.subarray(p + 46, p + 46 + lNom));
    p += 46 + lNom + lExtra + lCom;

    if (nombre.endsWith("/")) continue;
    acumulado += tam;
    if (acumulado > maxBytes) break;

    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const crudo = b.subarray(inicio, inicio + comp);
    if (metodo === 0) out.push({ nombre, datos: crudo.slice() });
    else if (metodo === 8) out.push({ nombre, datos: await inflar(crudo) });
  }
  return out;
}
