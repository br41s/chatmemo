# Diseño: modelos remotos personalizados seguros

Estado: APROBADO

## Problema

La tabla `models` guarda en la misma fila los metadatos compartibles, el destino remoto (`base_url`) y la credencial (`api_key`). La política RLS actual permite leer la fila completa cuando `sharing <> 'private'`, por lo que también expone la clave.

Además, `POST /api/chat/custom` autentica al usuario pero carga cualquier modelo por ID mediante `service_role`. Un usuario autenticado que conozca otro UUID puede consumir la credencial de su propietario. La misma ruta entrega `base_url` al SDK de OpenAI sin validar ni fijar el destino de red, lo que permite SSRF contra direcciones privadas, loopback o metadatos cloud.

## Premisas acordadas

1. Un modelo remoto con `api_key` solo puede verlo y ejecutarlo su propietario.
2. Un modelo remoto compartido debe funcionar sin credenciales almacenadas en `api_key`.
3. El servidor solo puede conectar con endpoints HTTPS públicos y debe fijar la dirección DNS durante la conexión.
4. El identificador real enviado al proveedor es `models.model_id`; el cliente solo elige el UUID del modelo y los parámetros permitidos de la conversación.
5. Los modelos locales no pasarán por esta ruta. El flujo Ollama existente conecta desde el navegador mediante `NEXT_PUBLIC_OLLAMA_URL`; su evolución se tratará como una funcionalidad separada.
6. La migración no borrará ni reescribirá filas históricas.

## Enfoques considerados

### A. Desactivar modelos personalizados

Eliminaría inmediatamente la superficie vulnerable con el menor cambio posible. Se rechaza porque retira una función válida y no es necesario hacerlo para obtener aislamiento fuerte.

### B. Modelos remotos seguros con transporte fijado — elegido

- Restringir RLS para que terceros autenticados solo puedan leer modelos compartidos cuyo `api_key` sea exactamente la cadena vacía.
- Cargar el modelo con el cliente Supabase de sesión y RLS, sin `service_role`.
- Ejecutar directamente el POST OpenAI-compatible mediante un transporte Node que valide HTTPS, rechace destinos no públicos y conecte a la IP ya verificada conservando el hostname para TLS.
- Mantener el streaming de texto y rechazar redirecciones, destinos ambiguos y entradas inválidas.

Es el menor cambio que conserva endpoints remotos arbitrarios sin aceptar una protección SSRF incompleta.

### C. Separar metadatos, credenciales y ejecutores remoto/local

Es la arquitectura ideal a largo plazo: credenciales en una tabla privada, configuración compartible independiente y adaptadores de ejecución por tipo. Se difiere porque requiere migración de datos, cambios amplios de interfaz y diseño del puente local; no es necesario para cerrar las vulnerabilidades actuales.

## Invariantes de seguridad

### Propiedad del estado

- Supabase y sus políticas RLS deciden qué modelo puede leer la sesión.
- La ruta no acepta `api_key`, `base_url` ni el ID remoto del modelo desde el cliente.
- El servidor selecciona únicamente los campos necesarios de la fila autorizada.

### Contrato de entrada

- El cuerpo se reduce a tres campos superiores conocidos: `customModelId`, `temperature` y `messages`; cualquier otro campo se rechaza.
- `customModelId` debe ser UUID, `temperature` un número finito entre 0 y 2 y `messages` un array de 1 a 200 elementos.
- Cada mensaje solo admite `role` (`system`, `user` o `assistant`) y `content` de texto. Los modelos personalizados actuales declaran `imageInput: false`, por lo que esta ruta no necesita aceptar imágenes, herramientas ni mensajes de función.
- Cada contenido se limita a 100.000 caracteres y el JSON agregado codificado en UTF-8 a 2 MiB. El servidor lee `request.body` como stream con contador y aborta antes de parsear al superar el límite, aunque falte `Content-Length` o se use transferencia chunked. Un `Content-Length` excesivo permite rechazar todavía antes.
- El cliente dejará de enviar el objeto `chatSettings` completo. No se aceptan `model`, `api_key`, `base_url`, `max_tokens`, herramientas ni opciones arbitrarias.

