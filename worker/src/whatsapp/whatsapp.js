// WhatsApp de la plataforma DLV: recibe pedidos de obra por WhatsApp (Cloud API de Meta) y los registra en Supabase.
import { AYUDA, detectarObra, interpretar, resumenItems } from "./parser.js";

/* ---------------- utilidades ---------------- */
const hoyEC = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const fechaEC = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const json = (d, status = 200, extra = {}) =>
  new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...extra } });

const F = (env) => env.FETCH ?? fetch; // la demo inyecta su propio fetch

export function db(env, fetchFn = F(env)) {
  const base = env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/";
  const headers = (prefer) => ({
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  });
  const req = async (path, init) => {
    const r = await fetchFn(base + path, init);
    const t = await r.text();
    if (!r.ok) throw new Error(`Supabase ${r.status} ${path.split("?")[0]}: ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  };
  return {
    sel: (t, q = "") => req(`${t}?${q}`, { headers: headers() }),
    ins: (t, rows, { ignorar, conflicto } = {}) =>
      req(`${t}${conflicto ? `?on_conflict=${conflicto}` : ""}`, {
        method: "POST",
        headers: headers(`return=representation${ignorar ? ",resolution=ignore-duplicates" : ""}`),
        body: JSON.stringify(rows),
      }),
    upd: (t, filtro, patch) => req(`${t}?${filtro}`, { method: "PATCH", headers: headers("return=minimal"), body: JSON.stringify(patch) }),
  };
}

/* ---------------- WhatsApp Cloud API ---------------- */
const graph = (env, path) => `https://graph.facebook.com/${env.GRAPH_VERSION || "v23.0"}/${path}`;

export async function verificarFirma(env, raw, firma) {
  if (!env.WHATSAPP_APP_SECRET || !firma?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.WHATSAPP_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const dada = firma.slice(7);
  if (dada.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ dada.charCodeAt(i);
  return diff === 0;
}

async function enviar(env, D, to, texto, extra = {}) {
  let error = null, codigo = null;
  try {
    const r = await F(env)(graph(env, `${env.WHATSAPP_PHONE_NUMBER_ID}/messages`), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: texto.slice(0, 4000), preview_url: false } }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      codigo = e?.error?.code ?? r.status;
      error = e?.error?.message ?? `HTTP ${r.status}`;
    }
  } catch (e) { error = String(e?.message ?? e); }
  await D.ins("whatsapp_mensajes", [{ direccion: "salida", telefono: to, tipo: "text", texto, error, ...extra }]).catch(() => {});
  return { ok: !error, error, codigo };
}

async function bajarMedia(env, mediaId) {
  const meta = await F(env)(graph(env, mediaId), { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } }).then((r) => r.json());
  if (!meta?.url) throw new Error("Media sin URL");
  if (meta.file_size && meta.file_size > 15_000_000) throw new Error("Archivo demasiado grande");
  const bin = await F(env)(meta.url, { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } }).then((r) => r.arrayBuffer());
  return { datos: bin, mime: meta.mime_type || "application/octet-stream" };
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a" };

function aBase64(buf) {
  let b = "";
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(b);
}

/* ---------------- notas de voz: Whisper en Workers AI ---------------- */
export async function transcribirAudio(env, datos, obras = []) {
  if (!env.AI || !datos?.byteLength || datos.byteLength > 20_000_000) return null;
  try {
    const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
      audio: aBase64(datos),
      language: "es",
      // Vocabulario de obra para que reconozca bien nombres y unidades.
      initial_prompt: `Pedido de materiales de construcción en Cuenca, Ecuador. Obras: ${obras.map((o) => o.nombre).join(", ")}. ` +
        "Sacos de cemento, varillas de 12 mm, metros cúbicos de arena y ripio, bloques, canecas, rollos, OC-2026-0023, PD-2026-0007.",
    });
    const t = (r?.text ?? "").trim();
    return t || null;
  } catch { return null; }
}

