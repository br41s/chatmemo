# Decisiones

## 2026-07-26 — Aislamiento de herramientas externas

- Decidido: el cliente envía solo IDs y el servidor recarga esquema y cabeceras mediante la sesión Supabase/RLS.
- Decidido: solo se permiten destinos HTTPS con DNS público fijado, redirecciones del mismo origen, cabeceras filtradas y límites de tiempo/tamaño/llamadas.
- Decidido: rechazar referencias OpenAPI externas y operaciones no estructuradas antes de invocar el resolver.
- Motivo: cerrar SSRF, DNS rebinding, fuga de credenciales y lecturas locales sin cambiar todavía el modelo de datos.
- Diferido: corregir RLS/exposición de secretos de herramientas compartidas en un bloque independiente.

## 2026-07-26 — Herramientas compartidas sin cabeceras secretas

- Decidido: una herramienta compartida solo será legible por otros usuarios autenticados cuando `custom_headers` esté vacío; el propietario conserva acceso a todas sus filas.
- Decidido: aceptar las representaciones vacías que genera el editor (`{}`, cadena vacía, JSON `null` y cadenas de objeto vacío con espacios), sin interpretar texto JSON arbitrario.
- Decidido: usar `CHECK ... NOT VALID` para bloquear nuevas combinaciones compartidas con cabeceras sin reescribir filas históricas; una fila histórica incompatible deberá corregirse en su siguiente actualización.
- Decidido: acotar a cinco segundos la espera por los bloqueos DDL de la migración.
- Motivo: impedir que RLS exponga `custom_headers` completos manteniendo la compartición de herramientas que no necesitan esas cabeceras.
- Límite: este bloque no detecta secretos que el usuario incruste manualmente en `schema` o `url`.
- Verificado: la migración y los casos de propietario, tercero autenticado, anónimo, filas históricas y escrituras nuevas pasaron contra PostgreSQL 18 local.
- Verificado: el proyecto Supabase vinculado contenía 0 herramientas en la comprobación remota de solo lectura, por lo que la migración no oculta filas actuales.
- Pendiente: inventariar policies remotas creadas fuera de las migraciones; la clave de servicio no expone `pg_policies` y no hay contraseña PostgreSQL local.
- Pendiente: aplicar la migración remota solo con confirmación explícita.
- Despliegue obligatorio: publicar primero la ruta con comprobación de propietario y cabeceras; aplicar después la migración RLS. Un rollback del código debe conservar esa defensa mientras la policy esté activa.

## 2026-07-26 — Separación de modelos remotos y locales

- Decidido: mantener los modelos personalizados remotos compatibles con OpenAI mediante HTTPS público, validación de destino y DNS fijado durante la conexión.
- Decidido: un modelo remoto solo podrá compartirse sin `api_key`; los modelos con clave serán visibles y ejecutables únicamente por su propietario.
- Decidido: la ruta remota usará la sesión y RLS, no `service_role`, y tomará `base_url`, `api_key` y `model_id` exclusivamente de la fila autorizada.
- Decidido: el acceso a modelos locales no se resolverá permitiendo que el servidor público conecte a `localhost` o a la LAN.
- Contexto: ChatMemo ya consulta Ollama desde el navegador mediante `NEXT_PUBLIC_OLLAMA_URL`; ese flujo queda separado e intacto en este bloque.
- Aprobado: el diseño detallado en `tasks/custom-model-security-design.md`; autorizado para implementación y verificación exclusivamente local.
- Despliegue obligatorio: publicar y verificar primero la ruta sin `service_role`; aplicar después la migración RLS. La versión antigua ignora RLS mediante la clave de servicio y no es segura durante un despliegue parcial.

## 2026-07-26 — Recuperación y reprocesamiento de archivos seguro

