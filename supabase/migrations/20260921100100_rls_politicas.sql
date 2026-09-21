-- =============================================================================
-- Flota Prakisama · Migración 2: Row Level Security
--
-- Principios:
--  1. RLS activado en TODAS las tablas. Sin política = nadie accede (denegado por defecto).
--  2. Solo el rol `authenticated` recibe políticas; `anon` (sin sesión) no puede nada.
--  3. Dos roles de negocio:
--       admin     → todo, incluida la configuración.
--       encargado → ver vehículos, registrar mantenimientos y km (y adjuntos de mantenimiento).
--     Ambos deben tener un perfil ACTIVO (is_member / is_admin); desactivar un perfil corta el acceso.
--  4. Las llamadas de las Edge Functions usan la service_role, que se salta RLS: por eso las tablas
--     que solo tocan ellas (notifications_sent) no tienen política de escritura para nadie más.
--  5. `(select public.is_admin())` en lugar de `public.is_admin()` a secas: Postgres evalúa la
--     función una vez por consulta y no una vez por fila (recomendación de rendimiento de Supabase).
-- =============================================================================

alter table public.profiles              enable row level security;
alter table public.vehicles              enable row level security;
alter table public.itv_rules             enable row level security;
alter table public.itv_inspections       enable row level security;
alter table public.maintenance_rules     enable row level security;
alter table public.maintenance_records   enable row level security;
alter table public.attachments           enable row level security;
alter table public.notification_settings enable row level security;
alter table public.notifications_sent    enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
--   ver:        cada usuario su fila; el admin todas (para gestionar roles).
--   modificar:  cada usuario su fila; el admin todas. El trigger profiles_guard impide que un
--               no-admin cambie rol/estado/email/token (solo su nombre).
--   insertar:   nadie (lo hace el trigger handle_new_user). borrar: nadie (se desactiva).
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- vehicles
--   ver: cualquier miembro. crear/editar: solo admin. borrar: NADIE (baja lógica con active=false).
--   Los km los actualiza cualquier miembro mediante set_vehicle_usage() y el trigger de registros.
-- ---------------------------------------------------------------------------
create policy vehicles_select on public.vehicles for select to authenticated
  using ((select public.is_member()));

create policy vehicles_insert on public.vehicles for insert to authenticated
  with check ((select public.is_admin()));

create policy vehicles_update on public.vehicles for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- itv_rules (configuración): ver todos los miembros (la app calcula fechas); editar solo admin.
-- ---------------------------------------------------------------------------
create policy itv_rules_select on public.itv_rules for select to authenticated
  using ((select public.is_member()));

create policy itv_rules_update on public.itv_rules for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- itv_inspections: ver todos los miembros; registrar/editar/borrar solo admin.
-- ---------------------------------------------------------------------------
create policy itv_inspections_select on public.itv_inspections for select to authenticated
  using ((select public.is_member()));

create policy itv_inspections_insert on public.itv_inspections for insert to authenticated
  with check ((select public.is_admin()));

create policy itv_inspections_update on public.itv_inspections for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy itv_inspections_delete on public.itv_inspections for delete to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- maintenance_rules (configuración por vehículo): ver todos; gestionar solo admin.
-- ---------------------------------------------------------------------------
create policy maintenance_rules_select on public.maintenance_rules for select to authenticated
  using ((select public.is_member()));

create policy maintenance_rules_insert on public.maintenance_rules for insert to authenticated
  with check ((select public.is_admin()));

create policy maintenance_rules_update on public.maintenance_rules for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy maintenance_rules_delete on public.maintenance_rules for delete to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- maintenance_records
--   ver: todos los miembros. registrar: cualquier miembro (y queda anotado quién: created_by).
--   corregir/borrar: el admin, o el propio autor de ese registro.
-- ---------------------------------------------------------------------------
create policy maintenance_records_select on public.maintenance_records for select to authenticated
  using ((select public.is_member()));

create policy maintenance_records_insert on public.maintenance_records for insert to authenticated
  with check ((select public.is_member()) and created_by = (select auth.uid()));

create policy maintenance_records_update on public.maintenance_records for update to authenticated
  using ((select public.is_admin()) or (created_by = (select auth.uid()) and (select public.is_member())))
  with check ((select public.is_admin()) or (created_by = (select auth.uid()) and (select public.is_member())));

create policy maintenance_records_delete on public.maintenance_records for delete to authenticated
  using ((select public.is_admin()) or (created_by = (select auth.uid()) and (select public.is_member())));

-- ---------------------------------------------------------------------------
-- attachments
--   ver: todos los miembros.
--   añadir: un miembro a un registro de mantenimiento; solo admin a una inspección de ITV.
--   borrar: el admin o quien lo subió.
-- ---------------------------------------------------------------------------
create policy attachments_select on public.attachments for select to authenticated
  using ((select public.is_member()));

create policy attachments_insert on public.attachments for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (maintenance_record_id is not null and (select public.is_member()))
      or (itv_inspection_id is not null and (select public.is_admin()))
    )
  );

create policy attachments_delete on public.attachments for delete to authenticated
  using ((select public.is_admin()) or (created_by = (select auth.uid()) and (select public.is_member())));

-- ---------------------------------------------------------------------------
-- notification_settings (una fila): ver todos los miembros (la app necesita las antelaciones para
-- pintar el semáforo); modificar solo admin. No hay insert/delete: la fila id=1 ya existe.
-- ---------------------------------------------------------------------------
create policy notification_settings_select on public.notification_settings for select to authenticated
  using ((select public.is_member()));

create policy notification_settings_update on public.notification_settings for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- notifications_sent: solo lectura para el admin (auditoría). Las escrituras las hace la Edge
-- Function con service_role; ningún usuario de la app puede insertar, editar ni borrar.
-- ---------------------------------------------------------------------------
create policy notifications_sent_select on public.notifications_sent for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Permisos de ejecución de las funciones SECURITY DEFINER: solo usuarios con sesión.
-- (Dentro de cada una se vuelve a comprobar el rol.)
-- ---------------------------------------------------------------------------
revoke execute on function public.set_vehicle_usage(uuid, integer) from public, anon;
revoke execute on function public.rotate_calendar_token() from public, anon;
grant  execute on function public.set_vehicle_usage(uuid, integer) to authenticated;
grant  execute on function public.rotate_calendar_token() to authenticated;
