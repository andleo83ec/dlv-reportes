// Lector XML mínimo para comprobantes del SRI (estructura simple, sin dependencias).

export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function tagRegex(name: string): RegExp {
  // Acepta prefijo de namespace opcional (ns2:...) y atributos.
  return new RegExp(
    `<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`,
    "g",
  );
}

/** Contenido crudo (sin decodificar) de la primera etiqueta `name`. */
export function section(xml: string, name: string): string | null {
  const m = tagRegex(name).exec(xml);
  return m ? m[1] : null;
}

/** Contenido crudo de todas las etiquetas `name`. */
export function sections(xml: string, name: string): string[] {
  return [...xml.matchAll(tagRegex(name))].map((m) => m[1]);
}

/** Texto de una hoja: quita CDATA o decodifica entidades. */
export function leaf(raw: string): string {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return (cdata ? cdata[1] : decodeEntities(raw)).trim();
}

export function text(xml: string, name: string): string | null {
  const s = section(xml, name);
  return s === null ? null : leaf(s);
}

export function num(xml: string, name: string): number | null {
  const t = text(xml, name);
  if (t === null || t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** <campoAdicional nombre="X">valor</campoAdicional> */
export function camposAdicionales(xml: string): { nombre: string; valor: string }[] {
  const out: { nombre: string; valor: string }[] = [];
  const re = /<campoAdicional\s+nombre="([^"]*)"\s*>([\s\S]*?)<\/campoAdicional>/g;
  for (const m of xml.matchAll(re)) {
    out.push({ nombre: decodeEntities(m[1]).trim(), valor: leaf(m[2]) });
  }
  return out;
}
