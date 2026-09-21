-- =============================================================================
-- Flota Prakisama · Migración 5: cerrar la ejecución de funciones SECURITY DEFINER
--
-- PostgREST expone como RPC las funciones del esquema public y por defecto cualquiera puede
-- ejecutarlas, también sin sesión (rol anon). Ninguna de estas funciones da acceso a datos a un
-- anónimo, pero no tienen por qué estar expuestas:
--   · is_member / is_admin: solo las usan las políticas RLS de usuarios con sesión.
--   · funciones de trigger: Postgres NO comprueba EXECUTE al dispararlas, así que se revoca a todos.
-- (set_vehicle_usage y rotate_calendar_token ya se restringieron en la migración 2.)
-- =============================================================================

revoke execute on function public.is_member() from public, anon;
revoke execute on function public.is_admin()  from public, anon;
grant  execute on function public.is_member() to authenticated;
grant  execute on function public.is_admin()  to authenticated;

revoke execute on function public.handle_new_user()                from public, anon, authenticated;
revoke execute on function public.profiles_guard()                 from public, anon, authenticated;
revoke execute on function public.itv_clear_manual_date()          from public, anon, authenticated;
revoke execute on function public.sync_vehicle_usage_from_record() from public, anon, authenticated;
