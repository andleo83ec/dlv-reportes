// Lector de mensajes de WhatsApp de obra (compartido entre el Worker y la app).
// Entiende pedidos en texto libre y comandos cortos: estado, anular, recibido, ayuda.

export const normalizar = (s) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Teléfono ecuatoriano o internacional → 593999501112 (sin +). */
export function aE164(tel, pais = "593") {
  let d = String(tel ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("0")) d = pais + d.slice(1); // 0999501112
  else if (d.length === 9 && d.startsWith("9")) d = pais + d; // 999501112
  return d;
}

const UNIDADES = [
  ["m³", ["metros cubicos", "metro cubico", "metros cúbicos", "metro cúbico", "m3", "m³", "mt3", "mts3", "cubos"]],
  ["m²", ["metros cuadrados", "metro cuadrado", "m2", "m²", "mt2", "mts2"]],
  ["m", ["metros lineales", "metro lineal", "ml", "mts", "metros", "metro", "m"]],
  ["saco", ["sacos", "saco"]],
  ["qq", ["quintales", "quintal", "qq"]],
  ["kg", ["kilogramos", "kilos", "kilo", "kg"]],
  ["lb", ["libras", "libra", "lb"]],
  ["gl", ["galones", "galón", "galon", "gal", "gl"]],
  ["caneca", ["canecas", "caneca"]],
  ["l", ["litros", "litro", "lt", "l"]],
  ["rollo", ["rollos", "rollo"]],
  ["caja", ["cajas", "caja"]],
  ["paquete", ["paquetes", "paquete", "paq"]],
  ["funda", ["fundas", "funda"]],
  ["plancha", ["planchas", "plancha"]],
  ["viaje", ["volquetas", "volqueta", "viajes", "viaje"]],
  ["par", ["pares", "par"]],
  ["u", ["unidades", "unidad", "unid", "und", "u", "piezas", "pieza", "pza"]],
];
const UNIDAD_DE = new Map();
for (const [canon, vars] of UNIDADES) for (const v of vars) UNIDAD_DE.set(normalizar(v), canon);
const UNI_RE = [...UNIDAD_DE.keys()]
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"))
  .join("|");

const PALABRAS_NUM = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100, media: 0.5, medio: 0.5,
};
const NUM_RE = `(\\d+\\s*\\/\\s*\\d+|\\d+(?:[.,]\\d+)?|${Object.keys(PALABRAS_NUM).join("|")})`;

function aNumero(t) {
  t = normalizar(t).trim();
  if (t in PALABRAS_NUM) return PALABRAS_NUM[t];
  const f = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (f) return +f[1] / +f[2];
  return parseFloat(t.replace(",", "."));
}

// Trabaja sobre texto ya normalizado (sin tildes, minúsculas) pero conserva el original para la descripción.
const RE_A = new RegExp(`^${NUM_RE}\\s*(?:(${UNI_RE})(?=\\s|$|\\.)\\.?)?\\s*(?:de |del )?(.+)$`);
const RE_B = new RegExp(`^(.+?)\\s*(?:[:=x×*-]\\s*|\\s)${NUM_RE}\\s*(?:(${UNI_RE})\\.?)?\\s*$`);
const PREFIJOS = /^(?:(?:tambien|ademas|y|por favor|favor|porfa|necesito|necesitamos|se necesita|enviar|envien|envie|enviame|mandar|manden|mandeme|mandame|traer|pedir|pedimos|solicito|solicitamos|comprar)\s+(?:(?:de|que|nos|me)\s+)*)+/;
const NO_ITEM = /^(?:para|pedido|obra|hola|buen|buenas|buenos|gracias|saludos|ing|ingeniero|arq|hasta|el|los|las|a|en|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|urgente|proveedor|recib)\b/;

