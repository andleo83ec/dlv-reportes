# DLV Reportes (Cloudflare Pages)

App web del reporte diario de obra de DLV Construcciones (formato DLV-FOR-RDO-01).

| Carpeta | Qué es | Dónde se usa |
|---|---|---|
| `public/` | La app (pantallas, PDF, íconos) | Cloudflare Pages la publica |
| `functions/api/` | Funciones del servidor (configuración y fotos) | Cloudflare Pages las ejecuta |
| `supabase/schema.sql` | Tablas, usuarios y permisos | Se pega una vez en Supabase → SQL Editor |

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