/* ---------------- Claude: fotos de listas a mano y mensajes o audios desordenados ---------------- */
export async function leerConClaude(env, { texto, imagen, mime, obras }) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const instr =
    "Eres asistente de compras de una constructora en Ecuador. Del mensaje de obra (y la imagen si hay), extrae el pedido de materiales. " +
    `Obras posibles: ${obras.map((o) => o.nombre).join(", ")}. ` +
    'Responde SOLO JSON: {"texto": "lo que dice la imagen, transcrito línea por línea (null si no hay imagen)", "obra": "nombre exacto o null", ' +
    '"items": [{"cantidad": número, "unidad": "u|saco|m³|m²|m|kg|gl|rollo|caja|qq|viaje|...", "descripcion": "texto"}], "urgente": bool, "notas": "texto o null"}. ' +
    "Si no es un pedido de materiales, items vacío. No inventes ítems que no estén escritos; si una cantidad no se entiende, no incluyas ese ítem y menciónalo en notas.";
  const content = [];
  if (imagen && /^image\/(jpeg|png|webp|gif)$/.test(mime)) content.push({ type: "image", source: { type: "base64", media_type: mime, data: aBase64(imagen) } });
  content.push({ type: "text", text: `${instr}\n\nMensaje:\n${texto || "(sin texto, ver imagen)"}` });
  try {
    const r = await F(env)("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 2000, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) return null;
    const out = (await r.json())?.content?.find((c) => c.type === "text")?.text ?? "";
    const j = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    const items = (j.items || [])
      .map((i) => ({ cantidad: +i.cantidad, unidad: String(i.unidad || "u").slice(0, 12), descripcion: String(i.descripcion || "").trim().slice(0, 200) }))
      .filter((i) => i.cantidad > 0 && i.descripcion);
    const obra = j.obra ? detectarObra(j.obra, obras) : null;
    return { items, obra_id: obra?.id ?? null, urgente: !!j.urgente, notas: j.notas || null, texto: typeof j.texto === "string" ? j.texto.trim() || null : null };
  } catch { return null; }
}

/**
 * Lee un mensaje: texto + (nota de voz → Whisper) + (foto → Claude). Devuelve el comando interpretado.
 * fuente: "texto" | "voz" | "foto" — de dónde salieron los ítems.
 */
export async function leerAdjunto(env, { texto, datos, mime, audio, foto, M }) {
  let transcripcion = null;
  if (audio && datos) transcripcion = await transcribirAudio(env, datos, M.obras);
  const efectivo = [texto, transcripcion].filter(Boolean).join("\n");
  let cmd = interpretar(efectivo, M), fuente = audio && transcripcion ? "voz" : "texto";

  // Sin ítems claros (mensaje desordenado, audio enredado o foto): se intenta con Claude.
  if ((cmd.tipo === "otro" || cmd.tipo === "vacio" || (cmd.tipo === "pedido" && !cmd.items.length)) && (efectivo || foto)) {
    const c = await leerConClaude(env, { texto: efectivo, imagen: foto ? datos : null, mime, obras: M.obras });
    if (foto && c?.texto) transcripcion = c.texto;
    if (c?.items.length) {
      cmd = { ...cmd, tipo: "pedido", items: c.items, obra_id: cmd.obra_id ?? c.obra_id, urgente: cmd.urgente || c.urgente,
        notas: [cmd.notas, c.notas].filter(Boolean).join("\n") || null, leido_por_ia: true };
      fuente = foto ? "foto" : audio ? "voz" : "texto";
    }
  }
  return { cmd, transcripcion, fuente };
}

/* ---------------- lógica de negocio ---------------- */
const ETAPA_TXT = { pedido: "por aprobar", cotizacion: "en cotización", comparativo: "en comparativo", orden: "orden por emitir", entrega: "esperando entrega", factura: "entregado, falta factura", cerrado: "cerrado", rechazado: "no aprobado" };