function limpiarDesc(s) {
  s = s.replace(/\s+(?:para|hasta)\s+(?:hoy|mañana|manana|el\s+\S+|la\s+tarde|primera\s+hora)\b.*$/i, "")
    .replace(/^\s*(?:de|del)\s+/i, "").replace(/[\s.,;:]+$/, "").replace(/\s+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Intenta leer un ítem en una línea. */
export function leerItem(lineaOriginal) {
  let orig = lineaOriginal.replace(/^\s*(?:[-*•·–—]+|\d{1,2}[.)-](?=\s)|\(\d{1,2}\))\s*/, "").trim();
  let n = normalizar(orig);
  const pre = n.match(PREFIJOS);
  if (pre) { orig = orig.slice(pre[0].length); n = n.slice(pre[0].length); }
  if (!n || n.length > 140) return null;

  let m = n.match(RE_A);
  if (m) {
    const cantidad = aNumero(m[1]);
    const desc = orig.slice(orig.length - m[3].length);
    if (cantidad > 0 && /[a-z]/.test(m[3]) && !NO_ITEM.test(m[3]))
      return { cantidad, unidad: m[2] ? UNIDAD_DE.get(m[2].replace(/\s+/g, " ")) : "u", descripcion: limpiarDesc(desc) };
  }
  m = n.match(RE_B);
  if (m && !NO_ITEM.test(m[1]) && /^[a-z]/.test(m[1])) {
    const cantidad = aNumero(m[2]);
    if (cantidad > 0)
      return { cantidad, unidad: m[3] ? UNIDAD_DE.get(m[3].replace(/\s+/g, " ")) : "u", descripcion: limpiarDesc(orig.slice(0, m[1].length)) };
  }
  return null;
}

const GENERICAS = new Set(["edificio", "casa", "obra", "proyecto", "conjunto", "condominio", "torre", "de", "la", "el", "los", "las", "del", "y"]);

/** Términos que identifican cada obra: alias + palabras propias del nombre. */
export function terminosObra(o) {
  const propias = normalizar(o.nombre).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERICAS.has(w));
  return [...new Set([...(o.alias || []).map(normalizar), normalizar(o.nombre), ...propias])].filter(Boolean);
}

export function detectarObra(texto, obras) {
  const t = " " + normalizar(texto).replace(/[^a-z0-9]+/g, " ") + " ";
  const hits = obras.filter((o) => terminosObra(o).some((term) => t.includes(" " + term.replace(/[^a-z0-9]+/g, " ").trim() + " ")));
  return hits.length === 1 ? hits[0] : null;
}

export function detectarProveedor(texto, proveedores) {
  const t = normalizar(texto);
  let mejor = null, puntos = 0;
  for (const p of proveedores) {
    const palabras = normalizar(p.razon_social).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !["compania", "ltda", "comercial", "s.a.s"].includes(w));
    const hit = palabras.filter((w) => t.includes(w)).length;
    if (hit > puntos) { puntos = hit; mejor = p; }
  }
  return puntos ? mejor : null;
}

function numDoc(pref, texto) {
  const m = normalizar(texto).match(new RegExp(`\\b${pref}\\s*-?\\s*(\\d{4})\\s*-?\\s*(\\d{1,4})\\b`));
  return m ? `${pref.toUpperCase()}-${m[1]}-${m[2].padStart(4, "0")}` : null;
}

/**
 * Interpreta un mensaje de obra.
 * @returns {{tipo:'ayuda'|'estado'|'anular'|'recibido'|'pedido'|'vacio', ...}}
 */
