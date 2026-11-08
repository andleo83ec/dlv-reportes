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
| `/tablero` | Tablero gerencial de todas las obras e informe semanal en PDF |
| `/ciclo` | Inicio y cierre de obra: listas de arranque y cierre, recepción, balance final y encuesta al cliente |
| `/costos` | Control de costos por obra: gastos reales, presupuesto meta, margen a la fecha y proyectado, caja |
| `/personal` | Personal: trabajadores, asistencia diaria, avisos de entrada al IESS y roles de pago |
| `/documentos` | Control de documentos: listado maestro, versiones con archivo, revisiones y acuse de lectura |
| `/compras` | Compras: pedido de obra o cotización, comparativo, orden de pedido, recepción y factura |
| `/propuestas` | Estudio de propuestas: presupuesto de oferta, cotizaciones, efectividad comercial y adjudicación (solo admin) |

| Carpeta | Qué es | Dónde se usa |
|---|---|---|
| `public/` | La app (pantallas, PDF, íconos) | Cloudflare Pages la publica |
| `functions/api/` | Funciones del servidor (configuración, fotos y modelos IFC) | Cloudflare Pages las ejecuta |
| `supabase/instalar_todo.sql` | **Todo junto, en orden** (base + todos los módulos) | Se pega una sola vez en Supabase → SQL Editor; se puede repetir sin perder datos |
| `supabase/schema.sql` | Tablas, usuarios y permisos | Se pega una vez en Supabase → SQL Editor |
| `supabase/portal.sql` | Menú de programas del portal | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
| `supabase/planillas.sql` | Presupuesto (rubros) y planillas del estado de pago | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
| `supabase/subcontratos.sql` | Subcontratos, sus planillas y garantías | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
| `supabase/rdi.sql` | RDI, actas y correspondencia | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
| `supabase/tablero.sql` | Activa el tablero en el menú (no crea tablas) | Se pega una vez en Supabase → SQL Editor |
| `supabase/propuestas.sql` | Propuestas y cotizaciones (solo administradores) | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
| `supabase/ciclo.sql` | Inicio y cierre de obra | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
| `supabase/costos.sql` | Control de costos por obra | Se pega una vez en Supabase → SQL Editor, después de `planillas.sql` |
| `supabase/personal.sql` | Personal y roles de pago | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
| `supabase/documentos.sql` | Control de documentos | Se pega una vez en Supabase → SQL Editor, después de `schema.sql` |
| `supabase/compras.sql` | Compras | Se pega una vez en Supabase → SQL Editor, después de `costos.sql`. Reemplaza los permisos de `002_compras.sql` del módulo dlv-compras |
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

## Tablero gerencial (`/tablero`)

No tiene datos propios: lee los de los demás programas (si alguno no está activado, esa parte queda en blanco).

- **Todas las obras:** semáforo (al día, atención, en riesgo) con el motivo, y tres barras: tiempo transcurrido del plazo, avance físico (el % del último reporte diario) y avance económico (planillado sobre el contrato). Arriba, el total contratado, planillado y por cobrar.
- **En riesgo** si el plazo venció sin terminar, el atraso pasa de 10 puntos, hay más de 3 días sin reporte, una póliza vencida o RDI sin respuesta fuera de plazo. **Atención** con atraso de 5 a 10 puntos, pólizas por vencer, acuerdos vencidos o incidentes de seguridad.
- **Detalle de la obra:** curva de avance real contra programado lineal, plazo, reportes, estado de pago, subcontratos y pendientes, con acceso directo a cada programa.
- **Informe semanal en PDF:** elige la semana y arma el informe con avance físico y económico, personal y clima por día, actividades sumadas, avance en el modelo 3D, novedades y seguridad, pendientes, 4 fotos y firmas.

Para que la curva y el semáforo sirvan, cada obra necesita su **inicio y plazo** (Editar obra) y el **% de avance físico acumulado** en cada reporte diario.

## Estudio de propuestas (`/propuestas`, solo administradores)