async function maestros(D) {
  const [obras, proveedores] = await Promise.all([
    D.sel("obras", "select=id,nombre,alias&activa=eq.true"),
    D.sel("proveedores", "select=ruc,razon_social"),
  ]);
  return { obras, proveedores };
}

function titulo(items, conAdjunto) {
  if (!items.length) return conAdjunto ? "Pedido por WhatsApp (por transcribir)" : "Pedido por WhatsApp";
  const n = items.slice(0, 3).map((i) => i.descripcion.split(" ").slice(0, 3).join(" "));
  return "Pedido de obra: " + n.join(", ") + (items.length > 3 ? ` y ${items.length - 3} más` : "");
}

async function crearOAmpliarPedido(env, D, { usuario, tel, cmd, mediaKey, deFoto, msgId }) {
  const desde = new Date(Date.now() - 15 * 60e3).toISOString();
  const [abierto] = await D.sel(
    "compras_requerimientos",
    `select=id,numero,notas_pedido&tipo=eq.directo&origen=eq.whatsapp&etapa=eq.pedido&solicitado_tel=eq.${tel}` +
      `&obra_id=eq.${cmd.obra_id}&created_at=gte.${desde}&order=created_at.desc&limit=1`,
  );
  let req, nuevo = !abierto;
  if (abierto) {
    req = abierto;
    const prev = await D.sel("compras_req_items", `select=linea&requerimiento_id=eq.${req.id}`);
    const base = Math.max(0, ...prev.map((p) => p.linea));
    if (cmd.items.length)
      await D.ins("compras_req_items", cmd.items.map((i, k) => ({ requerimiento_id: req.id, linea: base + k + 1, ...i })));
    const extra = [cmd.notas, mediaKey ? (deFoto ? "Foto adjunta" : "Nota de voz adjunta") : null].filter(Boolean).join("\n");
    const patch = {};
    if (extra) patch.notas_pedido = [req.notas_pedido, extra].filter(Boolean).join("\n");
    if (cmd.urgente) patch.urgente = true;
    if (cmd.proveedor_ruc) patch.proveedor_sugerido = cmd.proveedor_ruc;
    if (Object.keys(patch).length) await D.upd("compras_requerimientos", `id=eq.${req.id}`, patch);
  } else {
    [req] = await D.ins("compras_requerimientos", [{
      tipo: "directo", origen: "whatsapp", obra_id: cmd.obra_id, titulo: titulo(cmd.items, !!mediaKey), fecha: hoyEC(),
      etapa: "pedido", solicitado_por: usuario.nombre, solicitado_tel: tel, urgente: !!cmd.urgente,
      proveedor_sugerido: cmd.proveedor_ruc || null,
      notas_pedido: [cmd.notas, cmd.proveedor_texto && !cmd.proveedor_ruc ? `Proveedor sugerido: ${cmd.proveedor_texto}` : null].filter(Boolean).join("\n") || null,
      creado_por: `WhatsApp · ${usuario.nombre}`,
    }]);
    if (cmd.items.length)
      await D.ins("compras_req_items", cmd.items.map((i, k) => ({ requerimiento_id: req.id, linea: k + 1, ...i })));
  }
  await D.upd("whatsapp_mensajes", `wa_id=eq.${msgId}`, { requerimiento_id: req.id, resultado: nuevo ? "pedido_creado" : "pedido_ampliado" });
  return { req, nuevo };
}

