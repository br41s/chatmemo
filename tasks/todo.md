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
- [x] Publicar el cambio mediante una rama y el PR [#5](https://github.com/braisntext/chatmemo/pull/5).

## Revisión de la auditoría y correcciones derivadas

- [x] Revisar los tres commits de seguridad, las migraciones RLS y los módulos SSRF.
- [x] Verificar el estado real: `type-check`, suite Jest, lint y migraciones aplicadas en remoto.
- [x] Restaurar la respuesta previa cuando falla una regeneración en las rutas hosted y Ollama.
- [x] Unificar `readLimitedJson` en la ruta de herramientas con el helper compartido.
- [x] Alinear `isShareableToolSchema` con `tool_schema_contains_credentials` para esquemas que no son objeto.
- [x] Añadir pruebas de regresión del rollback y de la paridad de esquemas.
- [x] Ejecutar `format:check`, `type-check`, la suite completa y el build de producción.
- [x] Publicar tres commits atómicos y abrir el PR [#6](https://github.com/braisntext/chatmemo/pull/6).

Trabajo futuro fuera de este cambio:

- [ ] Inyectar memoria persistente en Ollama manteniendo la inferencia local.
- [ ] Inyectar memoria persistente en modelos remotos personalizados.

## Memory-first chat UI (2026-09-30, branch feat/memory-first-chat-ui)

Scope agreed: daily-driver audience · chat + memory reveal first · restyle + memory-first nav · upstream structure kept.

- [x] Memory report carries matched entries (title, source, date), capped; header size guard drops items before dropping the report. Tests.
- [x] Stats endpoint returns per-source counts and newest memory date; pure aggregator with a test.
- [x] Streaming wait state shows "recalling" with source chips from the report; post-answer panel lists matched entries with source colours.
- [x] Empty state: memory constellation (per-source counts, newest date) + suggestions, animated entrance.
- [x] Rail: Chats · Timeline · Memory on top; presets/prompts/models/files/collections/assistants/tools under a "More" popover. Tabs stay controlled from dashboard.
- [x] Identity: new ChatMemo mark, softer chat header, composer focus in brand hue, keyframes for recall pulse.
- [x] Gate: `npm run type-check`, `npx jest`, `npm run build`.
- [x] Docs: CLAUDE.md memory-system section mentions the report items; decisions log entry.
- [x] QA in the browser pane on the signed-in account: rail, More group, empty state, thinking state, panel under the answer.

Out of scope (follow-ups): theme toggle placement, /help page, landing/login redesign, timeline as a full page.

## UI follow-ups after the memory-first slice (2026-09-30, branch fix/ui-follow-ups)

- [x] PR #58 merged (squash `86969ff`).
- [x] Composer and messages sized to the chat column, not the window (overflow with the sidebar open at mid widths).
- [x] No button inside a button: `WithTooltip interactive`, `PopoverTrigger asChild` on chat settings.
- [x] Allowance line says how far over the block ran instead of "115k of 100k (100%)". Component test.
- [x] Empty state uses the full column width (tagline and counts no longer wrap at half width).
- [x] Gate: type-check, jest (717), build.
- [x] PR #59 merged (squash `47819d9`).
- [x] Decided: parallel preview request. `/api/memory/recall` + wait state, branch `feat/memory-recall-preview`. Verified live: preview names match the real report.
- [ ] Next slice (chosen by Brais): memory budget overrun — layer shares add up to 116% of the allowance and lessons are unbudgeted.
- [ ] Separate slices: theme toggle placement, /help page, landing/login, timeline as a page, Claude Code source label (needs a `source` value and a migration).

## Memory block fits its allowance (2026-09-30, branch fix/memory-budget-fits)

- [x] Found: layer shares summed to 116% of `memoryChars`; lessons (up to ~23.7k) and the 3.1k instruction text counted against nothing; a recovered transcript was allowed 120%. Harmless on 128k windows, an overflow on 8k–32k ones.
- [x] Every part of the block has an allowance and they sum to it: overhead reserve, lessons, four layers; transcript takes the content's place.
- [x] Large windows unchanged: 80k / 20k / 10k / 6k, lessons whole, 120k transcript. Ceiling stated as 146k.
- [x] Lessons cut at a line break with a note when they do not fit; no block when the window cannot hold the overhead; warning logged if a block ever exceeds its allowance.
- [x] Tests build the real block at seven window sizes. Gate: type-check, jest, build.
- [x] Live check through `/api/memory/block` on real memory at 128k, 32k, 16k, 8k, 4k, 2k.
- [x] Review fixes: lessons allowance 32k (the rewrite's output ceiling, not its input limit); a miss is recognised by the sentinel's header, not by its words appearing in a transcript; a layer's first entry is cut to fit instead of dropped; fit tests cover both worst cases (full layers, maximum separators).
- [x] Decided by Brais: provider fallback windows (Anthropic 200k, OpenAI 128k) for catalogue models that report no limits; custom endpoints use their stored context length; Ollama stays at 8k.
- [ ] Possible refinements, not done: hand unused lessons allowance to the history layers on mid-size windows; cut lessons per section instead of from the end; `CHARS_PER_TOKEN = 4` is optimistic for Spanish and code.

## Theme toggle and help page (2026-10-01, branch feat/theme-toggle-and-help)

- [x] Theme toggle in the rail above profile settings; icon shows what a click switches to; no icon until hydrated. Removed from the profile sheet.
- [x] /help is a real page: what the memory is made of, how to read the line under an answer, things to ask, getting history in, the rail, shortcuts, links to the guide and the repo. Tab title via a layout. The chat's ? popover opens it in place.
- [x] One shortcut list (`lib/shortcuts.ts`) for the popover and the page; test checks it against the `useHotkey` registrations (the popover had been two short).
- [x] Gate: type-check, jest (814), build. Checked in both themes.

## Landing and login polish (2026-10-01, branch feat/landing-login-polish)

- [x] Landing says what the product is, shows the source chips, offers "Start chatting" and "How it works" (/help).
- [x] Login: brand focus treatment on the fields (same as the composer), primary "Log in", outline "Create an account", reset link, styled message, link to /help. Email input typed and autocompleted.
- [x] Gate: type-check, jest (814), build. Landing checked in the browser; login checked on the PR preview (the local pane is signed in and is redirected).

## Timeline as a page (2026-10-01, branch feat/timeline-page)

- [x] `/[workspaceid]/timeline` page: activity chart on top (memory per month, stacked by source, a month click filters the list and loads it through that month), list and reader below with the room a real archive needs. Rail item is a link, lit on the page.
- [x] `/api/timeline/activity` pages through all rows (the first version returned exactly 1,000 of 1,338: PostgREST's default cap). `/api/timeline` gets a stable secondary order by id; the hook never appends a row twice.
- [x] Palette validated in both modes (dataviz skill): dark Claude and ChatGPT a step darker, a chart-only teal in light mode.
- [x] Gate: type-check, jest (820), build. Checked at 1200px and 375px.
- [ ] `components/timeline/timeline-sheet.tsx` is now unused; delete with Brais's OK.
- [ ] The chart counts memory rows; the list counts conversations (a bulk row holds several). Both are labelled as such.