### Red saliente

- Solo se acepta `https:` sin credenciales en URL, query ni fragmento en la URL base.
- Se rechazan `localhost`, nombres internos, hosts sin dominio y rangos IPv4/IPv6 no públicos.
- Se resuelven todas las direcciones del hostname y se rechaza el host completo si alguna no es pública.
- La conexión usa una de las IP verificadas y mantiene el hostname original como SNI y para la validación del certificado.
- No se siguen redirecciones. Se propagan cancelación y límites de tiempo; la respuesta continúa siendo streaming.
- Los errores devueltos al cliente no contienen la clave ni detalles internos de conexión.
- El hostname se canonicaliza mediante `URL`: minúsculas y punycode; se rechazan punto final, credenciales, hostname vacío, barras invertidas, caracteres de control y puertos inválidos. `URL` normaliza segmentos `.`/`..`; el path y sus escapes restantes se conservan, y la URL final se construye añadiendo exactamente `/chat/completions` sin permitir cambio de origen (`/v1` produce `/v1/chat/completions`).
- La clasificación bloquea explícitamente loopback, privados, link-local, CGNAT, multicast, documentación/reservados, IPv4 mapeada en IPv6, traducción NAT64 conocida y cualquier hostname cuya resolución sea vacía o contenga al menos una dirección no global.
- La resolución usa `dns.lookup(hostname, { all: true, verbatim: true })`. La única fuente de clasificación es la primitiva `isBlockedToolAddress` y sus `BlockList` ya probados; el nuevo transporte no mantiene una segunda lista divergente. Se añadirán los casos que falten a esa fuente compartida.
- Cada petición congela el conjunto DNS validado y toda conexión usa solo una IP de ese conjunto. No hay reintentos ni reconexión transparente.
- El transporte usa `node:https.request`, que no consulta proxies de entorno, con `agent: false` para impedir pooling o reutilización de sockets entre validaciones, un `lookup` cerrado sobre la IP elegida, `Host` original y `servername` original cuando es un nombre DNS. Para un literal IP, TLS valida el certificado contra ese literal sin SNI artificial.

### Compartición

- La política permisiva actual de modelos compartidos se sustituye; no basta con añadir otra política porque RLS las combinaría con `OR`.
- La nueva política de lectura compartida se limita al rol `authenticated` y exige `sharing <> 'private' AND api_key = ''`.
- Una restricción `CHECK ... NOT VALID` bloquea nuevas combinaciones compartidas con clave sin reescribir filas históricas.
- Una fila histórica compartida con clave deja de ser visible para terceros, pero sigue accesible para su propietario. Su siguiente actualización debe hacerla privada o vaciar la clave.
- `models.api_key` ya es `NOT NULL`; tanto RLS como `CHECK` usan la misma condición exacta `api_key = ''`. No se aplica trim ni `COALESCE`.
- El estado RLS final conserva la política existente de acceso total del propietario (`USING` y `WITH CHECK` por `user_id = auth.uid()`), sustituye la política SELECT compartida y no añade permisos a `anon`. Antes de desplegar se inventariarán otras políticas permisivas remotas.

### Presupuestos operativos

- Conexión y recepción de cabeceras: 15 segundos; inactividad entre fragmentos: 30 segundos; duración total: 5 minutos.
- Cabeceras de respuesta máximas: 32 KiB mediante `maxHeaderSize`.
- La petición envía `Accept-Encoding: identity` y rechaza cualquier respuesta con `Content-Encoding` distinto de vacío o `identity`. La respuesta remota sin comprimir se limita a 10 MiB; al superar el límite se destruye la conexión y se cierra el stream.
- El POST envía `Content-Type: application/json` y `Accept: text/event-stream`. Antes de devolver `200` al navegador exige estado upstream 2xx y tipo SSE. El parser acepta eventos `data:`, termina con `[DONE]`, extrae únicamente `choices[0].delta.content` de tipo string y limita cada evento a 1 MiB; JSON o formas incompatibles cierran el stream como error.
- No se usa el SDK para el transporte ni existen reintentos automáticos; cualquier petición nueva requiere validación DNS completa.
- Si `api_key = ''`, no se crea la cabecera `Authorization`; nunca se envía `Bearer ` ni una clave ficticia. Si tiene valor, se añade `Authorization: Bearer <api_key>` únicamente después de autorizar la fila.
- Este bloque no introduce un rate limiter distribuido porque el proyecto no tiene un almacén compartido para ese estado y uno en memoria sería incorrecto en serverless. Los límites anteriores acotan cada invocación; el rate limiting por usuario queda como endurecimiento operativo separado.