async function registrarRecepcion(env, D, { usuario, tel, cmd, mediaKey, msgId }) {
  const permitidas = (o) => !usuario.obra_id || o.obra_id === usuario.obra_id;
  let orden;
  if (cmd.numero) {
    [orden] = await D.sel("compras_ordenes", `select=*&numero=eq.${cmd.numero}`);
    if (!orden || !permitidas(orden)) return `No encuentro la orden ${cmd.numero} en tus obras. Revisa el número.`;
  } else {
    const abiertas = (await D.sel("compras_ordenes", "select=*&estado=in.(emitida,parcial)&order=numero.desc&limit=20")).filter(permitidas);
    if (abiertas.length !== 1)
      return abiertas.length
        ? `¿Qué orden llegó? Responde por ejemplo "recibido ${abiertas[0].numero}". Abiertas:\n${abiertas.slice(0, 6).map((o) => "• " + o.numero).join("\n")}`
        : "No tienes órdenes pendientes de entrega.";
    orden = abiertas[0];
  }
  if (!["emitida", "parcial"].includes(orden.estado))
    return `La orden ${orden.numero} está ${orden.estado === "recibida" || orden.estado === "facturada" ? "ya recibida" : orden.estado}. No registré nada.`;

  await D.upd("whatsapp_mensajes", `wa_id=eq.${msgId}`, { orden_id: orden.id, requerimiento_id: orden.requerimiento_id });
  if (cmd.parcial) {
    await D.upd("whatsapp_mensajes", `wa_id=eq.${msgId}`, { resultado: "recepcion_parcial_pendiente" });
    return `Entendido, entrega parcial de ${orden.numero}. Registra las cantidades en la app para no equivocarnos:\n${env.APP_URL || ""}#p-${orden.requerimiento_id}` +
      (mediaKey ? "\nLa foto de la guía quedó guardada." : "");
  }

  const items = await D.sel("compras_orden_items", `select=*&orden_id=eq.${orden.id}&order=linea.asc`);
  const ents = await D.sel("compras_entregas", `select=id&orden_id=eq.${orden.id}`);
  const ei = ents.length ? await D.sel("compras_entrega_items", `select=*&entrega_id=in.(${ents.map((e) => e.id).join(",")})`) : [];
  const pend = items
    .map((i) => ({ i, p: +i.cantidad - ei.filter((x) => x.orden_item_id === i.id).reduce((a, x) => a + +x.cantidad_recibida, 0) }))
    .filter((x) => x.p > 1e-9);
  const [ge] = await D.ins("compras_entregas", [{
    orden_id: orden.id, fecha: hoyEC(), recibido_por: usuario.nombre, guia_remision: cmd.guia, foto_key: mediaKey,
    origen: "whatsapp", observaciones: "Registrado por WhatsApp como entrega completa",
  }]);
  if (pend.length) await D.ins("compras_entrega_items", pend.map((x) => ({ entrega_id: ge.id, orden_item_id: x.i.id, cantidad_recibida: x.p, cantidad_rechazada: 0 })));
  await D.upd("compras_ordenes", `id=eq.${orden.id}`, { estado: "recibida" });
  const otras = await D.sel("compras_ordenes", `select=estado&requerimiento_id=eq.${orden.requerimiento_id}&estado=in.(borrador,emitida,parcial)`);
  if (!otras.length) await D.upd("compras_requerimientos", `id=eq.${orden.requerimiento_id}`, { etapa: "factura" });
  await D.upd("whatsapp_mensajes", `wa_id=eq.${msgId}`, { resultado: "recepcion" });
  return `✅ Recepción ${ge.numero} registrada para ${orden.numero}:\n${pend.map((x) => `• ${x.p} ${x.i.unidad} ${x.i.descripcion}`).join("\n")}` +
    (cmd.guia ? `\nGuía de remisión ${cmd.guia}` : mediaKey ? "\nFoto de la guía guardada." : "\nSi tienes la guía de remisión, mándame la foto con el texto: recibido " + orden.numero);
}

