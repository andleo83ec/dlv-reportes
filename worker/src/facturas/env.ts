// Tipos mínimos para no depender de @cloudflare/workers-types al leer el código.

export interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
}

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string; // secreto
  API_TOKEN: string; // secreto: protege la página y la API
  RUC_EMPRESA: string; // uno o varios RUC separados por coma (receptores válidos)
  FORWARD_TO?: string; // opcional: reenviar cada correo a una persona (dirección verificada)
  BUCKET: R2Like;
}

export function rucsEmpresa(env: Env): string[] {
  return env.RUC_EMPRESA.split(",").map((r) => r.trim()).filter(Boolean);
}
