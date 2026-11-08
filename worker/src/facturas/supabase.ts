// Cliente PostgREST mínimo (sin supabase-js) usando la service key.

export class Supabase {
  constructor(private url: string, private key: string, private fetchFn: typeof fetch = fetch) {}

  private async req<T = any>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
    };
    if (init.prefer) headers.Prefer = init.prefer;
    const r = await this.fetchFn(`${this.url.replace(/\/$/, "")}/rest/v1/${path}`, {
      ...init,
      headers,
    });
    const body = await r.text();
    if (!r.ok) throw new Error(`Supabase ${r.status} ${path.split("?")[0]}: ${body.slice(0, 300)}`);
    return (body ? JSON.parse(body) : null) as T;
  }

  select<T = any>(tabla: string, query: string): Promise<T[]> {
    return this.req<T[]>(`${tabla}?${query}`);
  }

  /** INSERT ... ON CONFLICT DO NOTHING. Devuelve solo las filas realmente insertadas. */
  insertarNuevas<T = any>(tabla: string, filas: object[], conflicto: string): Promise<T[]> {
    if (filas.length === 0) return Promise.resolve([]);
    return this.req<T[]>(`${tabla}?on_conflict=${conflicto}`, {
      method: "POST",
      body: JSON.stringify(filas),
      prefer: "resolution=ignore-duplicates,return=representation",
    });
  }

  upsert(tabla: string, filas: object[], conflicto: string): Promise<null> {
    return this.req(`${tabla}?on_conflict=${conflicto}`, {
      method: "POST",
      body: JSON.stringify(filas),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }

  insertar(tabla: string, filas: object[]): Promise<null> {
    if (filas.length === 0) return Promise.resolve(null);
    return this.req(tabla, { method: "POST", body: JSON.stringify(filas), prefer: "return=minimal" });
  }

  actualizar(tabla: string, filtro: string, datos: object): Promise<null> {
    return this.req(`${tabla}?${filtro}`, {
      method: "PATCH",
      body: JSON.stringify(datos),
      prefer: "return=minimal",
    });
  }

  borrar(tabla: string, filtro: string): Promise<null> {
    return this.req(`${tabla}?${filtro}`, { method: "DELETE", prefer: "return=minimal" });
  }
}
