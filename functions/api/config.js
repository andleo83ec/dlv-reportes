// GET /api/config — entrega a la app la dirección pública de Supabase.
// La "anon key" es pública por diseño; la seguridad la ponen las reglas RLS.
export async function onRequestGet({ env }) {
  return Response.json(
    { supabaseUrl: env.SUPABASE_URL || "", supabaseAnonKey: env.SUPABASE_ANON_KEY || "" },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