export function interpretar(texto, { obras = [], proveedores = [] } = {}) {
  const t = String(texto ?? "").trim();
  const n = normalizar(t);
  if (!n) return { tipo: "vacio" };
  if (/^(ayuda|help|menu|\?|hola|buenas|buenos dias|buenas tardes)\W*$/.test(n)) return { tipo: "ayuda" };
  if (/^(estado|mis pedidos|pendientes|status)\b/.test(n)) return { tipo: "estado" };
  if (/^(anular|cancelar)\b/.test(n)) return { tipo: "anular", numero: numDoc("pd", n) };

  const oc = numDoc("oc", n);
  if (/\b(recibid\w*|recibi\w*|llego|llegaron|entregad\w*|ya llego)\b/.test(n) && (oc || n.split(/\s+/).length <= 6)) {
    const g = t.match(/\b(\d{3})-(\d{3})-(\d{1,9})\b/);
    return {
      tipo: "recibido",
      numero: oc,
      parcial: /\b(parcial|faltan?|incomplet\w*|solo llego|solo llegaron|no llego)\b/.test(n),
      guia: g ? `${g[1]}-${g[2]}-${g[3].padStart(9, "0")}` : null,
    };
  }

  const partes = t
    .split(/\r?\n/)
    .flatMap((l) => l.split(new RegExp(`;|,(?!\\d)|(?<!\\d),|\\.\\s+|\\s+y\\s+(?=\\d|(?:${Object.keys(PALABRAS_NUM).join("|")})\\s)`)))
    .map((l) => l.trim())
    .filter(Boolean);

  const items = [], notas = [], cabecera = [];
  let proveedorTexto = null;
  const terminos = obras.flatMap((o) => terminosObra(o)).sort((a, b) => b.length - a.length)
    .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const reObraInicial = terminos.length
    ? new RegExp(`^(?:pedido\\s+)?(?:para\\s+)?(?:la\\s+obra\\s+|obra\\s*:?\\s*)?(?:el\\s+|la\\s+)?(?:${terminos.join("|")})(?![a-z0-9])\\s*[:,\\-]?\\s*`)
    : null;
  for (let linea of partes) {
    // "Rivoria 20 sacos…" o "Para la vuelta: 5 sacos…" → la obra va a la cabecera y se lee el resto.
    const ini = reObraInicial && normalizar(linea).match(reObraInicial);
    if (ini && ini[0].length < linea.length) {
      const resto = linea.slice(ini[0].length);
      const conCantidad = new RegExp(`^${NUM_RE}(?![a-z])`).test(normalizar(resto).replace(/^[\s\-–—:,.]+/, "").replace(PREFIJOS, ""));
      const esCabecera = /^(?:pedido|para|obra)\b/.test(ini[0]);
      // "Pedido La Vuelta — piso 3" es cabecera; "Para la vuelta: 5 sacos" y "Rivoria: cemento 20 sacos" llevan un ítem.
      if (esCabecera && !conCantidad) { cabecera.push(linea); continue; }
      cabecera.push(linea.slice(0, ini[0].length));
      linea = resto;
    }
    const ln = normalizar(linea);
    const pv = ln.match(/^(?:proveedor|prov\.?|comprar en|donde)\s*[:\-]?\s*(.+)$/);
    if (pv) { proveedorTexto = linea.slice(linea.length - pv[1].length).trim(); continue; }
    if (/^(?:pedido|obra|para la obra|para obra)\b/.test(ln)) { cabecera.push(linea); continue; }
    const it = leerItem(linea);
    if (it) items.push(it);
    else if (/^urgente\W*$/.test(ln)) continue;
    else notas.push(linea);
  }

  // La obra se busca en la cabecera y en las líneas que no son ítems (no en las descripciones).
  const obra = detectarObra([...cabecera, ...notas].join(" \n "), obras);
  const proveedor = proveedorTexto ? detectarProveedor(proveedorTexto, proveedores) : null;
  return {
    tipo: items.length || cabecera.length ? "pedido" : "otro",
    obra_id: obra?.id ?? null,
    obra_nombre: obra?.nombre ?? null,
    items,
    proveedor_ruc: proveedor?.ruc ?? null,
    proveedor_texto: proveedorTexto,
    urgente: /\b(urgente|urge|hoy mismo|lo antes posible|asap)\b/.test(n),
    notas: notas.join("\n") || null,
  };
}

const fmtCant = (c) => (Math.round(c * 1000) / 1000).toLocaleString("es-EC");

/** Resumen de ítems para responder por WhatsApp. */
export function resumenItems(items) {
  return items.map((i, k) => `${k + 1}) ${fmtCant(i.cantidad)} ${i.unidad} · ${i.descripcion}`).join("\n");
}

export const AYUDA =
  "Para pedir material escribe la obra en la primera línea y un ítem por línea, por ejemplo:\n\n" +
  "Pedido Turi\n20 sacos cemento\n10 varillas 12 mm\n2 m3 arena\nUrgente\n\n" +
  "Otros mensajes:\n• estado: tus pedidos abiertos\n• anular PD-2026-0007\n" +
  "• recibido OC-2026-0023 (con foto de la guía de remisión)\n" +
  "También puedes mandar la foto de una lista escrita a mano.";
