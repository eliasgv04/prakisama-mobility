-- =============================================================================
-- Prakisama Mobility · Migración 7: todos los usuarios son iguales
--
-- Decisión de la empresa: no hay administradores y encargados, solo usuarios. Cualquier usuario
-- ACTIVO puede hacer lo mismo (crear/editar vehículos, registrar ITV y mantenimientos, cambiar
-- reglas y ajustes). Sigue sin haber DELETE sobre vehicles (baja lógica), y RLS sigue exigiendo
-- sesión y cuenta activa en todas las tablas y en Storage.
--
-- Además, los avisos por email ya no tienen una lista de destinatarios aparte: los reciben TODOS
-- los usuarios activos (la Edge Function lee sus emails de profiles).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Políticas: donde se exigía admin, ahora basta con ser miembro activo
-- ---------------------------------------------------------------------------

-- vehicles (sin DELETE: baja lógica)
drop policy if exists vehicles_insert on public.vehicles;
drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_insert on public.vehicles for insert to authenticated with check ((select public.is_member()));
create policy vehicles_update on public.vehicles for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));

-- itv_rules
drop policy if exists itv_rules_update on public.itv_rules;
create policy itv_rules_update on public.itv_rules for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));

-- itv_inspections
drop policy if exists itv_inspections_insert on public.itv_inspections;
drop policy if exists itv_inspections_update on public.itv_inspections;
drop policy if exists itv_inspections_delete on public.itv_inspections;
create policy itv_inspections_insert on public.itv_inspections for insert to authenticated with check ((select public.is_member()));
create policy itv_inspections_update on public.itv_inspections for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy itv_inspections_delete on public.itv_inspections for delete to authenticated using ((select public.is_member()));

-- maintenance_rules
drop policy if exists maintenance_rules_insert on public.maintenance_rules;
drop policy if exists maintenance_rules_update on public.maintenance_rules;
drop policy if exists maintenance_rules_delete on public.maintenance_rules;
create policy maintenance_rules_insert on public.maintenance_rules for insert to authenticated with check ((select public.is_member()));
create policy maintenance_rules_update on public.maintenance_rules for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy maintenance_rules_delete on public.maintenance_rules for delete to authenticated using ((select public.is_member()));

-- maintenance_records: registrar sigue anotando quién (created_by = yo); corregir y borrar, cualquiera
drop policy if exists maintenance_records_update on public.maintenance_records;
drop policy if exists maintenance_records_delete on public.maintenance_records;
create policy maintenance_records_update on public.maintenance_records for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy maintenance_records_delete on public.maintenance_records for delete to authenticated using ((select public.is_member()));

-- attachments
drop policy if exists attachments_insert on public.attachments;
drop policy if exists attachments_delete on public.attachments;
create policy attachments_insert on public.attachments for insert to authenticated
  with check (created_by = (select auth.uid()) and (select public.is_member()));
create policy attachments_delete on public.attachments for delete to authenticated using ((select public.is_member()));

-- notification_settings / notifications_sent
drop policy if exists notification_settings_update on public.notification_settings;
drop policy if exists notifications_sent_select on public.notifications_sent;
create policy notification_settings_update on public.notification_settings for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy notifications_sent_select on public.notifications_sent for select to authenticated using ((select public.is_member()));

-- Storage
drop policy if exists vehicle_photos_insert on storage.objects;
drop policy if exists vehicle_photos_update on storage.objects;
drop policy if exists vehicle_photos_delete on storage.objects;
drop policy if exists attachments_files_delete on storage.objects;
create policy vehicle_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-photos' and (select public.is_member()));
create policy vehicle_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-photos' and (select public.is_member()))
  with check (bucket_id = 'vehicle-photos' and (select public.is_member()));
create policy vehicle_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-photos' and (select public.is_member()));
create policy attachments_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (select public.is_member()));

-- ---------------------------------------------------------------------------
-- 2) profiles: todo el equipo se ve entre sí, pero cada uno solo conoce SU token de calendario
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using ((select public.is_member()));
create policy profiles_update on public.profiles for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));

-- RLS decide filas, no columnas: los permisos por columna dejan fuera calendar_token (credencial del
-- feed .ics de cada persona) y permiten editar solo el nombre y el estado activo.
-- Consecuencia: al consultar profiles hay que pedir las columnas por nombre (no vale select *).
revoke select, update on public.profiles from authenticated, anon;
grant select (id, email, full_name, active, created_at, updated_at) on public.profiles to authenticated;
grant update (full_name, active) on public.profiles to authenticated;

-- Cada usuario lee su propio token con esta función (y lo regenera con rotate_calendar_token).
create or replace function public.my_calendar_token()
returns text
language sql stable security definer set search_path = ''
as $$
  select p.calendar_token from public.profiles p where p.id = auth.uid() and p.active;
$$;
revoke execute on function public.my_calendar_token() from public, anon;
grant  execute on function public.my_calendar_token() to authenticated;

-- Nadie puede quedarse fuera por error: no se puede desactivar la propia cuenta ni dejar el
-- sistema sin ningún usuario activo. (service_role, con auth.uid() nulo, no se restringe.)
create or replace function public.profiles_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.active and not new.active then
    if old.id = auth.uid() then
      raise exception 'No puedes desactivar tu propia cuenta';
    end if;
    if not exists (select 1 from public.profiles p where p.id <> old.id and p.active) then
      raise exception 'Debe quedar al menos un usuario activo';
    end if;
  end if;
  return new;
end;
$$;

-- Al crearse un usuario en Auth se crea su perfil (ya sin rol).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Fuera el concepto de administrador y la lista de destinatarios
-- ---------------------------------------------------------------------------

drop function if exists public.is_admin();
alter table public.profiles drop column role;
alter table public.notification_settings drop column recipients;
