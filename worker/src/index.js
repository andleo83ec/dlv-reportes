// DLV Plataforma — servicio de integraciones (Cloudflare Worker "dlv-integraciones").
//   · Correo: recibe las facturas electrónicas de proveedores (Email Routing → este Worker), las valida en el SRI
//     y las guarda en Supabase y R2.
//   · Cada 15 minutos: reintenta las facturas que el SRI todavía no devolvía.
//   · WhatsApp: recibe pedidos de obra (texto, nota de voz o foto) y confirmaciones de entrega por la API oficial de Meta.
//   · /api/…: lo que usan las pantallas de la plataforma (siempre con la sesión de Supabase del usuario).
// La plataforma llama a /api/… a través de /api/integra/… en Cloudflare Pages (functions/api/integra/[[ruta]].js).
import { claveValida } from "./facturas/clave";
import { conciliar } from "./facturas/conciliar";
import { manejarCorreo } from "./facturas/correo";
import { procesarPendientes, registrarPendientes, sb } from "./facturas/procesar";
import { notificar, procesarMensaje, releer, verificarFirma } from "./whatsapp/whatsapp.js";

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

// Quién llama: valida el token de Supabase y pregunta si es administrador (función es_admin() de la base).
async function usuario(env, req) {
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const r = await fetch(base + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + tok } });
  if (!r.ok) return null;
  const u = await r.json();
  const a = await fetch(base + "/rest/v1/rpc/es_admin", { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: "{}" });
  return { id: u.id, email: u.email, admin: a.ok && (await a.json()) === true };
}

async function api(req, env, p) {
  const u = await usuario(env, req);
  if (!u) return json({ error: "Inicia sesión en la plataforma" }, 401);
  if (p === "/api/estado") {
    return json({
      ok: true, admin: u.admin,
      facturas: { correo: true, ruc: (env.RUC_EMPRESA || "").split(",").map((x) => x.trim()).filter(Boolean) },
      whatsapp: { conectado: !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID), numero: env.WHATSAPP_NUMERO || "" },
      ia: { voz: !!env.AI, fotos: !!env.ANTHROPIC_API_KEY }
    });
  }
  if (!u.admin) return json({ error: "Solo un administrador puede hacer esto" }, 403);

  // ----- facturas del SRI -----
  if (req.method === "POST" && p === "/api/facturas/conciliar") {
    const txt = await req.text();
    if (txt.length > 5_000_000) return json({ error: "El archivo pesa demasiado" }, 413);
    return json(await conciliar(env, txt));
  }
  if (req.method === "POST" && p === "/api/facturas/clave") {
    const { clave } = await req.json().catch(() => ({}));
    if (!clave || !claveValida(String(clave).trim())) return json({ error: "La clave de acceso no es válida (49 dígitos con dígito verificador)" }, 400);
    await registrarPendientes(sb(env), [String(clave).trim()], { origen: "manual" });
    return json(await procesarPendientes(env, 1, [String(clave).trim()]));
  }
  if (req.method === "POST" && p === "/api/facturas/procesar") return json(await procesarPendientes(env));
  const m = p.match(/^\/api\/facturas\/archivo\/(\d{49})\.(xml|pdf)$/);
  if (req.method === "GET" && m) {
    const [fila] = await sb(env).select("facturas_proveedor", `select=xml_key,pdf_key&clave_acceso=eq.${m[1]}`);
    const key = m[2] === "xml" ? fila && fila.xml_key : fila && fila.pdf_key;
    const obj = key ? await env.BUCKET.get(key) : null;
    if (!obj) return json({ error: "Ese archivo no llegó con la factura" }, 404);
    return new Response(obj.body, { headers: { "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || (m[2] === "xml" ? "application/xml" : "application/pdf"), "Cache-Control": "private, max-age=3600" } });
  }

  // ----- WhatsApp -----
  if (req.method === "POST" && p === "/api/whatsapp/notificar") return json(await notificar(env, await req.json()));
  if (req.method === "POST" && p === "/api/whatsapp/transcribir") return json(await releer(env, await req.json()));
  if (req.method === "GET" && p === "/api/whatsapp/media") {
    const key = new URL(req.url).searchParams.get("key") || "";
    if (!key.startsWith("whatsapp/") || key.includes("..")) return json({ error: "Archivo inválido" }, 400);
    const obj = await env.BUCKET.get(key);
    if (!obj) return json({ error: "No encontrado" }, 404);
    return new Response(obj.body, { headers: { "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream", "Cache-Control": "private, max-age=3600" } });
  }
  return json({ error: "Ruta no encontrada" }, 404);
}

export default {
  async email(message, env) {
    try { await manejarCorreo(message, env); }
    catch (e) { console.error("Correo de factura:", e); } // nunca se rechaza: el cron o la conciliación lo recuperan
  },

  async scheduled(_ev, env, ctx) {
    ctx.waitUntil(procesarPendientes(env));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url), p = url.pathname;

    // Webhook de WhatsApp (Meta)
    if (p === "/webhook" && req.method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === env.WHATSAPP_VERIFY_TOKEN;
      return ok ? new Response(url.searchParams.get("hub.challenge") || "") : new Response("Token inválido", { status: 403 });
    }
    if (p === "/webhook" && req.method === "POST") {
      const raw = await req.text();
      if (!(await verificarFirma(env, raw, req.headers.get("X-Hub-Signature-256")))) return new Response("Firma inválida", { status: 401 });
      const body = JSON.parse(raw), tareas = [];
      for (const e of body.entry || []) for (const ch of e.changes || []) {
        const v = ch.value || {};
        const nombres = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile && c.profile.name]));
        for (const m of v.messages || []) tareas.push(procesarMensaje(env, m, nombres[m.from]).catch((err) => console.error("WhatsApp:", err)));
      }
      ctx.waitUntil(Promise.all(tareas)); // se responde rápido a Meta; el trabajo sigue en segundo plano
      return new Response("ok");
    }

    if (p.startsWith("/api/")) {
      try { return await api(req, env, p); }
      catch (e) { return json({ error: String((e && e.message) || e) }, 500); }
    }
    return new Response("DLV integraciones: correo de facturas del SRI y pedidos por WhatsApp.", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
};