### Observabilidad segura

- Cada petición recibe un identificador de correlación y registra únicamente categoría de fallo, fase (`validation`, `dns`, `connect`, `upstream`, `stream`) y código de resultado.
- No se registran `api_key`, prompts, respuestas, cabeceras, URL completa ni direcciones resueltas. Los bloqueos SSRF, timeouts, aborts y límites excedidos quedan distinguibles sin exponer datos sensibles.

## Implementación propuesta

1. Añadir una migración RLS transaccional con `lock_timeout`, sustitución de la política compartida y restricción no validada.
2. Añadir un cliente OpenAI-compatible específico sobre `node:https.request`, reutilizando la clasificación de URL e IP ya probada en `lib/server/safe-tool-request.ts`. El cliente envía un único POST a `/chat/completions`, procesa SSE incrementalmente y produce fragmentos de texto; conecta mediante un `lookup` fijado, usa `agent: false` y propaga `AbortSignal`.
3. Cambiar `app/api/chat/custom/route.ts` a runtime Node, validar el contrato cerrado, cargar la fila con el cliente Supabase de sesión y ejecutar `models.model_id` mediante el cliente seguro. No se utiliza el SDK OpenAI en esta ruta.
4. Reducir el cuerpo que construye `handleHostedChat` para modelos custom a `customModelId`, `temperature` y `messages`.
5. Mantener `textStreamResponse` como frontera de salida para no cambiar el contrato de texto consumido por el cliente.
6. Añadir pruebas unitarias de ruta y transporte, más una prueba RLS reproducible con sintaxis compatible con PostgreSQL 15, la versión configurada por Supabase en este repositorio.

## Comportamiento de errores

- `400`: cuerpo, UUID o configuración de modelo inválidos.
- `401`: no existe sesión válida.
- `403`: el modelo no es visible para la sesión, sin revelar si el UUID existe.
- `413`: petición superior al presupuesto permitido.
- `502`: el proveedor remoto falla o devuelve una respuesta incompatible antes de iniciar el stream.
- `504`: timeout de conexión o cabeceras antes de iniciar el stream.
- Si el navegador cancela, se aborta y destruye inmediatamente la petición saliente; no se intenta escribir una segunda respuesta HTTP.
- Después de enviar el `200`, un timeout de inactividad/total, un SSE inválido o un límite excedido cierra el stream con error y se registra con el identificador de correlación. Nunca se intenta sustituir el estado HTTP ya enviado por `502` o `504`.
- El cliente conserva su comportamiento actual de mostrar el error y retirar el mensaje temporal.

## Criterios de éxito

- Un usuario no puede leer ni ejecutar el modelo privado de otro usuario conociendo su UUID.
- Un usuario no puede leer ni ejecutar un modelo compartido que contenga una clave.
- Un usuario sí puede ejecutar su propio modelo con clave y un modelo ajeno compartido sin clave.
- La ruta rechaza cualquier `api_key`, `base_url` o ID remoto manipulado en el cuerpo.
- La ruta rechaza campos desconocidos, mensajes no admitidos y cuerpos por encima de los límites definidos.
- Se rechazan HTTP, loopback, redes privadas, IPv6 no pública, DNS mixto y redirecciones.
- Una resolución DNS posterior no puede cambiar el destino de la conexión ya validada.
- El streaming y la cancelación desde el navegador siguen funcionando.
- Un modelo sin clave no genera ninguna cabecera `Authorization`.
- El flujo Ollama local existente no cambia.
- Ninguna fila histórica se borra ni se reescribe durante la migración.

