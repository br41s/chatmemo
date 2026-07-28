# Corrección SSRF en herramientas de chat

- [x] Mapear el origen y ejecución de URLs, métodos y cabeceras.
- [x] Definir una política mínima de destinos seguros y propiedad de configuración.
- [x] Implementar validación antes de cualquier petición saliente.
- [x] Añadir pruebas de regresión para hosts públicos, loopback, redes privadas, redirecciones y cabeceras sensibles.
- [x] Ejecutar revisión Staff Engineer.
- [x] Verificar `type-check`, `lint`, pruebas y build.

Fuera de alcance: migraciones/RLS, exposición de secretos, otros IDOR y soporte de LLM local.

## Herramientas compartidas sin secretos

- [x] Confirmar la semántica de compartición.
- [x] Mapear RLS, lecturas y escrituras de `custom_headers`.
- [x] Diseñar la migración mínima sin reescribir datos existentes.
- [x] Aprobar el diseño y la ejecución de una migración.
- [x] Implementar y verificar estáticamente la política y la restricción.
- [x] Ejecutar revisión Staff Engineer final.
- [x] Ejecutar la prueba de integración RLS contra PostgreSQL 18 local.
- [x] Medir en solo lectura el impacto remoto: 0 herramientas existentes.
- [ ] Inventariar `pg_policies` remoto con acceso SQL antes del despliegue.
- [ ] Aplicar la migración a producción solo tras confirmación explícita.

## Auditoría posterior de credenciales e IDOR

- [x] Barrer tablas compartidas y rutas con `service_role`.
- [x] Medir el impacto remoto sin leer datos sensibles.
- [x] Documentar hallazgos y orden mínimo de corrección.
- [x] Corregir localmente exposición de `models.api_key`, IDOR y SSRF de modelos personalizados.
- [x] Corregir localmente lectura/escritura IDOR en recuperación de archivos.
- [ ] Reparar consulta y disponibilidad de username sin exponer `profiles`.
- [ ] Alinear RLS de `file_items` para archivos compartidos mediante colecciones.
- [ ] Definir validación de secretos incrustados en `tools.schema` y `tools.url`.

## Modelos remotos personalizados seguros

- [x] Confirmar la separación entre modelos remotos y el flujo local del navegador.
- [x] Elegir la semántica: compartir solo sin clave y fijar DNS en conexiones remotas.
- [x] Redactar el diseño de RLS, autorización de ruta y transporte SSRF seguro.
- [x] Aprobar el diseño antes de implementar.
- [x] Implementar y probar la migración RLS localmente.
- [x] Sustituir `service_role` por sesión/RLS y validar la petición.
- [x] Implementar y probar el transporte HTTPS público con DNS fijado y streaming.
- [x] Actualizar el contrato del cliente y añadir pruebas de ruta, transporte y migración.
- [x] Ejecutar revisión Staff Engineer y la puerta completa de verificación.
- [ ] Aplicar la migración o publicar cambios solo con confirmación explícita.

Orden de release obligatorio: desplegar primero las rutas con defensa en profundidad, verificar que no usan `service_role` ni aceptan configuración secreta del cliente y aplicar después las migraciones RLS. No hacer rollback a las rutas antiguas tras aplicar las policies.

## IDOR de recuperación y procesamiento de archivos

- [x] Mapear RLS, RPC, clientes y propiedad de `files`/`file_items`.
- [x] Definir un contrato acotado y una única comprobación de propiedad antes de embeddings o escrituras.
- [x] Corregir `/api/retrieval/retrieve`, DOCX y los demás formatos sin cambiar el flujo válido del propietario.
- [x] Añadir pruebas de propietario, UUID ajeno, IDs parciales, sesión ausente, Storage ajeno y errores de escritura.
- [x] Ejecutar revisión Staff Engineer/adversarial sin hallazgos críticos pendientes.
- [x] Verificar 172 pruebas, `type-check` y lint sin errores nuevos.
- [x] Ejecutar las tres integraciones RLS juntas contra PostgreSQL 18 desechable con `pgvector`.
- [x] Completar el build de producción con acceso a Google Fonts.
- [ ] Aplicar migración/publicar únicamente con confirmación explícita y como una unidad coordinada.
