# DLV Reportes (Cloudflare Pages)

App web del reporte diario de obra de DLV Construcciones (formato DLV-FOR-RDO-01).

| Carpeta | Qué es | Dónde se usa |
|---|---|---|
| `public/` | La app (pantallas, PDF, íconos) | Cloudflare Pages la publica |
| `functions/api/` | Funciones del servidor (configuración, fotos y modelos IFC) | Cloudflare Pages las ejecuta |
| `supabase/schema.sql` | Tablas, usuarios y permisos | Se pega una vez en Supabase → SQL Editor |
| `supabase/avance_bim.sql` | Tablas del visor 3D (modelos y avance por elemento) | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |

## Configuración en Cloudflare Pages

- Build command: (vacío)
- Build output directory: `public`
- Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- Vínculo R2: nombre `FOTOS` → bucket `dlv-fotos`

## Hacerte administrador (Supabase → SQL Editor)

```sql
update public.perfiles set rol = 'admin' where email = 'tu-correo@ejemplo.com';
```

La guía completa está en el documento "Guía de instalación DLV Reportes".

## Visor 3D y avance de obra (`/visor.html`)

1. En Supabase → SQL Editor, pega y ejecuta `supabase/avance_bim.sql` (una sola vez).
2. En la app, en la tarjeta de la obra, toca **Visor 3D y avance** y sube el IFC exportado desde ArchiCAD.
   Se guarda comprimido en el mismo bucket R2 (`obras/<obra>/modelos/`), hasta 95 MB.
3. Toca elementos del modelo y registra su estado (no iniciado, en ejecución con %, terminado, observado) con nota y hasta 4 fotos.
4. En el reporte diario, la sección **3D · Avance en el modelo** muestra lo registrado en la fecha del reporte.
   **Pasar al reporte** agrega cada registro como actividad (con m³), sus fotos al panel fotográfico y los observados a novedades.

El avance se guarda por GUID de cada elemento, así que una nueva exportación del mismo proyecto de ArchiCAD conserva lo registrado.
