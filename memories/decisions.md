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

## 2026-07-29 — Página pública y límites de modelos personalizados

- Decidido: el About de GitHub describe ChatMemo como memoria y workspace de chat autoalojado para imports, proveedores cloud y Ollama local.
- Decidido: el README funciona como landing page con propuesta de valor, flujo, capacidades, límites de privacidad, instalación y rutas de modelo antes del detalle operativo.
- Decidido: documentar ahora, sin ampliar el alcance, que Ollama y los modelos remotos personalizados todavía no reciben la memoria persistente; Ollama tampoco soporta herramientas.
- Decidido: conservar sin usar la captura histórica de Chatbot UI hasta disponer de una captura actual de ChatMemo.

## 2026-07-29 — Revisión de la auditoría y correcciones derivadas

- Revisado: la auditoría de seguridad se sostiene. El fijado de DNS contra rebinding, las redirecciones del mismo origen, las policies RLS y los predicados de compartición se revisaron sin hallazgos críticos.
- Decidido: cuando falla una regeneración se restaura la respuesta anterior en lugar de eliminar el turno; el mensaje del usuario es historial previo que ese intento nunca añadió.
- Decidido: `regenerationTarget` se captura en `use-chat-handler` antes de `createTempMessages`, porque esa función vacía en su sitio el último mensaje del asistente y recalcular el objetivo más tarde restauraría una cadena vacía.
- Decidido: el rollback reconstruye los objetos con spreads en vez de reasignar `.content`; el objeto mutado es idéntico por referencia al de estado y una escritura in situ no volvería a renderizar.
- Decidido: existe una sola implementación de `readLimitedJson` en `lib/server`; la copia local de la ruta de herramientas aceptaba `NaN` y valores negativos en `Content-Length` y sustituía UTF-8 inválido en silencio.
- Decidido: `lib/tool-sharing.ts` debe reflejar exactamente los predicados SQL de compartición; cualquier `jsonb` que no sea objeto es no compartible en ambos lados.
- Motivo: la base de datos era el lado estricto y no hubo fuga, pero la aplicación podía considerar compartible una herramienta que la policy oculta y el `CHECK` rechaza, con un error opaco como único síntoma.
- Rechazado: recalcular el objetivo de regeneración dentro de `fetchChatResponse`, por la mutación previa en `createTempMessages`.
- Verificado: `format:check`, `type-check`, 223 pruebas Jest (11 nuevas) y build de producción. La build borra `public/worker-development.js` y se restauró con `git checkout --`.
- Publicado: tres commits atómicos en `claude/chatmemo-audit-review-60c4f6` y el PR [#6](https://github.com/braisntext/chatmemo/pull/6).
- Sin cambios: migraciones, módulos SSRF y los cambios de comportamiento deliberados de la auditoría (herramientas y modelos compartidos ya no son visibles para `anon`; un fallo de retrieval aborta el envío en vez de degradar a cero fuentes).

## 2026-08-19 — Auditoría de aplicación y fase 1 de correcciones

- Revisado: auditoría completa fuera del alcance de seguridad (arquitectura, UX, diseño, refactorización, tooling). 38 hallazgos registrados en `tasks/app-audit-2026-08-18.md`.
- Diagnóstico: el sistema de memoria está bien construido; casi todo lo que el usuario toca sigue siendo el fork de Chatbot UI de 2024 sin revisar.
- Decidido: `types/next-ambient.d.ts` versionado replica las referencias de tipos que Next escribe en `next-env.d.ts`. Ese archivo está en `.gitignore` pero en el `include` de tsconfig, así que en un clon limpio `npm run type-check` fallaba con tres TS2307 sobre imports estáticos de PNG. El hook `pre-push` ejecuta exactamente ese comando, de modo que la única CI del proyecto fallaba para cualquiera que no hubiese compilado antes.
- Rechazado: dejar de ignorar `next-env.d.ts` y versionarlo. Next lo regenera en cada build y produciría ruido de diff entre versiones; un archivo aparte que Next nunca toca convive sin conflicto.
- Decidido: la marca del producto es ChatMemo en todas las superficies — título, manifest PWA, OpenGraph, Twitter, landing, asistente de configuración y el nombre del paquete. La descripción `"Chabot UI PWA!"` (con su errata) se sustituye por la propuesta de valor del README.
- Decidido: el logotipo es identidad, no navegación. Deja de ser un enlace a chatbotui.com — el elemento más prominente de las pantallas de login y de chat vacío enviaba al usuario a otro producto.
- Decidido: el enlace de ayuda apunta a `br41s/chatmemo`; se elimina el de Twitter `@ChatbotUI` en vez de reapuntarlo, porque el proyecto no tiene esa cuenta.
- Decidido: se elimina el control «Download Chatbot UI 1.0 data as JSON» y `lib/export-old-data.ts` con él. Renombrar la cadena habría mentido: no existe ChatMemo 1.0 y es una ruta de migración desde un producto que este usuario nunca usó.
- Decidido: lecciones e historial de conversación son capas independientes. El retorno temprano en `get-latest-summary.ts` descartaba lecciones ya consultadas cuando el usuario no tenía filas personales ni bulk, mientras las instrucciones seguían diciendo al modelo que `[LESSONS]` era la señal de mayor calidad. La decisión de devolver `null` queda solo al final, donde significa lo que dice.
- Decidido: extraer `buildSummarySections` como función pura exportada, siguiendo la convención ya usada por `buildMemoryBlock` y `rankByTermCoverage`, para poder probar los presupuestos y la independencia de capas sin base de datos.
- Decidido: `googleStreamResponse` vive en `lib/server/streaming.ts` junto al resto de adaptadores. La ruta de Google construía su propio `ReadableStream` sin captura de errores, así que un `text()` que lanza — lo que hace Gemini al bloquear una respuesta — dejaba el controlador sin cerrar ni marcar error; además omitía `charset=utf-8`.
- Verificado: `lint`, `format:write`, type-check en condiciones de clon limpio (sin `next-env.d.ts` generado), 234 pruebas Jest en 27 suites (11 nuevas) y build de producción. La build borró `public/worker-development.js` y se restauró con `git checkout --`.
- Confirmado: las dos pruebas nuevas de lecciones fallan contra el código anterior y pasan contra el corregido.
- Sin cambios: seguridad, migraciones y el resto de hallazgos de la auditoría (fases 2 a 4).

## 2026-08-19 — Fase 2: rendimiento percibido y lecturas acotadas

- Decidido: las diez lecturas del workspace salen juntas con `Promise.all` en vez de en cascada de diez niveles detrás del spinner de página completa. Eran independientes entre sí desde el principio.
- Decidido: un solo `useEffect` con clave `workspaceId`. Había un segundo efecto de montaje que comprobaba la sesión y volvía a lanzar la misma carga, de modo que un primer arranque la ejecutaba dos veces en paralelo.
- Decidido: `setAssistantImages` reemplaza en lugar de acumular. Al acumular, cada cambio de workspace añadía una entrada duplicada por asistente, y dos en el primer arranque mientras la carga se ejecutaba dos veces.
- Decidido: `PrismLight` con las gramáticas que la app realmente renderiza, registradas junto a los alias que escriben los modelos. El export `Prism` por defecto de react-syntax-highlighter incluye unas 300 gramáticas y estaba importado estáticamente en la ruta de chat.
- Límite aceptado: un lenguaje no registrado se muestra sin resaltado en vez de lanzar; el coste de una gramática ausente es estético.
- Decidido: `gpt-tokenizer` se carga con import dinámico dentro de `buildFinalMessages`, que ya era `async`. El coste pasa del arranque de la ruta al primer envío.
- Medido: la ruta de chat baja de 1,22 MB a 421 kB de First Load JS (−65 %); `[chatid]`, de 1,21 MB a 406 kB. La base compartida sigue en 90 kB.
- Decidido: history, timeline y export leen por páginas con `limit`/`offset` acotados en `lib/server/pagination.ts`. Ningún valor del query string puede restablecer una lectura sin límite: lo inservible cae al valor por defecto y lo excesivo se recorta al máximo.
- Decidido: las rutas piden una fila de más para responder «¿hay más?» sin una segunda consulta de conteo.
- Decidido: el export sigue siendo completo; el cliente recorre `nextOffset` y fusiona las páginas. Se ordena por `created_at` ascendente para que las filas escritas durante un export solo se añadan después de la última página y el paginado por offset no pueda saltarse filas anteriores.
- Decidido: `exportedAt` se fija en la primera página y se reutiliza, para que el backup lleve la hora de inicio y no la de cada página.
- Límite aceptado: en el timeline los filtros y los contadores se aplican a lo ya cargado; el pie lo dice explícitamente para que una búsqueda sin resultados no se confunda con un historial vacío.
- Decidido: el rail lateral usa `auto-rows` en vez de `grid-rows-7` con altura fija. Hay ocho elementos y el octavo caía en una fila implícita fuera de los 440 px.
- Decidido: `CHAT_COMPOSER_CONTAINER` centraliza la cadena de breakpoints del compositor, duplicada entre la pantalla de chat vacío y la conversación activa. Se elimina el paso `lg` por ser idéntico a `md`.
- Verificado: `lint`, `format:write`, type-check en condiciones de clon limpio, 250 pruebas Jest en 28 suites (16 nuevas) y build de producción.
- Sin cambios: seguridad, migraciones y las fases 3 y 4 de la auditoría.

## 2026-08-19 — Fase 3: memoria tipada, cacheada, presupuestada y visible

Cuatro PRs apilados sobre la rama de auditoría, uno por hallazgo, en orden de dependencia.

### ARCH-04 — metadatos tipados en `summaries` (PR #9)

- Decidido: añadir `source`, `kind`, `title` y `occurred_at`, rellenados por la propia migración para que la tabla quede consistente en cuanto termina.
- Decidido: los prefijos siguen en `content`. El bloque de memoria inyectado los cita y el formato de backup depende de ellos; mantenerlos también deja seguro un rollback de código.
- Decidido: un único clasificador (`lib/summary-metadata.ts`) los produce y el backfill de la migración lo replica en SQL. Ambos lados se fijan a las mismas 20 fixtures, porque dos implementaciones de una regla solo se mantienen honestas si se comprueban contra la misma tabla de casos.
- Preservado a propósito: `[source:chatgpt]%` nunca casaba con `[source:chatgpt:summary]`, así que los resúmenes LLM de importaciones caían en el bucket personal (tope 1500) y no en el bulk (tope 400). El comportamiento gana al comentario: un tope de 400 los truncaría a media frase.
- Decidido: el `CHECK` cierra el conjunto de fuentes, y eso es lo que permite enumerar `(claude, other)` en positivo en vez de negar.
- Verificado: contra PostgreSQL 16 desechable, el backfill y el clasificador TypeScript producen salida idéntica en las 20 fixtures; los constraints rechazan valores desconocidos.
- Despliegue obligatorio: aplicar la migración ANTES de publicar el código. Al revés, las consultas de memoria filtran por columnas inexistentes; el chat sigue funcionando porque las rutas degradan a sin-memoria, pero la memoria desaparece hasta que la migración llegue.
- Pendiente: aplicar la migración remota solo con confirmación explícita, y regenerar `supabase/types.ts` después (ahora está editado a mano para igualar lo que emitirá el generador).

### ARCH-03 — caché del blob base (PR #10)

- Rechazado: caché por TTL. Serviría memoria a sabiendas desactualizada — el resumen escrito tras el turno anterior faltaría en el siguiente.
- Decidido: clave de versión leída de la base de datos, de modo que una entrada está vigente o se falla, nunca obsoleta. Además no requiere coordinación entre instancias.
- Decidido: la versión incluye el recuento de filas, no solo el `created_at` más reciente. Borrar una fila antigua desde el panel deja intacta la más nueva, y una versión basada solo en la marca de tiempo seguiría sirviendo lo borrado.
- Decidido: caché acotada y LRU; un `null` cacheado es una respuesta real y se distingue de un fallo de caché.

### ARCH-01 — un solo presupuesto de contexto (PR #11)

- Decidido: `resolveContextBudget` reparte la ventana real del modelo entre respuesta, historial y memoria; el cliente recorta a su parte y el servidor vuelve a resolver el reparto en vez de fiarse del enviado.
- Verificado: con ventana de 128k y ajustes por defecto, el reparto da exactamente las constantes anteriores (80k personal, 20k bulk, 6k relevante, 120k conversación completa). Acotar la petición no encoge lo que recibe un modelo capaz.
- Decidido: un modelo desconocido cae a una suposición conservadora de 8k en vez de suponer alto. Suponer alto para un modelo desconocido es justo lo que producía peticiones fuera de límite.
- Decidido: el presupuesto forma parte de la clave de caché del blob base; las mismas filas bajo otra asignación son otro blob.

### ID-02 — memoria visible en el chat (PR #12)

- Decidido: el servidor informa de lo que inyectó mediante una cabecera de respuesta, porque el cuerpo es un stream de texto plano.
- Decidido: el informe se deriva de las propias secciones del bloque ya ensamblado, no de contadores nuevos en cada capa; el constructor ya delimita cada sección, así que no se crea una segunda fuente de verdad.
- Decidido: una cabecera ausente o ilegible degrada a «sin indicador», nunca a un turno fallido.
- Decidido: una recuperación que no encuentra nada también se muestra. Al modelo se le dijo que lo admitiera en vez de reconstruir la conversación, y quien lee merece saberlo.
- Decidido: el informe se re-indexa del id optimista al id persistido cuando se guarda el turno.
- Verificado: 327 pruebas Jest en 33 suites, type-check en condiciones de clon limpio y build de producción en las cuatro ramas.

## 2026-08-21 — Durabilidad de la memoria (ARCH-09, ARCH-10, ARCH-08)

- Decidido: `callSummarizerWithMeta` expone `finish_reason === "length"`. Es la señal definitiva de truncamiento y no había forma de verla; `callSummarizer` queda como envoltorio de texto para quienes añaden en vez de reemplazar.
- Decidido: una reescritura de lecciones debe ganarse la escritura. Tres comprobaciones independientes porque la señal más fiable no siempre está: truncamiento reportado, pérdida de alguna cabecera `##` presente antes, y encogimiento por debajo del 80 % del documento previo.
- Motivo: la pasada de lecciones reemplaza el documento entero y `user_lessons` no tiene historial de versiones. Una reescritura truncada parece un documento más corto válido, y escribirla destruye los hechos a los que el modelo no llegó.
- Decidido: `lessonsRewriteMaxTokens` escala con el tamaño del documento en vez del 800 fijo, que garantizaba truncamiento en cuanto el documento lo superaba. Con techo, para que un documento desbocado no pida salida ilimitada.
- Decidido: pasado `MAX_LESSONS_CHARS` la ruta omite la reescritura y lo registra. Ni siquiera el techo podría reformular el documento; intentarlo arriesga justo la pérdida que esto evita.
- Decidido: `replaceLessons` condiciona la escritura al `updated_at` leído. El upsert ciego anterior convertía dos resúmenes simultáneos en una carrera donde el segundo descartaba en silencio los hechos del primero.
- Decidido: quien pierde la carrera no reintenta. El documento del ganador es ahora la base, y reescribir desde la copia obsoleta reintroduciría la pérdida.
- Decidido: `keepalive: true` en la llamada a `/api/memory/summarize`. El momento justo tras una respuesta es el más natural para cerrar la pestaña, y sin eso el navegador cancelaba la petición y el turno nunca se recordaba.
- Decidido: su fallo sigue sin ser fatal, pero deja de ser silencioso; el catch vacío hacía indistinguible el fallo del éxito.
- Decidido: el guardia de duplicados compara contra las últimas ocho filas de tipo `conversation`, no solo la más reciente. Con dos conversaciones intercaladas, la fila más nueva pertenecía a la otra y cada resumen parecía nuevo.
- Límite aceptado: el arreglo completo de ARCH-08 —una fila por chat en vez de una por turno— necesita `chat_id` en `summaries`, es decir otra migración. Queda pendiente hasta que la de metadatos tipados esté aplicada.
- Verificado: 348 pruebas Jest en 35 suites (21 nuevas), type-check en condiciones de clon limpio y build de producción.

## 2026-08-25 — Las filas índice consumían la asignación de memoria

- Descubierto al verificar el backfill en producción: una fila `index` de 58 007 caracteres, más catorce de ChatGPT a ~4 000. Las filas índice se inyectaban enteras, antes que las demás capas, y no se contaban contra ningún presupuesto.
- Medido: ~74 k de los 100 k de asignación consumidos por índices antes de considerar ninguna de las 665 filas personales ni las 549 bulk.
- Descartada la primera hipótesis: no era una mala clasificación. `position('Conversation Index' in content)` da 9, 10 o 33 en las dieciséis filas, es decir el marcador está al principio tras la etiqueta `[source:X]`. Todas son índices legítimos. El clasificador es correcto y no hace falta migración.
- Causa real: el diseño suponía que un índice era diminuto — el comentario decía «tiny» — y un import masivo real produce una lista de fechas de 58 k.
- Decidido: las filas índice reciben su propia cuota (`INDEX_SHARE`, 10 % de la asignación) y un tope por fila de 4 000 caracteres, igual que las demás capas.
- Motivo del tope por fila y no solo de cuota: una única fila enorme agotaría la cuota entera y dejaría fuera los índices de las otras fuentes.
- Aceptado: truncar un índice cuesta las entradas más antiguas de esa fila. Es una lista de fechas, así que el corte no corrompe nada, y el coste es menor que perder el contenido real de las conversaciones.
- Decidido: `indexChars` entra en la clave de caché del blob base, como el resto de cuotas.
- Verificado: las tres pruebas nuevas fallan contra el comportamiento anterior y pasan contra el corregido; 352 pruebas en 35 suites, type-check en clon limpio y build de producción.
- Pendiente: que el importador escriba varias filas índice más pequeñas en vez de una gigante sería el arreglo de fondo.

## 2026-09-24 — Recuperación tras auditar un `main` desactualizado

- Descubierto: la auditoría y el PR #40 se hicieron sobre un checkout local 70 commits por detrás de `origin/main`. `main` ya tenía su propia fábrica (`createChatRoute`), el guardado de límites, el stream de Google y el error de Azure.
- Decidido: no resolver el conflicto de #40; recuperar sobre `main` solo lo que seguía roto, usando `createChatRoute` y `chatErrorMessage` en vez de la fábrica y `http-error.ts` de #40.
- Recuperado: temperatura en Groq/Mistral/Perplexity; 400 para JSON mal formado en el sobre y en `command`; `command` usa `chatErrorMessage`; la ruta custom usa el `readLimitedJson` compartido; `image_path` se conserva al guardar el perfil; dos commits de documentación que quedaron sin fusionar en `claude/chatmemo-server-global-state` (cierre de ARCH-07).
- Decidido: los rangos de fecha del recall se construyen en UTC. En local (UTC+7) la prueba fallaba y el hook pre-push bloqueaba todos los pushes; además el mes sin año perdía el 29 de febrero.
- Descartado de #40: `getServerProfile` → 401 (solo cambia el código en rutas de chat, el resto responde 500 igualmente; va con `requireUser()`), y el cambio `||` → `&&` del foco (sin síntoma observado y comportamiento pretendido dudoso).
- Verificado: 632 pruebas en 65 suites, type-check, lint sin avisos nuevos, `format:check` y build de producción; la prueba de fechas pasa en Bangkok, UTC, Los Ángeles y Kiritimati.

## 2026-09-24 — Cinco seguimientos de la re-auditoría (PRs apiladas)

- Código muerto: 29 archivos inalcanzables (grafo de imports desde los entrypoints de Next) y 19 paquetes eliminados. Se conserva `/api/username/get` aunque nadie lo llama: se endureció a propósito en la auditoría de seguridad; borrarlo es decisión de producto.
- Next 15.5.26 + React 19, no Next 16. Las dos críticas no alcanzan este despliegue (el servicio de imágenes de Vercel tiene AVIF desactivado; Vercel no es Windows), pero 14.2.35 no recibe más parches para ~20 avisos de DoS/SSRF/caché. Next 16 añade la eliminación del acceso síncrono y el renombrado de middleware: se aplaza.
- `@typescript-eslint/parser` se declara explícitamente: `.eslintrc.json` lo nombra y `eslint-config-next` 15 ya no lo eleva; sin él `next lint` fallaba con 0 avisos aparentes.
- `HttpError` es la base de los errores de ruta visibles; `SafeModelRequestError` queda aparte porque la ruta custom lo registra con su correlation id antes de responder. `chatErrorMessage` deja pasar los `HttpError`: un 401 de sesión no es una clave incorrecta (lo detectó la prueba en navegador).
- `requireUser()` para rutas que solo necesitan `user_id`; `getServerProfile()` para las que necesitan claves.
- Fábrica `workspaceItems(table)`: supabase-js no tipa consultas con nombre de tabla genérico, así que la fábrica usa un cliente sin tipos por dentro y aplica Insert/Update/Row en la frontera. Rechazado: mantener seis copias tipadas.
- Tools inyecta memoria como el resto de rutas; `custom` y Ollama siguen sin ella.
- Pendiente: los `as any` de `createXWorkspaces` en `sidebar-update-item` ocultan que `applyChanges` tipa las filas con una clave literal `item_id`; `<html lang="en">` fijo en todas las locales.

## 2026-09-24 — Memoria para modelos custom y Ollama

- Decidido: `custom` inyecta memoria solo si el modelo es del propio usuario. Un modelo compartido apunta al endpoint de otra persona; enviarle la memoria filtraría historial privado a un tercero.
- Decidido: Ollama obtiene el bloque desde el navegador (`POST /api/memory/block`) y lo antepone con `lib/memory-block.ts`; la inferencia sigue navegador → localhost y la conversación no pasa por el servidor.
- Rechazado: devolver al servidor los mensajes completos para aumentarlos allí — duplica el payload (imágenes base64) contra el límite de cuerpo de Vercel.
- Decidido: cualquier fallo al pedir el bloque deja el turno local sin memoria, nunca falla el chat.

## 2026-09-29 — «conversaciones de ayer» respondía que no había nada

- Síntoma: preguntar «conversaciones de ayer» devolvía «no encuentro ninguna conversación», con 100 entradas de memoria inyectadas.
- Causa 1 (regresión de c40fccd, 2026-09-11): la recuperación de chats in-app ordenaba `chats` por `MEMORY_ORDER_COLUMN` (`effective_at`), columna que solo existe en `summaries`. Cada consulta fallaba y el error se descartaba junto con `data`: desde entonces ningún chat in-app se recuperó por transcripción.
- Causa 2: la petición no activaba la recuperación completa (ninguna frase disparadora), y «ayer» acababa como término de búsqueda de relevancia, trayendo filas que contenían la palabra.
- Causa 3: los resúmenes in-app no llevan cabecera `### [fecha]`, así que en el bloque base el modelo no podía distinguir los de ayer de los de mayo.
- Decidido: pedir conversaciones/chats/resumen de un día o periodo (ayer, anteayer, hoy, semana/mes pasado, EN y ES) activa la recuperación; las palabras de fecha relativa se quitan de los términos de búsqueda.
- Decidido: con rango de fechas, `summaries` se busca por `effective_at` dentro del rango (ordenado por términos si los hay), no por texto en todo el historial; los chats filtrados por tema caen a solo-fecha si el tema no está en el nombre.
- Decidido: el bloque base antepone `### [YYYY-MM-DD]` (de `effective_at`) a las filas sin fecha propia; las que ya la tienen no se tocan.
- Decidido: un día ISO explícito se interpreta en UTC, como el resto de rangos.
- Aceptado: con «hoy», el propio chat actual ocupa uno de los tres huecos de chats.
- Verificado: las cuatro pruebas nuevas de recuperación fallan contra el código anterior; 662 pruebas en 69 suites, type-check, lint, format y build.

## 2026-09-29 — Las sesiones de Claude Code se quedaban en su tercer turno

- Descubierto: el hook Stop se dispara tras cada turno e importaba la sesión en cuanto alcanzaba tres mensajes del usuario, marcándola como hecha. El watcher la saltaba después. Una sesión larga quedaba recordada solo por su comienzo.
- Descubierto: el hook no registraba nada. Una clave rotada, un proyecto movido o un fallo de OpenRouter no dejaban rastro.
- Sospecha descartada: se creyó que la migración `20260924000000_summaries_metadata_trigger` no estaba aplicada en producción. `select count(*) from summaries where kind is null` devolvió 0; las filas de Claude Code llegaban a diario. Ver la entrada siguiente.
- Decidido: la sesión se resume de nuevo al crecer (cada 5 mensajes del usuario en Stop, cualquier crecimiento en SessionEnd o tras 10 min inactiva en el watcher) y la fila nueva sustituye a la anterior: insertar primero, borrar después, como `replaceChatSummary`.
- Decidido: el id de la fila se guarda en `imported-sessions.json`. Rechazado: un marcador en `content` para encontrar la fila — ensucia el bloque inyectado. Las entradas antiguas (cadena ISO, sin id) se dejan como están: sin id, re-sincronizar duplicaría la fila.
- Decidido: el hook delega en un proceso hijo desacoplado; Claude Code no espera al resumidor, ni en Stop ni al cerrar la sesión.
- Decidido: un lock por sesión en `~/.chatmemo/locks/`; Stop, SessionEnd y el watcher pueden coincidir, y dos reemplazos simultáneos dejarían un duplicado.
- Decidido: todo resultado, fallos incluidos con su HTTP y cuerpo, va a `~/.chatmemo/sync.log`.
- Rechazado: que los scripts escriban `kind`/`source` ellos mismos. El trigger es el único clasificador para escritores de solo-contenido (#49); una segunda copia en .mjs volvería a divergir.
- Añadido: `CHATMEMO_CONFIG_DIR` sustituye `~/.chatmemo`. La prueba lo necesita: el `process.env` del sandbox de Jest no llega a `os.homedir()`, y la primera ejecución escribió en el `~/.chatmemo` real del contenedor (limpiado).
- Verificado: 671 pruebas en 70 suites (9 nuevas), type-check, lint y build; el hook real devuelve en ~60 ms y el proceso hijo registra el fallo en `sync.log`.

## 2026-09-29 — Sesiones sin corchetes en la fecha y fechadas por mtime

- Corrección de la entrada anterior: la memoria no estaba bloqueada por una migración. Las filas llegaban; al 28 no le correspondía ninguna porque la única sesión con actividad ese día (`551dab39`) se había resumido el 26 en su tercer turno — el corte que arregló #52.
- Descubierto: el resumidor del hook Stop escribía `### 2026-09-27 Título`, sin corchetes. Ningún clasificador lo reconocía: `occurred_at` NULL, `source` `other` en vez de `claude`, y el título empezaba por la fecha. El panel de memoria tampoco las contaba y mostraba «→ 2026-09-19» con una semana de sesiones en la misma sección.
- Decidido: aceptar las dos formas en el clasificador, el trigger (migración `20260929000000`, que además re-deriva las filas existentes), el informe del panel, el timeline y las etiquetas de fecha del bloque base. La fecha pelada exige límite de palabra, así que `2026-09-27T10:00` no cuenta como cabecera.
- Descubierto al recuperar `551dab39`: el importador fechaba por el mtime del fichero, y algo lo había tocado el 29; la sesión del 28 quedó bajo el 29. Decidido: fechar por la marca de tiempo del último mensaje del transcript, con el mtime como respaldo.
- Descubierto: OpenRouter retiró `openai/gpt-oss-120b:free` (404 «unavailable for free»). Cada resumen pagaba ya el modelo de respaldo tras una petición que solo podía fallar. Decidido: quitarlo de las dos listas (servidor y scripts).
- Pendiente: el nombre de proyecto en worktrees sale del id de la carpeta (`1eef95`, `93ad16`).
- Verificado: pruebas de integración SQL del trigger (#49 y la nueva) contra un PostgreSQL 16 desechable; las 21 fixtures de #49 siguen igual con la migración nueva salvo la fila del hook, que es el cambio buscado. Seis pruebas nuevas fallan contra el código anterior.

## 2026-09-29 — Sesiones de Claude Code en la nube

- Descubierto: dos de las tres sesiones del 28 («Search results mixing across users», «bl-site-cliente vs Shoroban features») las lanzó la app de escritorio pero corrieron en la nube (`environment_kind: anthropic_cloud`). Su transcript nunca está en `~/.claude/projects/` del Mac, así que ni el hook ni el watcher las ven. Todas las sesiones en la nube desde el 21 de agosto faltan en la memoria.
- Decidido: un hook dentro del contenedor en la nube que publica la sesión en `/api/import/conversation` (Bearer token existente). El servidor resume con su propia clave de OpenRouter; el contenedor solo necesita `CHATMEMO_IMPORT_TOKEN` y acceso de red a `chatmemo-one.vercel.app`. Rechazado: dar al contenedor credenciales de Supabase y OpenRouter.
- Decidido: el hook se sirve desde la app (`public/hooks/chatmemo-cloud-sync.mjs`) y lo instala el script de setup del entorno, para todos los repos a la vez. Rechazado: un hook en `.claude/settings.json` de cada repo — hay una docena de repos.
- Decidido: columna `summaries.external_id` (clave `claude-code:<session id>`) para reemplazar la fila anterior de la sesión. Rechazado: `chat_id`, que referencia `chats(id)`. Sin la migración, las filas se guardan igual (sin la clave) y solo no se deduplican.
- Decidido: lock por sesión en el hook. Dos publicaciones simultáneas de la misma sesión insertarían cada una su fila y borrarían la de la otra, dejando la sesión sin ninguna.
- Decidido: el endpoint responde 401 a un token inválido (antes 500) y tiene `maxDuration = 60` — un transcript de la nube es mucho más largo que una página del bookmarklet. Se envían como máximo los 80 000 caracteres más recientes.
- Aceptado: las sesiones en la nube anteriores no se recuperan; no hay forma de leer sus transcripts desde el Mac.
- Verificado: el hook real, ejecutado en una sesión en la nube contra un servidor simulado, devuelve en 83 ms, publica una vez con la clave, título y fecha correctos, y no vuelve a publicar sin crecimiento.

## 2026-09-29 — El hook en la nube no salía del contenedor, y el resumidor descartaba sesiones

- Descubierto al probarlo de extremo a extremo desde una sesión en la nube: el `fetch` de Node ignora `HTTPS_PROXY`, así que la petición salía directa y la red la rechazaba («Host not in allowlist»); `curl`, que sí usa el proxy, había dado por buena la conectividad. Decidido: el hook lanza su proceso hijo con `NODE_USE_ENV_PROXY=1` cuando hay proxy (Node ≥ 22.21) y `--no-warnings`.
- Descubierto: la misma sesión se publicó dos veces con 4 minutos de diferencia; la primera volvió como «Nothing worth remembering», la segunda se guardó. Hipótesis (sin confirmar: OpenRouter está bloqueado desde el contenedor): gpt-oss razona antes de responder, el razonamiento cuenta contra `max_tokens`, y en un transcript largo a veces lo agota; la respuesta vacía se leía como SKIP y la conversación se perdía en silencio.
- Decidido: `reasoning: { effort: "low" }` y 2 000 tokens de margen sobre el límite de cada llamador, en el servidor y en los scripts del portátil. Una respuesta vacía cortada por longitud lanza `SummaryCutOffError` (se registra y se reintenta) en vez de pasar por «nada que recordar». Los llamadores ya capturaban errores.
- Verificado: el hook corregido publicó esta sesión en producción desde la nube sin ninguna variable manual; 4 pruebas nuevas del resumidor, 2 de ellas fallan con el código anterior.

## 2026-09-29 — Respuestas cortadas sin aviso

- Descubierto: una respuesta de gpt-oss-120b sobre un transcript recuperado se cortó a media frase («PR #72 añadió registro de solicitudes lentas (2») sin ninguna señal en pantalla. `lib/server/streaming.ts` no leía por qué paró el modelo, así que un corte por longitud terminaba igual que una respuesta completa.
- Hipótesis (sin confirmar: OpenRouter bloqueado desde el contenedor y los logs de Vercel duran una hora): el tope de respuesta era de 4 096 tokens —el catálogo de OpenRouter no da límite de salida— y el razonamiento oculto de gpt-oss cuenta contra ese mismo tope. Se confirma en openrouter.ai/activity con `finish_reason: length`.
- Decidido: cuando el modelo para por longitud (`finish_reason: "length"` en formato OpenAI, `stop_reason: "max_tokens"` en Anthropic), se añade una nota visible al final de la respuesta.
- Decidido: los modelos de OpenRouter reservan 16 384 tokens de respuesta, recortados igualmente al 25 % de la ventana. Rechazado: sumar margen fuera del presupuesto en la ruta, que podría pasar de la ventana; y bajar el esfuerzo de razonamiento en el chat, que empeoraría las respuestas. En una ventana grande el bloque de memoria no pierde nada (tope de 100 000 caracteres).
- Verificado: 3 pruebas nuevas fallan con el código anterior; las de «sin cambio» pasan en ambos.
