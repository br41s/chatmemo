# Corrección de consultas de username

- [x] Confirmar la causa: las rutas anónimas no pueden leer `profiles` por RLS.
- [x] Añadir RPCs autenticadas que expongan solo disponibilidad o username.
- [x] Validar y limitar las peticiones de ambas rutas.
- [x] Añadir pruebas de autorización, validación, colisión y errores.
- [x] Ejecutar una integración RLS real contra PostgreSQL 18 local desechable.
- [x] Ejecutar revisión Staff Engineer final sin hallazgos críticos.
- [x] Ejecutar la suite Jest, type-check, lint y `git diff --check`.
- [x] No aplicar la migración remota ni desplegar producción.
