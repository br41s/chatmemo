# Auditoría de seguridad — 2026-07-26

Estado: EN CORRECCIÓN LOCAL. Los hallazgos de modelos personalizados, herramientas y recuperación/procesamiento de archivos están corregidos y verificados en el árbol local; aún no se han publicado ni se han aplicado sus migraciones remotas. Los demás hallazgos siguen abiertos.

## Impacto remoto observado

- Perfiles: 1.
- Herramientas: 0.
- Modelos personalizados: 0.
- Archivos: 0.
- Fragmentos de archivos: 0.

Las comprobaciones fueron de solo lectura y devolvieron únicamente conteos. No se leyeron ni mostraron IDs, nombres, contenido, URLs o credenciales.

## Hallazgos

### P0 — `models.api_key` se expone al compartir una fila

- Estado: corregido localmente y pendiente de despliegue/migración.

- Evidencia: `models` almacena `api_key` en texto (`supabase/migrations/20240125194719_add_custom_models.sql:23`) y la policy permite seleccionar la fila completa cuando `sharing <> 'private'` (líneas 43–46).
- Impacto: cualquier usuario con acceso Supabase autenticado puede consultar la clave de un modelo compartido directamente desde el cliente.
- Estado remoto: latente; actualmente hay 0 modelos.
- Corrección mínima propuesta: sustituir la policy y añadir un `CHECK ... NOT VALID` para que solo puedan compartirse modelos sin `api_key`, conservando las filas históricas para su propietario.

### P1 — IDOR y SSRF en `/api/chat/custom`

- Estado: corregido localmente y pendiente de despliegue/migración.

- Evidencia: la ruta autentica al usuario, pero usa `service_role` y selecciona por `customModelId` sin filtrar `user_id` (`app/api/chat/custom/route.ts:24-35`). Después envía la clave guardada a `base_url` sin validar (`líneas 41–50`).
- Impacto: con un UUID conocido, un usuario autenticado puede consumir la credencial de otro modelo. Un propietario también puede hacer que el servidor conecte con destinos internos mediante `base_url`.
- Estado remoto: latente; actualmente hay 0 modelos.
- Corrección mínima propuesta: usar el cliente de sesión/RLS, seleccionar solo columnas necesarias, exigir propiedad o compartición sin credenciales y aplicar una política de destinos salientes antes de conectar.

### P1 — Lectura IDOR de fragmentos privados

- Estado: corregido y verificado localmente con PostgreSQL 18; pendiente de despliegue/migración.
- Evidencia: `/api/retrieval/retrieve` acepta `fileIds` del cliente y llama los RPC con `service_role` sin comprobar que pertenezcan al usuario (`app/api/retrieval/retrieve/route.ts:16-24,59-79`).
- Impacto: un usuario autenticado con UUIDs de archivos ajenos puede recuperar su contenido indexado.
- Estado remoto: latente; actualmente hay 0 archivos y 0 fragmentos.
- Corrección mínima propuesta: resolver primero todos los IDs con la sesión/RLS o exigir `user_id = profile.user_id`; rechazar la petición completa si falta alguno antes de llamar el RPC.

### P1 — Escritura IDOR en procesamiento DOCX

- Estado: corregido y verificado localmente con PostgreSQL 18; pendiente de despliegue/migración.
- Evidencia: `/api/retrieval/process/docx` acepta `fileId`, crea `file_items` y actualiza `files.tokens` con `service_role` sin validar propiedad (`app/api/retrieval/process/docx/route.ts:11-25,86-108`). La ruta equivalente para otros formatos sí valida `fileMetadata.user_id` (`app/api/retrieval/process/route.ts:30-48`).
- Impacto: un usuario autenticado con un UUID ajeno puede corromper sus fragmentos y metadatos.
- Estado remoto: latente; actualmente hay 0 archivos.
- Corrección mínima propuesta: reutilizar exactamente la comprobación de propiedad de la ruta normal antes de procesar o escribir.

### P2 — Consulta y disponibilidad de username rotas

- Evidencia: ambas rutas usan la clave anónima para leer `profiles` (`app/api/username/get/route.ts:13-23`, `available/route.ts:13-23`), pero la única policy de `profiles` exige `user_id = auth.uid()` (`supabase/migrations/20240108234541_add_profiles.sql:46-51`).
- Verificación remota: existe 1 perfil, pero una consulta anónima ve 0 filas sin error.
- Impacto: obtener un username ajeno falla y un username ya usado puede presentarse como disponible hasta que la restricción `UNIQUE` rechace la escritura.
- Corrección mínima propuesta: una función SQL `SECURITY DEFINER` con retorno limitado, o una ruta servidor que use `service_role` pero solo seleccione/devuelva `username`, con validación y rate limiting. No añadir lectura pública sobre `profiles`, porque expondría también las API keys de la fila.

### P2 — Secretos incrustados en `tools.schema` o `tools.url`

- Evidencia: la nueva migración protege `custom_headers`, pero una fila compartida continúa exponiendo `schema` y `url` completos.
- Impacto: tokens escritos manualmente en URLs, ejemplos o extensiones OpenAPI serían visibles.
- Estado remoto: latente; actualmente hay 0 herramientas.
- Corrección mínima propuesta: prohibir credenciales en URLs y definir qué partes del esquema son configuración pública antes de permitir compartir.

### P2 — Un archivo compartido solo mediante colección no expone sus fragmentos

- Evidencia: `files` permite SELECT cuando pertenece a una colección no privada (`20240108234551_add_collections.sql`), pero `file_items` solo permite lectura ajena cuando el propio archivo tiene `sharing <> 'private'` (`20240108234545_add_file_items.sql`).
- Impacto: la ruta autoriza correctamente el archivo mediante RLS, pero los RPC de retrieval devuelven cero fragmentos; la colección parece compartida aunque su búsqueda no funciona.
- Corrección mínima propuesta: decidir explícitamente si compartir una colección comparte también el contenido indexado y, si es así, alinear la policy SELECT de `file_items` con la policy de `files`.

## Barrido de tablas compartidas

No se encontraron otras columnas explícitas de credenciales en `workspaces`, `presets`, `assistants`, `chats`, `files`, `prompts` o `collections`. Su contenido puede ser sensible por naturaleza, pero su exposición depende de que el propietario active deliberadamente `sharing`; es un riesgo de privacidad/producto distinto a una clave almacenada en una columna dedicada.

## Orden recomendado

1. Cerrar `models.api_key`, el IDOR y SSRF de `/api/chat/custom` como un único bloque.
2. Validar en PostgreSQL y desplegar juntos los cambios de recuperación de archivos y su migración transaccional.
3. Reparar username sin abrir lectura de la fila completa de `profiles`.
4. Alinear la semántica RLS de archivos compartidos mediante colecciones.
5. Definir la política de secretos dentro de OpenAPI/URLs.

No aplicar migraciones remotas hasta inventariar `pg_policies` en Supabase y obtener confirmación explícita.
