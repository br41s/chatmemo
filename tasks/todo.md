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
- [x] Inventariar `pg_policies` remoto con acceso SQL antes del despliegue.
- [x] Aplicar la migración a producción tras confirmación explícita.

## Auditoría posterior de credenciales e IDOR

- [x] Barrer tablas compartidas y rutas con `service_role`.
- [x] Medir el impacto remoto sin leer datos sensibles.
- [x] Documentar hallazgos y orden mínimo de corrección.
- [x] Corregir localmente exposición de `models.api_key`, IDOR y SSRF de modelos personalizados.
- [x] Corregir localmente lectura/escritura IDOR en recuperación de archivos.
- [x] Reparar consulta y disponibilidad de username sin exponer `profiles`.
- [x] Alinear RLS de `file_items` para archivos compartidos mediante colecciones.
- [x] Definir y aplicar validación de secretos incrustados en `tools.schema` y `tools.url`.

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
- [x] Aplicar la migración remota tras confirmación explícita.

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
- [x] Aplicar la migración remota tras confirmación explícita y como una unidad coordinada.

## Consultas de username autenticadas

- [x] Confirmar la causa: las rutas anónimas no pueden leer `profiles` por RLS.
- [x] Añadir RPCs autenticadas que expongan solo disponibilidad o username.
- [x] Validar y limitar las peticiones de ambas rutas.
- [x] Añadir pruebas de autorización, validación, colisión y errores.
- [x] Ejecutar una integración RLS real contra PostgreSQL 18 local desechable.
- [x] Ejecutar revisión Staff Engineer final sin hallazgos críticos.
- [x] Ejecutar la suite Jest, type-check, lint y `git diff --check`.
- [x] Aplicar posteriormente la migración remota tras confirmación explícita.

## Cierre de sincronización Supabase y hallazgos P2

- [x] Inventariar migraciones, funciones y policies de la base Supabase remota sin leer datos sensibles.
- [x] Impedir que una herramienta compartida contenga credenciales en su URL o valores secretos incrustados en el esquema.
- [x] Alinear la lectura de `file_items` con archivos visibles mediante colecciones compartidas.
- [x] Añadir pruebas unitarias y de integración RLS para ambos contratos.
- [x] Ejecutar revisión Staff Engineer, suite completa, type-check, lint y build.
- [x] Reparar cuatro entradas históricas y aplicar en orden las seis migraciones reales a Supabase remoto.
- [x] Verificar historial, OpenAPI, RPC, columna `file_items.active`, helper privado y predicados de compartición remotos.
- [x] Preparar un commit local.
- [x] Recibir autorización explícita para push y PR.

## Documentación y publicación del cierre

- [x] Actualizar README con Ollama, migraciones y arquitectura de ejecución local.
- [x] Actualizar las guías de usuario y administración con los límites de compartición y RLS.
- [x] Revisar y verificar el diff documental final.
- [x] Crear commit documental.
- [x] Hacer push de `codex/finish-security-sync` y abrir el PR [#4](https://github.com/braisntext/chatmemo/pull/4).

## Página pública del repositorio

- [x] Actualizar y verificar la descripción About de GitHub.
- [x] Acordar la estructura editorial del README como landing page.
- [x] Implementar y verificar el README mejorado.
- [ ] Publicar el cambio mediante una rama y PR independientes.

Trabajo futuro fuera de este cambio:

- [ ] Inyectar memoria persistente en Ollama manteniendo la inferencia local.
- [ ] Inyectar memoria persistente en modelos remotos personalizados.