## Verificación

- Pruebas de ruta: contrato cerrado, límite anticipado y chunked sin `Content-Length`, UUID inválido, sesión ausente, modelo no visible, selección limitada, uso de `model_id` almacenado, ausencia de `service_role`, cero reintentos y omisión de `Authorization` sin clave.
- Pruebas de política de red: HTTPS público, HTTP, credenciales en URL, punto final, IDN canonicalizado, loopback, privados, link-local, CGNAT, reservados, IPv4 mapeada, DNS vacío/mixto y bloqueo de redirección.
- Prueba de composición con servidor TLS controlado: mediante dependencias solo inyectables en test, la cadena completa resuelve un hostname, congela la dirección seleccionada y demuestra conexión a esa dirección con `agent: false`, `Host`/SNI original y certificado correcto. Cubre además SSE fragmentado, respuesta comprimida rechazada, 32 KiB de cabeceras, límite de bytes, todos los timeouts, abort, ausencia de reutilización ante un intento de rebinding y fallo ocurrido después de iniciar el stream. La clasificación de loopback sigue activa en producción; la conexión local pertenece exclusivamente al arnés.
- Prueba RLS compatible con PostgreSQL 15: propietario, tercero autenticado, anónimo, compartido sin clave, compartido con clave histórica y nuevas escrituras inválidas. Si se ejecuta provisionalmente en otra versión mayor, se documentará la diferencia y no sustituirá la comprobación final contra la versión configurada.
- Puerta final: Jest, prueba RLS, type-check, lint, format-check y build de producción.

## Riesgos y límites

- `api_key` sigue almacenada en texto en la fila privada y es visible para su propietario en el cliente; cifrado en reposo y separación de credenciales quedan fuera de este bloque.
- Los endpoints remotos pueden registrar prompts y respuestas. La interfaz debería comunicarlo, pero no se modifica en esta corrección de backend.
- Un modelo compartido sin clave expone intencionadamente sus metadatos y `base_url` a usuarios autenticados.
- El soporte local general para LM Studio u otros runtimes no se añade aquí. El diseño futuro debe seguir el patrón cliente/puente local, nunca hacer que el servidor público conecte a la LAN del usuario.
- Un rate limiter distribuido y agregación centralizada de métricas quedan como endurecimiento operativo posterior; no se simula ese estado con memoria local de una instancia serverless.

## Archivos previstos

- `supabase/migrations/<timestamp>_models_shared_without_secrets.sql`
- `app/api/chat/custom/route.ts`
- `components/chat/chat-helpers/index.ts`
- `lib/server/safe-model-stream.ts`
- `__tests__/api/chat-custom-route.test.ts`
- `__tests__/lib/safe-model-stream.test.ts`
- `__tests__/migrations/models-shared-without-secrets.test.ts`
- `__tests__/migrations/models-shared-without-secrets.integration.sql`
- `package.json` solo si la prueba RLS existente necesita incluir el nuevo escenario.

## Fuera de alcance

- Aplicar la migración a Supabase remoto.
- Cifrado o gestor externo de secretos.
- Rediseño visual del editor de modelos.
- Añadir LM Studio, llama.cpp u otros proveedores locales.
- Corregir los IDOR de archivos, las consultas de username o los secretos incrustados en herramientas.

## Revisión adversarial

- Primera pasada: 7/10. Detectó contrato de entrada abierto, presupuestos indefinidos, transporte TLS ambiguo y ausencia de semántica para modelos sin clave.
- Segunda pasada: 8/10. Detectó lectura ilimitada antes del parseo, compresión/cabeceras sin límite, reutilización posible de sockets y dos caminos de transporte todavía abiertos.
- Tercera pasada: 10/10, PASS en completitud, consistencia, claridad, alcance y viabilidad. Los problemas anteriores quedaron resueltos con contrato cerrado, streaming limitado, `agent: false` y un único POST/SSE directo sobre `node:https.request`.

## Siguiente acción

Aprobar este diseño; después se implementará como un bloque atómico y se verificará primero en local, sin aplicar migraciones ni publicar cambios.
