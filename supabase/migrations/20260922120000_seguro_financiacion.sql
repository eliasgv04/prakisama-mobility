-- =============================================================================
-- Prakisama Mobility · Migración 8: seguro y financiación por vehículo
--
-- Seguro: se trata como un vencimiento más, igual que la ITV: entra en el semáforo del panel,
-- en el email diario y en el feed .ics, con las mismas antelaciones. Activable/desactivable en
-- Ajustes con notify_insurance (como notify_itv y notify_maintenance). Sin cálculo: la fecha la
-- pone la persona a mano (no hay tabla de reglas como en la ITV).
--
-- Financiación (préstamo o leasing): solo informativa. Se guarda en la ficha del vehículo pero
-- no genera avisos ni cuenta para el semáforo.
-- =============================================================================

alter table public.vehicles
  add column insurance_type     text,   -- tipo de seguro (texto libre: terceros, todo riesgo...)
  add column insurer            text,   -- aseguradora
  add column insurance_expiry   date,   -- vencimiento del seguro: entra en avisos si está puesta
  add column financing_type     text check (financing_type is null or financing_type in ('prestamo', 'leasing')),
  add column financing_lender   text,   -- entidad financiera
  add column financing_end_date date;   -- fecha de fin del préstamo/leasing (solo informativa, sin avisos)

alter table public.notification_settings
  add column notify_insurance boolean not null default true;
