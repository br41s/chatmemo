# Diseño: herramientas compartidas sin cabeceras secretas

Estado: APROBADO

## Problema

La política RLS actual permite leer cualquier fila de `tools` cuyo `sharing` no sea `private`. Como RLS filtra filas y no columnas, esa lectura incluye `custom_headers` y puede exponer API keys.

## Premisas acordadas

1. Una herramienta con `custom_headers` solo puede verla y ejecutarla su propietario.
2. Una herramienta compartida debe funcionar sin credenciales almacenadas en `custom_headers`.
3. La migración no reescribirá ni borrará filas existentes.

## Enfoques considerados

### A. Restringir la política por contenido — elegido

- La política pública solo permitirá filas con cabeceras vacías.
- Una restricción `CHECK ... NOT VALID` impedirá crear o actualizar combinaciones nuevas de `sharing != 'private'` con secretos.
- Las filas históricas incompatibles quedarán visibles únicamente para su propietario, sin modificar sus datos.
- Si el propietario edita después una fila histórica incompatible, deberá hacerla privada o eliminar sus cabeceras en esa misma actualización para satisfacer la nueva restricción.

Es el cambio mínimo: una migración, sin nueva tabla ni service role.

### B. Separar secretos en otra tabla

Permitiría que terceros ejecutasen herramientas compartidas usando la credencial oculta del creador. Requiere nueva tabla, RLS adicional, cliente servidor con service role y cambios de interfaz. Se rechaza porque contradice la regla escogida y aumenta el alcance.

### C. Hacer privadas todas las herramientas

Elimina el riesgo retirando la función de compartir. Se rechaza porque elimina comportamiento válido para APIs sin credenciales.

## Implementación propuesta

1. Eliminar `Allow view access to non-private tools` y crear en la misma migración una política `SELECT` para usuarios autenticados que exija `sharing <> 'private'` y `custom_headers` vacío. Las políticas permisivas se combinan con `OR`, por lo que no basta con añadir otra.
2. Considerar vacíos los valores JSONB `{}`, `""`, `null` y cualquier cadena que represente un objeto vacío rodeado únicamente por whitespace permitido por JSON (espacio, tabulador, LF o CR). El editor guarda texto sin normalizar; la condición de cadena no convierte ni evalúa JSON arbitrario.
3. Añadir una restricción no validada para bloquear nuevas escrituras inseguras sin alterar filas históricas, con un `lock_timeout` corto para no esperar indefinidamente por el bloqueo DDL.
4. Verificar propietario, usuario autenticado ajeno, herramienta sin cabeceras, herramienta con cabeceras e intentos nuevos de escritura inválida.

## Criterios de éxito

- El propietario conserva lectura, ejecución y borrado de sus herramientas y cabeceras. Para actualizar una fila histórica incompatible deberá hacerla privada o eliminar las cabeceras en la misma operación.
- Otro usuario puede leer una herramienta compartida sin cabeceras personalizadas.
- Otro usuario no puede leer una herramienta compartida con cabeceras personalizadas.
- No se puede crear ni actualizar una herramienta compartida con cabeceras no vacías.
- Ninguna fila existente se borra ni se reescribe durante la migración.

## Riesgo aceptado

Una herramienta histórica marcada como compartida pero con secretos dejará de aparecer a otros usuarios inmediatamente. Su propietario seguirá viéndola; la siguiente modificación deberá corregir esa combinación.

## Fuera de alcance

- Cifrado de secretos en reposo.
- Compartir credenciales de forma oculta entre usuarios.
- Detectar secretos incrustados manualmente en `schema` o `url`; este bloque corrige exclusivamente la exposición de `custom_headers`.
- RLS de otras tablas e IDOR distintos de `tools`.

## Revisión adversarial

Puntuación inicial: 7/10. Se corrigieron los puntos señalados: efecto de `NOT VALID` en actualizaciones históricas, sustitución explícita de la política permisiva y definición literal de todas las representaciones JSONB vacías que escribe la aplicación.

## Verificación local

- La migración se ejecutó contra PostgreSQL 18 en una base desechable.
- Se comprobaron propietario, tercero autenticado, rol anónimo, filas históricas, escrituras nuevas, objetos vacíos con whitespace JSON, JSON `null`, arrays y texto inválido.
- El comando reproducible es `CHATMEMO_RLS_TEST_DATABASE_URL=<base-desechable> npm run test:rls`; el test se niega a arrancar sin una URL explícita y su marca de integración.
