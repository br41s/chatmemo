# Errores

## 2026-07-28 — PostgreSQL desechable para pruebas RLS

- Falló: `libpq/bin/initdb` no incluye el servidor; usar `/opt/homebrew/opt/postgresql@18/bin/initdb`.
- Falló en sandbox: PostgreSQL necesita memoria compartida y acceso a socket local; inicialización, arranque y clientes requieren aprobación fuera del sandbox.
- Resuelto: PostgreSQL 18 local necesitaba `pgvector`; se instaló `pgvector` 0.8.5 con Homebrew.
- Falló: el arnés de `file_items` no concedía `USAGE` del esquema `extensions` al rol de prueba `authenticated`; añadir el grant después de crear `vector`.
- Falló: `SET search_path = ''` impide resolver `<=>`; las funciones de matching deben usar `OPERATOR(extensions.<=>)`.
- Falló: `replace_file_items` usa `item` como variable PL/pgSQL y alias SQL; renombrar el alias o referenciar una columna explícita antes de repetir la integración.
- Falló: la aserción histórica del arnés consulta `message_file_items`; conceder `SELECT` al rol `authenticated` de la base desechable.
