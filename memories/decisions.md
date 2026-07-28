# Decisiones

## 2026-07-28 — Consultas de username sin exponer perfiles

- Decidido: las rutas de disponibilidad y consulta requieren sesión autenticada.
- Decidido: RLS no se amplía sobre `profiles`; dos RPCs `SECURITY DEFINER` con `search_path` fijo devuelven únicamente un booleano o un username.
- Decidido: la disponibilidad excluye el perfil del usuario actual y el índice `UNIQUE` sigue siendo la defensa definitiva frente a carreras.
- Rechazado: usar `service_role` en las rutas o hacer legibles perfiles completos para resolver una consulta escalar.
- Verificado: la migración y las consultas pasaron contra PostgreSQL 18 local con casos de propietario, colisión, input inválido, rol anónimo y sesión sin `auth.uid()`.
- Pendiente: aplicar la migración remota solo con confirmación explícita.
