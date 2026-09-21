-- =============================================================================
-- Flota Prakisama · Migración 1: esquema base
-- Tablas, índices, triggers y la vista v_last_maintenance. Las políticas RLS van en la migración 2.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: una fila por usuario de Auth (rol + token del feed de calendario)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null,
  full_name      text,
  role           text not null default 'encargado' check (role in ('admin', 'encargado')),
  active         boolean not null default true,
  -- Token secreto del feed .ics (64 hex = ~244 bits aleatorios). Revocable: se regenera con
  -- rotate_calendar_token(). Se guarda en claro porque hay que compararlo con el de la URL.
  calendar_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Funciones de rol. SECURITY DEFINER para poder leer profiles desde las políticas RLS sin
-- recursión; search_path vacío por seguridad (todo va cualificado).
create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin');
$$;

-- Al crearse un usuario en Auth se crea su perfil. El PRIMER usuario del sistema es admin;
-- los siguientes entran como 'encargado' y un admin puede cambiarles el rol desde Ajustes.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'full_name',
    case when exists (select 1 from public.profiles) then 'encargado' else 'admin' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Protege columnas sensibles de profiles (RLS no puede restringir por columna):
--  · un no-admin solo puede cambiar su nombre; rol, estado, email y token quedan como estaban;
--  · nadie puede dejar el sistema sin un administrador activo.
-- Las llamadas con service_role (auth.uid() nulo) no se restringen.
create or replace function public.profiles_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.id := old.id;
    new.email := old.email;
    new.role := old.role;
    new.active := old.active;
    new.calendar_token := old.calendar_token;
  end if;

  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if not exists (select 1 from public.profiles p where p.id <> old.id and p.role = 'admin' and p.active) then
      raise exception 'Debe quedar al menos un administrador activo';
    end if;
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Cada usuario puede regenerar su propio token de calendario (revoca el enlace anterior).
create or replace function public.rotate_calendar_token()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  new_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  update public.profiles set calendar_token = new_token where id = auth.uid();
  if not found then
    raise exception 'Usuario sin perfil';
  end if;
  return new_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------------

