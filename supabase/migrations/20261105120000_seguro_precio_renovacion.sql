-- =============================================================================
-- Prakisama Mobility · Migración 9: precio del seguro y renovaciones
--
-- Petición de la empresa: cuando vence el seguro piden precio y, si otra compañía lo deja más
-- barato, cambian. Por eso:
--   · vehicles.insurance_cost: precio anual de la póliza actual (opcional).
--   · insurance_history: pólizas anteriores (aseguradora, tipo, precio, vencimiento), para poder
--     comparar lo que se pagaba antes con las ofertas nuevas.
--   · renew_insurance(): "Renovar seguro" en un solo paso. Guarda la póliza actual en el historial
--     y pone la nueva en el vehículo. Va en una función para que las dos escrituras sean atómicas
--     (si falla una, no queda ni la otra).
--
-- RLS: igual que el resto de tablas (migración 7): cualquier usuario activo puede ver, añadir y
-- borrar entradas del historial (borrar sirve para corregir errores). Sin UPDATE: se borra y listo.
-- =============================================================================

alter table public.vehicles
  add column insurance_cost numeric(10, 2) check (insurance_cost is null or insurance_cost >= 0);

create table public.insurance_history (
  id             uuid primary key default gen_random_uuid(),
  vehicle_id     uuid not null references public.vehicles (id) on delete cascade,
  insurer        text,
  insurance_type text,
  cost           numeric(10, 2) check (cost is null or cost >= 0),
  expiry_date    date,              -- vencimiento que tenía esa póliza
  created_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index insurance_history_vehicle_idx on public.insurance_history (vehicle_id, expiry_date desc);

alter table public.insurance_history enable row level security;

create policy insurance_history_select on public.insurance_history for select to authenticated
  using ((select public.is_member()));
create policy insurance_history_insert on public.insurance_history for insert to authenticated
  with check ((select public.is_member()));
create policy insurance_history_delete on public.insurance_history for delete to authenticated
  using ((select public.is_member()));

-- ---------------------------------------------------------------------------
-- renew_insurance: archiva la póliza actual (si había algo) y guarda la nueva.
-- security invoker: se ejecuta con los permisos de quien la llama, así que la RLS de vehicles e
-- insurance_history decide igual que si fueran dos llamadas sueltas.
-- ---------------------------------------------------------------------------
create or replace function public.renew_insurance(
  p_vehicle_id uuid,
  p_expiry     date,
  p_insurer    text,
  p_type       text,
  p_cost       numeric
)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v public.vehicles%rowtype;
begin
  if p_expiry is null then
    raise exception 'Falta la fecha de vencimiento';
  end if;

  select * into v from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'Vehículo no encontrado';
  end if;

  -- Solo se archiva si había una póliza (con algún dato) en el vehículo.
  if v.insurance_expiry is not null or v.insurer is not null or v.insurance_cost is not null then
    insert into public.insurance_history (vehicle_id, insurer, insurance_type, cost, expiry_date)
    values (v.id, v.insurer, v.insurance_type, v.insurance_cost, v.insurance_expiry);
  end if;

  update public.vehicles
     set insurance_expiry = p_expiry,
         insurer          = nullif(btrim(p_insurer), ''),
         insurance_type   = nullif(btrim(p_type), ''),
         insurance_cost   = p_cost
   where id = p_vehicle_id;
end;
$$;

revoke execute on function public.renew_insurance(uuid, date, text, text, numeric) from public, anon;
grant  execute on function public.renew_insurance(uuid, date, text, text, numeric) to authenticated;
