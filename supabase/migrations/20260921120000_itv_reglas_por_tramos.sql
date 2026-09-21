-- =============================================================================
-- Prakisama Mobility · Migración 6: reglas de ITV por tramos, verificadas con el BOE
--
-- Fuente: artículo 6.1 del Real Decreto 920/2017 (BOE-A-2017-12841), texto consolidado vigente
-- (la última actualización, de 18/09/2024, solo afecta al apartado 6.2 de vehículos históricos).
-- Comprobado directamente en el BOE el 21/09/2026.
--
-- Por qué se cambia el modelo: la norma define la frecuencia por TRAMOS DE ANTIGÜEDAD y algunos son
-- semestrales. El modelo anterior (primera ITV + un intervalo en años + un único cambio de tramo)
-- no podía expresar "semestral" ni las furgonetas, que tienen tres cambios:
--     N1 (≤ 3,5 t): exenta hasta 2 años · bienal de 2 a 6 · anual de 6 a 10 · SEMESTRAL a partir de 10.
-- Ahora cada regla es: primera ITV a los X años + una lista de tramos
--     steps = [{ "from_years": 4, "every_months": 24 }, { "from_years": 10, "every_months": 12 }]
-- que se lee "a partir de los 4 años, cada 24 meses; a partir de los 10, cada 12".
-- En cada ITV se aplica el último tramo cuyo from_years ya se ha cumplido.
-- =============================================================================

alter table public.itv_rules
  add column steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array');

-- Conserva lo que hubiera con el modelo antiguo (dos tramos como máximo).
update public.itv_rules
   set steps = jsonb_build_array(jsonb_build_object('from_years', first_itv_years, 'every_months', interval_years * 12))
               || case when switch_age_years is not null
                       then jsonb_build_array(jsonb_build_object('from_years', switch_age_years, 'every_months', late_interval_years * 12))
                       else '[]'::jsonb end
 where first_itv_years is not null and interval_years is not null;

alter table public.itv_rules
  drop column interval_years,
  drop column switch_age_years,
  drop column late_interval_years;

-- Valores del art. 6.1. Solo se tocan las filas que siguen siendo la semilla original (verified = false):
-- si alguien ya las hubiera editado y verificado, no se pisan.

update public.itv_rules set
  first_itv_years = 4,
  steps = '[{"from_years":4,"every_months":24},{"from_years":10,"every_months":12}]',
  verified = true,
  notes = 'Turismos (categoría M1, hasta 8 plazas). Art. 6.1 del RD 920/2017: hasta 4 años exento (la primera ITV es a los 4), de 4 a 10 años bienal y a partir de 10 años anual. No vale para taxis, ambulancias, autoescuelas ni transporte escolar (tienen frecuencias propias). Comprobado en el BOE el 21/09/2026.'
where vehicle_type = 'turismo' and verified = false;

update public.itv_rules set
  first_itv_years = 2,
  steps = '[{"from_years":2,"every_months":24},{"from_years":6,"every_months":12},{"from_years":10,"every_months":6}]',
  verified = true,
  notes = 'Vehículos de mercancías de hasta 3,5 t (categoría N1). Art. 6.1 del RD 920/2017: hasta 2 años exento (la primera ITV es a los 2), de 2 a 6 años bienal, de 6 a 10 años anual y a partir de 10 años SEMESTRAL. Comprobado en el BOE el 21/09/2026.'
where vehicle_type = 'furgoneta' and verified = false;

update public.itv_rules set
  first_itv_years = 1,
  steps = '[{"from_years":1,"every_months":12},{"from_years":10,"every_months":6}]',
  verified = true,
  notes = 'Vehículos de mercancías de más de 3,5 t (categorías N2 y N3); igual para remolques O2 (salvo caravanas), O3 y O4. Art. 6.1 del RD 920/2017: NO hay periodo de exención, es anual hasta los 10 años (la primera ITV es al año de matricular) y semestral a partir de los 10. Comprobado en el BOE el 21/09/2026.'
where vehicle_type = 'camion' and verified = false;

update public.itv_rules set
  first_itv_years = 4,
  steps = '[{"from_years":4,"every_months":24},{"from_years":10,"every_months":12}]',
  verified = true,
  notes = 'Vehículos especiales de obras y servicios y maquinaria automotriz, SOLO si su velocidad por construcción es igual o superior a 25 km/h (los más lentos no pasan ITV: en esos vehículos desmarca "Controlar la ITV"). Art. 6.1 del RD 920/2017: hasta 4 años exento, de 4 a 10 años bienal y a partir de 10 años anual. Los tractores y máquinas agrícolas tienen otros plazos (8 y 16 años). Comprobado en el BOE el 21/09/2026.'
where vehicle_type = 'maquinaria' and verified = false;

update public.itv_rules set
  notes = 'Sin configurar: cada caso tiene su frecuencia (art. 6.1 del RD 920/2017). Por ejemplo: taxis y ambulancias, anual hasta 5 años y semestral después; autoescuelas, exentas 2 años, anual hasta 5 y semestral después; caravanas remolcadas, exentas 6 años y luego bienal; tractores y máquinas agrícolas, exentos 4 u 8 años, bienal hasta 16 y anual después; motocicletas, exentas 4 años y luego bienal.'
where vehicle_type = 'otro' and verified = false;
