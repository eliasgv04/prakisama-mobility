-- =============================================================================
-- Flota Prakisama · Migración 3: Storage (buckets privados + políticas)
--
-- Dos buckets PRIVADOS (nadie accede por URL pública; la app pide URLs firmadas temporales):
--   vehicle-photos  fotos de los vehículos (la app las redimensiona a ~1200 px antes de subir)
--   attachments     fotos de facturas, tarjeta ITV, PDF...
-- Convención de rutas: <vehicle_id>/<archivo>.
-- RLS de storage.objects ya viene activado por Supabase; aquí solo se definen las políticas.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('vehicle-photos', 'vehicle-photos', false,  5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('attachments',    'attachments',    false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- vehicle-photos: ver cualquier miembro; subir/reemplazar/borrar solo admin (editan vehículos).
create policy vehicle_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'vehicle-photos' and (select public.is_member()));

create policy vehicle_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-photos' and (select public.is_admin()));

create policy vehicle_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-photos' and (select public.is_admin()))
  with check (bucket_id = 'vehicle-photos' and (select public.is_admin()));

create policy vehicle_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-photos' and (select public.is_admin()));

-- attachments: ver y subir cualquier miembro (adjuntan facturas a los mantenimientos que registran;
-- la tabla attachments ya restringe los adjuntos de ITV a admin); borrar el admin o quien lo subió.
create policy attachments_files_select on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (select public.is_member()));

create policy attachments_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (select public.is_member()));

create policy attachments_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and ((select public.is_admin()) or (owner_id = (select auth.uid())::text and (select public.is_member())))
  );