export async function procesarMensaje(env, msg, nombrePerfil) {
  const D = db(env);
  const tel = msg.from;
  const texto = msg.text?.body ?? msg.image?.caption ?? msg.document?.caption ?? msg.interactive?.button_reply?.title ?? "";

  const ins = await D.ins("whatsapp_mensajes", [{ wa_id: msg.id, direccion: "entrada", telefono: tel, nombre: nombrePerfil ?? null, tipo: msg.type, texto: texto || null }], { ignorar: true, conflicto: "wa_id" });
  if (!ins?.length) return "duplicado";

  const [usuario] = await D.sel("whatsapp_usuarios", `select=*&telefono=eq.${tel}&activo=eq.true`);
  if (!usuario) {
    await D.upd("whatsapp_mensajes", `wa_id=eq.${msg.id}`, { resultado: "no_autorizado" });
    const ayer = new Date(Date.now() - 864e5).toISOString();
    const yaAvisado = await D.sel("whatsapp_mensajes", `select=id&direccion=eq.salida&telefono=eq.${tel}&resultado=eq.no_autorizado&created_at=gte.${ayer}&limit=1`);
    if (!yaAvisado.length) await enviar(env, D, tel, "Este número no está registrado para enviar pedidos a DLV Construcciones. Pide a compras que lo agregue.", { resultado: "no_autorizado" });
    return "no_autorizado";
  }

  let mediaKey = null, media = null;
  const m = msg.image || msg.document || msg.audio;
  if (m?.id) {
    try {
      media = await bajarMedia(env, m.id);
      const [a, mes] = hoyEC().split("-");
      mediaKey = `whatsapp/${tel}/${a}/${mes}/${msg.id}.${EXT[media.mime] || "bin"}`;
      await env.BUCKET.put(mediaKey, media.datos, { httpMetadata: { contentType: media.mime } });
      await D.upd("whatsapp_mensajes", `wa_id=eq.${msg.id}`, { media_key: mediaKey, media_tipo: media.mime });
    } catch (e) {
      await D.upd("whatsapp_mensajes", `wa_id=eq.${msg.id}`, { error: "media: " + String(e?.message ?? e) });
    }
  }

  const M = await maestros(D);
  const deFoto = !!(msg.image || (msg.document && /^image\//.test(media?.mime || "")));
  const esAudio = !!msg.audio;
  let { cmd, transcripcion, fuente } = await leerAdjunto(env, { texto, datos: media?.datos, mime: media?.mime, audio: esAudio, foto: deFoto, M });
  if (transcripcion) await D.upd("whatsapp_mensajes", `wa_id=eq.${msg.id}`, { transcripcion });
  // Foto o nota de voz sin texto útil: queda como pedido por transcribir.
  if ((cmd.tipo === "otro" || cmd.tipo === "vacio") && mediaKey && !msg.document?.mime_type?.includes("pdf")) cmd = { tipo: "pedido", items: [], obra_id: null, urgente: false, notas: null };

  let respuesta, resultado = cmd.tipo;
  switch (cmd.tipo) {
    case "ayuda":
      respuesta = `Hola ${usuario.nombre.split(" ")[0]}. ${AYUDA}`;
      break;
    case "estado": {
      const reqs = await D.sel("compras_requerimientos", `select=id,numero,titulo,etapa&solicitado_tel=eq.${tel}&etapa=not.in.(cerrado,rechazado)&order=created_at.desc&limit=6`);
      const ocs = reqs.length ? await D.sel("compras_ordenes", `select=numero,requerimiento_id,fecha_entrega,estado&requerimiento_id=in.(${reqs.map((r) => r.id).join(",")})&estado=neq.anulada`) : [];
      respuesta = reqs.length
        ? "Tus pedidos abiertos:\n" + reqs.map((r) => `• ${r.numero}: ${ETAPA_TXT[r.etapa] || r.etapa}` + ocs.filter((o) => o.requerimiento_id === r.id).map((o) => `\n   ${o.numero} entrega ${fechaEC(o.fecha_entrega)}`).join("")).join("\n")
        : "No tienes pedidos abiertos.";
      break;
    }
    case "anular": {
      const [r] = cmd.numero ? await D.sel("compras_requerimientos", `select=id,numero,etapa&numero=eq.${cmd.numero}&solicitado_tel=eq.${tel}`) : [];
      if (!r) respuesta = "Escribe el número del pedido, por ejemplo: anular PD-2026-0007";
      else if (r.etapa !== "pedido") respuesta = `${r.numero} ya fue procesado por compras; llama a la oficina para cambiarlo.`;
      else {
        await D.upd("compras_requerimientos", `id=eq.${r.id}`, { etapa: "rechazado", motivo_rechazo: "Anulado por el solicitante" });
        respuesta = `Pedido ${r.numero} anulado.`;
      }
      break;
    }
    case "recibido":
      respuesta = (esAudio && transcripcion ? `🎙️ Escuché: «${transcripcion.slice(0, 300)}»\n\n` : "") +
        await registrarRecepcion(env, D, { usuario, tel, cmd, mediaKey, msgId: msg.id });
      resultado = null;
      break;
    case "pedido": {
      cmd.obra_id ??= usuario.obra_id;
      if (!cmd.obra_id) {
        respuesta = `¿Para qué obra es el pedido? Reenvíalo con la obra en la primera línea, por ejemplo "Pedido ${M.obras[0]?.nombre.split(" ").pop() ?? "Turi"}".\nObras: ${M.obras.map((o) => o.nombre).join(", ")}`;
        resultado = "falta_obra";
        break;
      }
      const { req, nuevo } = await crearOAmpliarPedido(env, D, { usuario, tel, cmd, mediaKey, deFoto, msgId: msg.id });
      const obra = M.obras.find((o) => o.id === cmd.obra_id)?.nombre ?? "";
      const escuche = esAudio && transcripcion ? `🎙️ Escuché: «${transcripcion.slice(0, 600)}»\n\n` : "";
      if (!cmd.items.length)
        respuesta = escuche + `📝 Recibí tu ${deFoto ? "foto" : esAudio ? "nota de voz" : "mensaje"} para ${obra}: ${req.numero}. ` +
          (escuche ? "No identifiqué cantidades claras; compras lo revisará y te avisará." : "Compras transcribirá los ítems y te avisará.");
      else
        respuesta = escuche + `${nuevo ? "✅ Pedido" : "➕ Agregué al pedido"} ${req.numero} · ${obra}${cmd.urgente ? " · URGENTE" : ""}\n${resumenItems(cmd.items)}` +
          (fuente === "foto" ? "\n(Leído de tu foto; revisa que esté bien.)" : fuente === "voz" ? "\n(Tomado de tu nota de voz; revisa que esté bien.)" : cmd.leido_por_ia ? "\n(Interpretado de tu mensaje; revisa que esté bien.)" : "") +
          `\n\nCompras lo revisará y te aviso cuando salga la orden. Si algo está mal: anular ${req.numero}`;
      resultado = null;
      break;
    }
    default:
      respuesta = "No identifiqué un pedido en tu mensaje.\n\n" + AYUDA;
      resultado = "no_entendido";
  }
  if (resultado) await D.upd("whatsapp_mensajes", `wa_id=eq.${msg.id}`, { resultado });
  if (respuesta) {
    // La respuesta queda ligada al mismo pedido u orden que el mensaje recibido.
    const [fila] = await D.sel("whatsapp_mensajes", `select=requerimiento_id,orden_id&wa_id=eq.${msg.id}`);
    await enviar(env, D, tel, respuesta, { resultado: "respuesta", requerimiento_id: fila?.requerimiento_id ?? null, orden_id: fila?.orden_id ?? null });
  }
  return cmd.tipo;
}

/* ---------------- avisos desde la app (aprobado / rechazado / a cotización) ---------------- */
async function usuarioApp(env, req) {
  const tok = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  const r = await F(env)(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${tok}` } });
  return r.ok ? r.json() : null;
}

export async function notificar(env, { requerimiento_id, evento }) {
  const D = db(env);
  const [r] = await D.sel("compras_requerimientos", `select=*&id=eq.${requerimiento_id}`);
  if (!r?.solicitado_tel) return { ok: false, motivo: "sin_telefono" };
  let texto;
  if (evento === "aprobado") {
    const ocs = await D.sel("compras_ordenes", `select=numero,proveedor_ruc,fecha_entrega,total&requerimiento_id=eq.${r.id}&estado=neq.anulada`);
    const provs = ocs.length ? await D.sel("proveedores", `select=ruc,razon_social&ruc=in.(${ocs.map((o) => o.proveedor_ruc).join(",")})`) : [];
    texto = `✅ Tu pedido ${r.numero} fue aprobado.\n` + ocs.map((o) => `${o.numero} · ${provs.find((p) => p.ruc === o.proveedor_ruc)?.razon_social ?? o.proveedor_ruc} · entrega ${fechaEC(o.fecha_entrega)}`).join("\n") +
      `\nCuando llegue el material responde: recibido ${ocs[0]?.numero ?? ""} (con foto de la guía de remisión).`;
  } else if (evento === "rechazado") texto = `❌ Tu pedido ${r.numero} no fue aprobado.${r.motivo_rechazo ? " Motivo: " + r.motivo_rechazo : ""}`;
  else if (evento === "cotizacion") texto = `Tu pedido ${r.numero} pasa a cotización con proveedores. Te aviso cuando se emita la orden.`;
  else return { ok: false, motivo: "evento_invalido" };
  const res = await enviar(env, D, r.solicitado_tel, texto, { requerimiento_id: r.id, resultado: "aviso_" + evento });
  // 131047: pasaron más de 24 h desde el último mensaje del residente; hace falta una plantilla aprobada.
  return res.ok ? { ok: true } : { ok: false, motivo: res.codigo === 131047 ? "ventana_24h" : "error", detalle: res.error };
}

/**
 * Vuelve a leer la foto o nota de voz de un mensaje (por ejemplo, si al llegar no estaba configurada la IA)
 * y agrega los ítems a su pedido si sigue por aprobar.
 */
export async function releer(env, { wa_id }) {
  const D = db(env);
  const [m] = await D.sel("whatsapp_mensajes", `select=*&wa_id=eq.${wa_id}&direccion=eq.entrada`);
  if (!m?.media_key) return { ok: false, motivo: "sin_adjunto" };
  const obj = await env.BUCKET.get(m.media_key);
  if (!obj) return { ok: false, motivo: "archivo_no_encontrado" };
  const datos = await new Response(obj.body).arrayBuffer();
  const mime = m.media_tipo || obj.httpMetadata?.contentType || "";
  const M = await maestros(D);
  const { cmd, transcripcion } = await leerAdjunto(env, { texto: m.texto, datos, mime, audio: /^audio\//.test(mime), foto: /^image\//.test(mime), M });
  if (transcripcion) await D.upd("whatsapp_mensajes", `wa_id=eq.${wa_id}`, { transcripcion });
  let agregados = 0;
  if (m.requerimiento_id && cmd.tipo === "pedido" && cmd.items.length) {
    const [r] = await D.sel("compras_requerimientos", `select=id,etapa,titulo&id=eq.${m.requerimiento_id}`);
    if (r?.etapa === "pedido") {
      const prev = await D.sel("compras_req_items", `select=linea&requerimiento_id=eq.${r.id}`);
      const base = Math.max(0, ...prev.map((p) => p.linea));
      await D.ins("compras_req_items", cmd.items.map((i, k) => ({ requerimiento_id: r.id, linea: base + k + 1, ...i })));
      if (/^Pedido por WhatsApp/.test(r.titulo)) await D.upd("compras_requerimientos", `id=eq.${r.id}`, { titulo: titulo(cmd.items, false) });
      agregados = cmd.items.length;
    }
  }
  return { ok: !!(transcripcion || agregados), transcripcion, agregados, motivo: transcripcion || agregados ? null : env.AI || env.ANTHROPIC_API_KEY ? "no_legible" : "ia_no_configurada" };
}

// El enrutador está en src/index.js (servicio de integraciones de la plataforma).