1. En Supabase → SQL Editor, ejecuta `supabase/propuestas.sql` (activa también el programa en el menú, visible solo para administradores).
2. **Propuesta:** proyecto, cliente, fecha límite de entrega (avisa 3 días antes) y plazo de obra.
3. **Presupuesto de costos:** pega desde Excel Código · Descripción · Unidad · Cantidad · Costo unitario. Con indirectos y utilidad calcula el precio unitario de oferta (redondeado a centavos), el total sin IVA y con IVA.
4. **Cotizaciones:** cada cotización va en un grupo (por ejemplo «Hormigón premezclado»); el comparativo marca la más baja y la diferencia de las demás, y se elige una por grupo.
5. **PDF:** presupuesto referencial para el cliente y, en hoja aparte, el cuadro comparativo de uso interno.
6. **Resultado:** presentada, adjudicada, perdida (con quién ganó y por cuánto) o desistida. La efectividad comercial del año se calcula en número y en monto.
7. **Adjudicada:** «Crear la obra con este presupuesto» crea la obra y carga sus rubros a precio de oferta en Estado de pago, listos para planillar.

Todos los PDF reemplazan los símbolos que la fuente del PDF no puede dibujar (signo menos, visto, casillas).

## Inicio y cierre de obra (`/ciclo`)

1. En Supabase → SQL Editor, ejecuta `supabase/ciclo.sql` (activa también el programa en el menú).
2. **Inicio:** fecha de inicio contractual y plazo (los usa el tablero gerencial; solo el admin los cambia), entrega de la obra adjudicada (12 puntos) y análisis previo a la ejecución (12 puntos).
3. **Cierre:** fechas de recepción provisional y definitiva (calcula el plazo real), balance final con Estado de pago y Subcontratos, desmovilización, recepción y entrega al cliente, y certificados municipales y de servicios de Cuenca (Bomberos, Centrosur, ETAPA…).
4. Cada punto cumplido guarda fecha, responsable y dónde está el documento. Algunos muestran lo que la plataforma ya sabe (rubros cargados, pólizas, actas, RDI, subcontratos terminados). Se pueden agregar puntos propios de cada obra.
5. **Encuesta al cliente** (6 criterios de 1 a 5 y si nos recomendaría) y **lecciones aprendidas**.
6. **PDF** del protocolo de inicio o de cierre, con firmas.

## Control de costos por obra (`/costos`)

1. En Supabase → SQL Editor, ejecuta `supabase/costos.sql` (crea gastos y metas, agrega el costo unitario a los rubros y activa el programa en el menú).
2. **Gastos:** facturas, roles, alquileres y caja chica, sin IVA, en cinco categorías (materiales, mano de obra, equipos y transporte, indirectos, otros). Se registran uno a uno o se pegan desde Excel (Fecha · Proveedor · Documento · Descripción · Categoría · Monto); si falta la categoría se deduce del texto. Filtros por categoría, mes y pendientes de pago, y descarga en CSV.
3. **Subcontratos y roles de pago:** no se registran como gasto; se suman solos desde las planillas de subcontratos y los roles de Personal aprobados o pagados.
4. **Presupuesto meta** (solo administradores): lo que se espera gastar por categoría. Se sugiere a partir del costo directo del estudio de propuestas (o venta ÷ 1,298 si no lo hay) y se ajusta a mano.
5. **Resumen** (solo administradores): venta, planillado, costo real, margen a la fecha, costo y margen proyectados al cierre (costo real ÷ avance planillado), meta vs real por categoría con semáforo, gráfico mensual, flujo de caja, gasto por capítulo y principales proveedores. **Informe PDF** con todo el detalle.
6. Los residentes ven y registran los gastos de sus obras, pero no los márgenes; solo editan lo que ellos registraron y solo el administrador borra.
7. Las obras creadas desde una propuesta adjudicada guardan el costo unitario de cada rubro. El tablero gerencial muestra el margen de cada obra y avisa si el costo supera lo planillado o la meta.

## Personal y roles de pago (`/personal`)

