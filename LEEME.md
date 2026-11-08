# DLV Plataforma (Cloudflare Pages)

Plataforma web interna de DLV Construcciones: portal de inicio con el menú de programas, reporte diario de obra (formato DLV-FOR-RDO-01) y visor 3D de avance.

| Dirección | Programa |
|---|---|
| `/` | Portal: menú de programas y estado de los reportes del día |
| `/reportes` | Reporte diario de obra |
| `/visor` | Visor 3D y avance (modelo IFC) |
| `/planillas` | Estado de pago: presupuesto por obra y planillas al mandante con PDF |
| `/subcontratos` | Subcontratos y garantías: contratos, planillas de subcontratistas, pólizas y evaluación |
| `/rdi` | RDI, actas de reunión con seguimiento de acuerdos y registro de correspondencia |

| Carpeta | Qué es | Dónde se usa |
|---|---|---|
| `public/` | La app (pantallas, PDF, íconos) | Cloudflare Pages la publica |
| `functions/api/` | Funciones del servidor (configuración, fotos y modelos IFC) | Cloudflare Pages las ejecuta |
| `supabase/schema.sql` | Tablas, usuarios y permisos | Se pega una vez en Supabase → SQL Editor |
| `supabase/portal.sql` | Menú de programas del portal | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
| `supabase/planillas.sql` | Presupuesto (rubros) y planillas del estado de pago | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
| `supabase/subcontratos.sql` | Subcontratos, sus planillas y garantías | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
| `supabase/rdi.sql` | RDI, actas y correspondencia | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
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

## Agregar un programa al menú

En el portal (`/`), un administrador toca **Administrar** y luego **Agregar programa**:

- **Programa de esta misma plataforma:** su página va en `public/` (por ejemplo `public/hierro.html`) y en el menú se registra con la dirección `/hierro`. Comparte el login y la base de datos.
- **Programa en otro repositorio o servidor** (Vercel, otra app de Cloudflare, una web): se registra con su dirección completa `https://…` y se abre en otra pestaña.
- **Programa en desarrollo:** estado «En desarrollo» y sin dirección; aparece en el menú, atenuado y sin enlace.

Los cambios del menú se ven al instante para todos, sin publicar código. Los programas marcados «Solo administradores» no aparecen a los residentes.

## Estado de pago (`/planillas`)

1. En Supabase → SQL Editor, ejecuta `supabase/planillas.sql` (una sola vez).
2. **Presupuesto:** el admin copia desde Excel las columnas Código · Descripción · Unidad · Cantidad · Precio unitario y las pega. Las filas sin cantidad ni precio quedan como capítulos. Reconoce números con coma decimal (1.234,56) o punto decimal (1,234.56).
3. **Obras adicionales:** se agregan como rubros marcados «Adicional»; suman aparte del contrato.
4. **Planilla:** cantidad del período por rubro; calcula anterior, acumulado, % de avance, amortización del anticipo, fondo de garantía, multas, IVA y líquido a pagar. Avisa si un rubro supera la cantidad contratada.
5. **Estados:** Borrador → Presentada → Aprobada → Pagada. Fuera de borrador las cantidades quedan bloqueadas. Solo el admin aprueba, marca pagada o borra.
6. **PDF** A4 horizontal: carátula con resumen y firmas (DLV, fiscalización, mandante) y detalle por rubro.

## Subcontratos y garantías (`/subcontratos`)

1. En Supabase → SQL Editor, ejecuta `supabase/subcontratos.sql` (activa también el programa en el menú).
2. **Contrato:** datos del subcontratista, alcance, rubros (a mano, pegados desde Excel o traídos del presupuesto de la obra con el precio del subcontratista), condiciones de pago y la revisión antes de firmar (10 puntos).
3. **Planillas del subcontratista:** como el estado de pago, pero además descuenta el fondo de garantía y las retenciones de renta e IVA (DLV como agente de retención). PDF con carátula, balance del contrato, liquidación y firmas.
4. **Garantías y pólizas:** las que entregan los subcontratistas y las que DLV entrega al mandante. Semáforo de vencimiento; las que vencen en 30 días o ya vencieron aparecen como alerta en el portal.
5. **Evaluación al cierre:** calidad, plazos, seguridad, orden y documentación (1 a 5) y si se le volvería a contratar.

Los montos se escriben como en Ecuador: `3.096` es tres mil noventa y seis y `1,75` es uno coma setenta y cinco.

## RDI, actas y correspondencia (`/rdi`)

1. En Supabase → SQL Editor, ejecuta `supabase/rdi.sql` (activa también el programa en el menú).
2. **RDI:** asunto, a quién va dirigido, referencia (plano o eje), consulta, propuesta de DLV, hasta 4 fotos y fecha límite de respuesta. Semáforo: abierto, por vencer, vencido, respondido. Al registrar la respuesta se marca el impacto en costo o plazo. PDF con espacio para la respuesta y firmas.
3. **Actas:** asistentes (se pueden copiar de la última acta), temas tratados y acuerdos con responsable, plazo y estado. El acta muestra los pendientes de actas anteriores. PDF con columna de firma para cada asistente.
4. **Acuerdos:** todos los acuerdos sin cumplir de la obra, ordenados por plazo; se marcan cumplidos con un toque.
5. **Oficios:** registro de correspondencia enviada (OF-001…) y recibida (REC-001…), con plazo cuando espera respuesta y dónde está el original.

El portal avisa cuando hay RDI sin respuesta o acuerdos de actas fuera de plazo.