create table public.vehicles (
  id                      uuid primary key default gen_random_uuid(),
  -- Matrícula normalizada (mayúsculas, sin espacios ni guiones). El formato se valida en el
  -- cliente solo para avisar; aquí solo se exige que esté normalizada.
  plate                   text not null unique check (plate ~ '^[A-Z0-9]{2,12}$'),
  vehicle_type            text not null check (vehicle_type in ('turismo', 'furgoneta', 'camion', 'maquinaria', 'otro')),
  brand                   text,
  model                   text,
  alias                   text,
  first_registration_date date,
  gvw_kg                  integer check (gvw_kg is null or gvw_kg > 0),   -- MMA
  usage_unit              text not null default 'km' check (usage_unit in ('km', 'h')),
  current_usage           integer check (current_usage is null or current_usage >= 0),
  usage_updated_at        timestamptz,      -- cuándo se actualizó por última vez el contador
  photo_path              text,             -- ruta en el bucket privado vehicle-photos
  notes                   text,
  itv_enabled             boolean not null default true,  -- false = no se controla ITV en este vehículo
  itv_manual_date         date,             -- "próxima ITV manual": si está, manda sobre el cálculo
  active                  boolean not null default true,  -- baja lógica: nunca se borran vehículos
  created_by              uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index vehicles_active_idx on public.vehicles (active);
create trigger vehicles_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();

-- Sella la fecha de la última actualización de km/horas cada vez que cambia el contador.
create or replace function public.vehicles_stamp_usage()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.current_usage is not null and new.usage_updated_at is null then
      new.usage_updated_at := now();
    end if;
  elsif new.current_usage is distinct from old.current_usage and new.usage_updated_at is not distinct from old.usage_updated_at then
    new.usage_updated_at := now();
  end if;
  return new;
end;
$$;
create trigger vehicles_stamp_usage before insert or update on public.vehicles
  for each row execute function public.vehicles_stamp_usage();

-- "Actualizar kilómetros": lo puede hacer cualquier miembro aunque no pueda editar el vehículo.
-- Es una función (y no un UPDATE directo) porque RLS no distingue columnas: así el encargado
-- puede cambiar SOLO el contador. Permite bajar el valor (corregir un error de tecleo);
-- la interfaz avisa antes. Confirmar el mismo valor también refresca la fecha.
create or replace function public.set_vehicle_usage(p_vehicle_id uuid, p_usage integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'No autorizado';
  end if;
  if p_usage is null or p_usage < 0 then
    raise exception 'Valor no válido';
  end if;
  update public.vehicles
     set current_usage = p_usage, usage_updated_at = now()
   where id = p_vehicle_id;
  if not found then
    raise exception 'Vehículo no encontrado';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- itv_rules: periodicidad de la ITV por tipo de vehículo (editable desde Ajustes)
-- ---------------------------------------------------------------------------

create table public.itv_rules (
  vehicle_type        text primary key check (vehicle_type in ('turismo', 'furgoneta', 'camion', 'maquinaria', 'otro')),
  applies             boolean not null default true,   -- false = a este tipo no se le calcula ITV
  first_itv_years     integer check (first_itv_years is null or first_itv_years >= 0),
  interval_years      integer check (interval_years is null or interval_years > 0),
  switch_age_years    integer check (switch_age_years is null or switch_age_years >= 0),
  late_interval_years integer not null default 1 check (late_interval_years > 0),
  verified            boolean not null default false,  -- true cuando alguien las ha contrastado con la norma
  notes               text,
  updated_at          timestamptz not null default now()
);
create trigger itv_rules_updated_at before update on public.itv_rules
  for each row execute function public.set_updated_at();

-- Valores orientativos: SIN verificar. A contrastar con el RD 920/2017 antes de fiarse de ellos.
-- Camiones y maquinaria quedan sin valores a propósito: se configuran desde Ajustes.
insert into public.itv_rules (vehicle_type, applies, first_itv_years, interval_years, switch_age_years, late_interval_years, verified, notes) values
  ('turismo',    true, 4,    2,    10,   1, false, 'ORIENTATIVA, a verificar con el RD 920/2017: primera a los 4 años, cada 2 hasta los 10 y anual desde entonces.'),
  ('furgoneta',  true, 2,    2,    6,    1, false, 'ORIENTATIVA, a verificar con el RD 920/2017: primera a los 2 años, cada 2 hasta los 6 y anual desde entonces.'),
  ('camion',     true, null, null, null, 1, false, 'Sin configurar: rellenar según el RD 920/2017 (no se asume ningún valor).'),
  ('maquinaria', true, null, null, null, 1, false, 'Sin configurar: rellenar según corresponda (no se asume ningún valor). Si no requiere ITV, desmarcar "Aplica".'),
  ('otro',       true, null, null, null, 1, false, 'Sin configurar.');

-- ---------------------------------------------------------------------------
-- itv_inspections: historial de ITV pasadas
-- ---------------------------------------------------------------------------

create table public.itv_inspections (
  id              uuid primary key default gen_random_uuid(),
  vehicle_id      uuid not null references public.vehicles (id) on delete cascade,
  inspection_date date not null,
  result          text not null check (result in ('favorable', 'desfavorable', 'negativa')),
  -- Fecha de caducidad que figura en la tarjeta ITV. En una desfavorable puede ser el plazo para repetir.
  valid_until     date,
  station         text,
  cost            numeric(10, 2) check (cost is null or cost >= 0),
  notes           text,
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  check (valid_until is null or valid_until >= inspection_date)
);
create index itv_inspections_vehicle_idx on public.itv_inspections (vehicle_id, inspection_date desc);

-- Al registrar una ITV favorable (la más reciente del vehículo), la próxima fecha pasa a tomarse
-- de ella: se borra la fecha manual que hubiera. Registrar una inspección antigua (histórico)
-- no toca la fecha manual.
create or replace function public.itv_clear_manual_date()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.result = 'favorable'
     and not exists (
       select 1 from public.itv_inspections i
        where i.vehicle_id = new.vehicle_id and i.inspection_date > new.inspection_date
     ) then
    update public.vehicles set itv_manual_date = null where id = new.vehicle_id;
  end if;
  return new;
end;
$$;
create trigger itv_inspections_clear_manual after insert on public.itv_inspections
  for each row execute function public.itv_clear_manual_date();

-- ---------------------------------------------------------------------------
-- maintenance_rules: mantenimiento periódico por vehículo
-- ---------------------------------------------------------------------------

create table public.maintenance_rules (
  id                uuid primary key default gen_random_uuid(),
  vehicle_id        uuid not null references public.vehicles (id) on delete cascade,
  kind              text not null check (kind in ('aceite', 'revision', 'neumaticos', 'otro')),
  name              text,                                             -- etiqueta opcional
  -- "Cada X km/horas o cada Y meses, lo que ocurra antes": basta con uno de los dos.
  every_usage       integer check (every_usage is null or every_usage > 0),
  every_months      integer check (every_months is null or every_months > 0),
  warn_before_usage integer not null default 500 check (warn_before_usage >= 0),  -- umbral de "próximo" por km/horas
  -- Referencia inicial ("la última vez fue..."), válida hasta que haya un registro más reciente.
  base_date         date,
  base_usage        integer check (base_usage is null or base_usage >= 0),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (vehicle_id, kind),
  check (every_usage is not null or every_months is not null)
);
create trigger maintenance_rules_updated_at before update on public.maintenance_rules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- maintenance_records: historial de mantenimientos y averías
-- ---------------------------------------------------------------------------

create table public.maintenance_records (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles (id) on delete cascade,
  kind        text not null check (kind in ('aceite', 'averia', 'revision', 'neumaticos', 'otro')),
  record_date date not null,
  usage       integer check (usage is null or usage >= 0),   -- km u horas en el momento del registro
  description text,
  cost        numeric(10, 2) check (cost is null or cost >= 0),
  workshop    text,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index maintenance_records_vehicle_idx on public.maintenance_records (vehicle_id, record_date desc);
create index maintenance_records_kind_idx on public.maintenance_records (vehicle_id, kind, record_date desc);
create trigger maintenance_records_updated_at before update on public.maintenance_records
  for each row execute function public.set_updated_at();

-- Cualquier registro con km/horas actualiza el contador del vehículo, pero solo hacia arriba:
-- una factura antigua no debe "rebobinar" los km actuales. SECURITY DEFINER porque el encargado
-- puede registrar mantenimientos pero no editar vehículos.
create or replace function public.sync_vehicle_usage_from_record()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.usage is not null then
    update public.vehicles
       set current_usage = new.usage
     where id = new.vehicle_id
       and (current_usage is null or new.usage > current_usage);
  end if;
  return new;
end;
$$;
create trigger maintenance_records_sync_usage after insert or update of usage on public.maintenance_records
  for each row execute function public.sync_vehicle_usage_from_record();

-- Último registro por (vehículo, tipo): de aquí salen los próximos vencimientos.
-- security_invoker: la vista respeta la RLS de quien la consulta.
create view public.v_last_maintenance with (security_invoker = true) as
  select distinct on (vehicle_id, kind)
         vehicle_id, kind, record_date, usage
    from public.maintenance_records
   where kind <> 'averia'
   order by vehicle_id, kind, record_date desc, created_at desc;

-- ---------------------------------------------------------------------------
-- attachments: adjuntos (fotos de facturas, tarjeta ITV...). El fichero vive en Storage.
-- ---------------------------------------------------------------------------

create table public.attachments (
  id                    uuid primary key default gen_random_uuid(),
  vehicle_id            uuid not null references public.vehicles (id) on delete cascade,
  maintenance_record_id uuid references public.maintenance_records (id) on delete cascade,
  itv_inspection_id     uuid references public.itv_inspections (id) on delete cascade,
  storage_path          text not null,     -- ruta en el bucket privado "attachments"
  file_name             text,
  mime_type             text,
  size_bytes            integer,
  created_by            uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  -- Cuelga de un registro de mantenimiento o de una inspección, nunca de los dos ni de ninguno.
  check ((maintenance_record_id is not null)::int + (itv_inspection_id is not null)::int = 1)
);
create index attachments_record_idx on public.attachments (maintenance_record_id);
create index attachments_inspection_idx on public.attachments (itv_inspection_id);
create index attachments_vehicle_idx on public.attachments (vehicle_id);

-- ---------------------------------------------------------------------------
-- notification_settings: ajustes de avisos (una única fila, id = 1)
-- ---------------------------------------------------------------------------

create table public.notification_settings (
  id                 smallint primary key default 1 check (id = 1),
  recipients         text[] not null default '{}',              -- emails que reciben el resumen diario
  lead_days          integer[] not null default '{30,15,7}',    -- antelaciones (días antes)
  notify_on_due_day  boolean not null default true,             -- aviso el mismo día del vencimiento
  weekly_overdue     boolean not null default true,             -- recordatorio semanal mientras siga vencido
  notify_itv         boolean not null default true,             -- tipos de aviso activables
  notify_maintenance boolean not null default true,             --   mantenimiento por fecha
  notify_usage       boolean not null default true,             --   mantenimiento por km/horas
  default_warn_usage integer not null default 500 check (default_warn_usage >= 0),  -- umbral por defecto en reglas nuevas
  usage_stale_days   integer not null default 30 check (usage_stale_days > 0),      -- días sin actualizar km = desfasado
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles (id) on delete set null
);
create trigger notification_settings_updated_at before update on public.notification_settings
  for each row execute function public.set_updated_at();
insert into public.notification_settings (id) values (1);

-- ---------------------------------------------------------------------------
-- notifications_sent: qué avisos se han enviado ya (evita duplicados)
-- ---------------------------------------------------------------------------

create table public.notifications_sent (
  id        bigint generated always as identity primary key,
  item_key  text not null,   -- 'itv:<vehicle_id>' o 'maint:<rule_id>'
  due_ref   text not null,   -- fecha de vencimiento ('2026-10-12') o límite de uso ('usage:45000')
  stage     text not null,   -- 'd30', 'd15', 'd7', 'd0', 'overdue', 'usage_soon'
  recipient text not null,
  sent_on   date not null,
  sent_at   timestamptz not null default now(),
  unique (item_key, due_ref, stage, recipient, sent_on)
);
create index notifications_sent_lookup_idx on public.notifications_sent (recipient, item_key, due_ref);

-- ---------------------------------------------------------------------------
-- Usuarios que ya existían antes de esta migración
-- El trigger on_auth_user_created solo actúa con altas nuevas: aquí se crea el perfil de los que
-- ya estuvieran en Auth (p. ej. el usuario creado a mano al montar el proyecto). El más antiguo
-- queda como administrador. Es idempotente.
-- ---------------------------------------------------------------------------
insert into public.profiles (id, email, full_name, role)
select u.id,
       coalesce(u.email, ''),
       u.raw_user_meta_data ->> 'full_name',
       case when row_number() over (order by u.created_at) = 1 then 'admin' else 'encargado' end
  from auth.users u
on conflict (id) do nothing;