- Decidido: retrieval resuelve primero el conjunto completo de archivos mediante sesión/RLS y ejecuta los RPC con esa misma sesión; si falta un ID se rechaza todo antes de generar embeddings.
- Decidido: el procesamiento de todos los formatos exige propiedad, usa sesión también para Storage y valida ruta y tamaño real antes de descargar; no usa `service_role`.
- Decidido: reemplazar fragmentos mediante una RPC transaccional que bloquea la fila del archivo y valida propiedad, contenido y total de tokens.
- Decidido: versionar fragmentos con `active`; retrieval solo consulta la versión activa, mientras los fragmentos citados por mensajes se conservan inactivos para no borrar historial por cascada.
- Decidido: tratar clave, endpoint y deployment Azure de entorno como un bloque indivisible y limitar el endpoint a orígenes HTTPS `*.openai.azure.com`.
- Decidido: limitar globalmente a dos las inferencias locales y propagar cancelación desde el botón Stop hasta retrieval e embeddings.
- Verificado: 172 pruebas, type-check, lint, build de producción y las tres integraciones RLS contra PostgreSQL 18 desechable con `pgvector`; revisión adversarial final sin hallazgos críticos.
- Despliegue obligatorio: aplicar la migración de `file_items` y publicar las rutas como una unidad coordinada, porque las rutas nuevas dependen de `replace_file_items` y de la columna `active`.

## 2026-07-28 — Consultas de username sin exponer perfiles

- Decidido: las rutas de disponibilidad y consulta requieren sesión autenticada.
- Decidido: RLS no se amplía sobre `profiles`; dos RPCs `SECURITY DEFINER` con `search_path` fijo devuelven únicamente un booleano o un username.
- Decidido: la disponibilidad excluye el perfil del usuario actual y el índice `UNIQUE` sigue siendo la defensa definitiva frente a carreras.
- Rechazado: usar `service_role` en las rutas o hacer legibles perfiles completos para resolver una consulta escalar.
- Verificado: la migración y las consultas pasaron contra PostgreSQL 18 local con casos de propietario, colisión, input inválido, rol anónimo y sesión sin `auth.uid()`.
- Pendiente: aplicar la migración remota solo con confirmación explícita.

## 2026-07-28 — Cierre de secretos en herramientas y colecciones compartidas

- Decidido: `tools.schema` y `tools.url` son configuración pública cuando una herramienta se comparte; cualquier herramienta que describa autenticación, parámetros de credenciales o valores con forma de secreto debe permanecer privada.
- Decidido: aplicar la misma regla en RLS y en un `CHECK ... NOT VALID`; las filas históricas inseguras no se reescriben y solo siguen visibles para su propietario.
- Decidido: la ruta de ejecución repite la validación para herramientas ajenas como defensa durante despliegues parciales.
- Decidido: la visibilidad de `file_items` deriva de si la sesión puede leer su fila padre en `files`, incluyendo archivos privados compartidos mediante una colección.
- Decidido: solo los fragmentos activos se comparten; los históricos inactivos siguen disponibles únicamente para el propietario.
- Decidido: un enlace `collection_files` solo es válido si colección, archivo y enlace pertenecen al mismo usuario; las policies ocultan enlaces históricos cruzados y bloquean nuevos.
- Motivo: cerrar los dos P2 sin separar todavía secretos en otra tabla ni duplicar la lógica completa de compartición de archivos.
- Verificado: 212 pruebas Jest y las suites RLS de herramientas, modelos, archivos/colecciones y username pasan contra PostgreSQL 18 desechable con `pgvector`; también pasan type-check, lint, formato y build de producción.
- Completado: el inventario detectó cuatro migraciones antiguas ya materializadas pero ausentes del historial; tabla, columnas, RLS, cinco policies, extensión e índices coincidían y sus versiones se repararon como aplicadas.
- Completado: las seis migraciones restantes se aplicaron en orden a Supabase remoto. El historial local/remoto quedó alineado y un dry-run posterior confirmó que la base está actualizada.
- Verificado remoto: `file_items.active` es obligatorio con default `true`; las cuatro RPC esperadas están disponibles; `private.collection_file_link_is_owned` no aparece en OpenAPI; configuraciones seguras se aceptan y URLs con query secrets o webhooks se rechazan.
- Documentado: README y guías distinguen Ollama local browser-to-loopback de modelos remotos HTTPS, sustituyen el SQL manual por migraciones versionadas y explican las garantías de RLS y compartición sin secretos.