1. En Supabase → SQL Editor, ejecuta `supabase/personal.sql` (activa también el programa en el menú).
2. **Trabajadores:** ficha con cédula (valida el dígito verificador), cargo, jornal diario, ingreso, obra, aviso de entrada al IESS y contacto de emergencia. El residente registra al personal de su obra; solo el administrador lo cambia de obra o borra fichas. Al dar de baja recuerda el aviso de salida y el finiquito.
3. **Asistencia diaria** desde el celular: P (jornada), ½ (medio día) o F (falta) y horas extra por trabajador, botón para marcar a todos presentes y resumen de los últimos 7 días.
4. **Roles de pago** por quincena, semana o mes: días y horas extra salen de la asistencia; se agregan bonos, anticipos y descuentos. Calcula aporte personal (9,45 %), patronal (12,15 % = 11,15 % + IECE + SECAP), horas extra con 50 % de recargo y provisiones (décimos, vacaciones y fondos de reserva desde el año). Valores 2026: salario básico USD 482. Los parámetros se pueden cambiar en cada rol.
5. El residente prepara el rol en borrador; el administrador lo aprueba y lo marca como pagado. **PDF** con columna de firma por trabajador.
6. Integraciones: el costo de los roles aprobados pasa a mano de obra en Control de costos y en el tablero; el reporte diario trae la asistencia del día por cargo y horas; el portal avisa de trabajadores sin aviso de entrada al IESS.

## Control de documentos (`/documentos`)

1. En Supabase → SQL Editor, ejecuta `supabase/documentos.sql` (activa también el programa en el menú). Los archivos se guardan en el mismo bucket R2 (`functions/api/documentos.js`): todos los usuarios con sesión los leen; solo el administrador los sube.
2. **Listado maestro** agrupado por tipo (manuales, políticas, procedimientos, instructivos, formatos y registros, documentos externos), con filtros y PDF del listado. Código tipo-área-número (PR-OBR-02, FO-ADM-03…); el programa sugiere el siguiente código libre.
3. Con el listado vacío, el administrador puede **cargar un listado sugerido** con los procesos que ya cubre la plataforma; quedan "en elaboración" para asignar responsable y publicar.
4. **Publicar versión:** número, fecha, qué cambió, elaboró, revisó, aprobó y el archivo. La nueva pasa a vigente y la anterior queda obsoleta en el historial. Cada documento tiene su revisión periódica (12 meses por defecto) con aviso de vencimiento.
5. **Acuse de lectura:** cada persona confirma que leyó la versión vigente; el portal avisa de los documentos nuevos o actualizados en los últimos 30 días que el usuario aún no leyó.

## Compras (`/compras`)

1. En Supabase → SQL Editor, ejecuta `supabase/compras.sql` (después de `costos.sql`). Usa las mismas tablas y numeración del módulo **dlv-compras** (SC, PD, OC, GE). **No ejecutes `002_compras.sql` de ese módulo**: abría la tabla de obras y todas las compras a cualquier usuario. Si ya lo ejecutaste, `compras.sql` quita esas políticas y deja los permisos por obra; también cierra a solo administradores las tablas del lector de facturas (`facturas_proveedor`…), que sigue funcionando con su clave de servicio.
2. **Pedido de obra (PD):** el residente pide el material de su obra (ítems a mano o pegados desde Excel). El administrador lo aprueba eligiendo proveedor y precios —con el último precio pagado como referencia— y la orden sale emitida; o lo pasa a cotización, o lo rechaza con motivo.
3. **Cotización (SC):** proveedores invitados (con el texto listo para pedir la proforma por WhatsApp), proformas con precio por ítem, marca, "cumple", plazo y forma de pago; **comparativo** con el menor precio resaltado, adjudicación por ítem o "todo a uno" con justificación obligatoria, y una orden en borrador por proveedor. PDF del comparativo.
4. **Orden de pedido (OC):** se revisa y se emite; PDF con firmas y botón para enviarla por WhatsApp al proveedor. Se puede anular mientras no tenga recepciones.
5. **Recepción (GE):** el residente registra lo recibido y rechazado con la guía de remisión, transportista y placa; acepta entregas parciales y no deja recibir más de lo pendiente. PDF del acta de recepción.
6. **Factura:** el administrador la registra (o la elige entre las que llegaron por correo, si está el lector de facturas) y ve el cruce **pedido / recibido / facturado** sin IVA: cuadra si la diferencia es menor al 1 % (mínimo $1). Al guardarla, el subtotal entra como **gasto** de la obra en Control de costos, y las órdenes emitidas aún sin factura aparecen como **comprometido**.
7. El portal avisa de pedidos por aprobar, órdenes por recibir y entregas atrasadas. Los pedidos por WhatsApp del módulo dlv-compras quedan para una segunda fase.
