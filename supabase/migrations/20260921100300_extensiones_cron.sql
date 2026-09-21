-- =============================================================================
-- Flota Prakisama · Migración 4: extensiones para los avisos programados
--
-- pg_cron  → ejecuta tareas periódicas dentro de Postgres.
-- pg_net   → permite que esas tareas hagan una llamada HTTP a la Edge Function send-reminders.
--
-- La tarea programada NO va en una migración porque contiene la URL del proyecto y un secreto:
-- se crea a mano siguiendo supabase/sql/programar_avisos.sql (ver README, "Avisos por email").
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
