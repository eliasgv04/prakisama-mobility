// Cálculo de la próxima ITV. Funciones puras: no leen la BD ni el reloj.
//
// Las reglas de periodicidad NO están aquí: vienen de la tabla `itv_rules` (una fila por tipo).
// Modelo de una regla (columnas de itv_rules):
//   first_itv_years      años desde la matriculación hasta la primera ITV
//   interval_years       periodicidad (años) hasta llegar a `switch_age_years`
//   switch_age_years     antigüedad (años) a partir de la cual pasa a `late_interval_years` (null = nunca)
//   late_interval_years  periodicidad a partir de esa antigüedad (normalmente 1 = anual)
//   applies              false = a este tipo no se le calcula ITV
//
// Ejemplo turismo (4, 2, 10, 1): ITV a los 4, 6, 8, 10, 11, 12, 13... años de antigüedad.

import { addDays, addMonths, addYears } from './dates.js';

/** ¿Se puede calcular con esta regla? (camiones y maquinaria empiezan sin valores). */
export function isRuleUsable(rule) {
  return Boolean(
    rule &&
      rule.applies !== false &&
      Number.isFinite(rule.first_itv_years) &&
      rule.first_itv_years >= 0 &&
      Number.isFinite(rule.interval_years) &&
      rule.interval_years > 0 &&
      (rule.late_interval_years == null || rule.late_interval_years > 0),
  );
}

/** Antigüedad (en años) de la ITV siguiente a la de antigüedad `age`. */
export function nextItvAge(age, rule) {
  const switchAge = rule.switch_age_years;
  const late = rule.late_interval_years ?? 1;
  return switchAge != null && age >= switchAge ? age + late : age + rule.interval_years;
}

/** Primeras `count` antigüedades en las que toca ITV según la regla. */
export function itvAgeSequence(rule, count) {
  const ages = [];
  let age = rule.first_itv_years;
  for (let i = 0; i < count; i++) {
    ages.push(age);
    age = nextItvAge(age, rule);
  }
  return ages;
}

/**
 * Primera fecha de ITV, calculada desde la matriculación, que sea igual o posterior a `fromIso`.
 * Devuelve null si la regla no es utilizable o no hay fecha de matriculación.
 *
 * Cada fecha se calcula desde la matriculación (no encadenada), de modo que el recorte de fin de
 * mes/29-feb no se arrastra: matriculado el 29-feb-2020, ITV a los 6 años → 28-feb-2026 y a los
 * 8 años → 29-feb-2028.
 */
export function nextItvFromRegistration(registrationIso, rule, fromIso) {
  if (!registrationIso || !isRuleUsable(rule)) return null;
  let age = rule.first_itv_years;
  for (let i = 0; i < 200; i++) {
    const date = addYears(registrationIso, age);
    if (date >= fromIso) return date;
    age = nextItvAge(age, rule);
  }
  return null;
}

/** Orden: inspección más reciente primero. */
function byInspectionDateDesc(a, b) {
  if (a.inspection_date !== b.inspection_date) return a.inspection_date < b.inspection_date ? 1 : -1;
  return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
}

/**
 * Decide cuál es la fecha de la próxima ITV de un vehículo y de dónde sale. Prioridad:
 *   1. `manual`      → campo "próxima ITV manual" del vehículo (lo decide una persona).
 *   2. `inspection`  → caducidad de la tarjeta de la última inspección favorable; o, si la última
 *                      inspección NO fue favorable, el plazo para repetirla (`retest: true`).
 *   3. `calculated`  → matriculación + reglas de `itv_rules`.
 *
 * @param {object} p
 * @param {object} p.vehicle       fila de vehicles
 * @param {object|null} p.rule     fila de itv_rules para el tipo del vehículo
 * @param {object[]} p.inspections inspecciones DE ESTE vehículo (cualquier orden)
 * @param {string} p.today         YYYY-MM-DD
 * @returns {{applies:boolean, dueDate:string|null, source:'manual'|'inspection'|'calculated'|'none',
 *            estimated:boolean, retest:boolean, lastResult:string|null,
 *            reason:'disabled'|'no_rule'|'no_registration'|null}}
 */
export function resolveItv({ vehicle, rule, inspections = [], today }) {
  const base = { applies: true, dueDate: null, source: 'none', estimated: false, retest: false, lastResult: null, reason: null };

  if (vehicle.itv_enabled === false || (rule && rule.applies === false)) {
    return { ...base, applies: false, reason: 'disabled' };
  }

  const sorted = [...inspections].sort(byInspectionDateDesc);
  const latest = sorted[0] ?? null;
  const lastResult = latest?.result ?? null;

  // 1. Fecha manual: manda sobre todo lo demás.
  if (vehicle.itv_manual_date) {
    return { ...base, dueDate: vehicle.itv_manual_date, source: 'manual', lastResult };
  }

  if (latest) {
    // 2a. Última inspección no favorable: hay que repetirla. El plazo es la fecha que figure en la
    //     tarjeta o, si no consta, 2 meses (desfavorable) o inmediato (negativa).
    if (latest.result !== 'favorable') {
      const deadline =
        latest.valid_until ?? (latest.result === 'desfavorable' ? addMonths(latest.inspection_date, 2) : latest.inspection_date);
      return { ...base, dueDate: deadline, source: 'inspection', retest: true, lastResult };
    }
    // 2b. Favorable: la próxima fecha es la caducidad que figura en la tarjeta.
    if (latest.valid_until) {
      return { ...base, dueDate: latest.valid_until, source: 'inspection', lastResult };
    }
    // Favorable pero sin caducidad anotada: se calcula a partir de la fecha de esa inspección.
    const fromReg = nextItvFromRegistration(vehicle.first_registration_date, rule, addDays(latest.inspection_date, 1));
    return fromReg
      ? { ...base, dueDate: fromReg, source: 'calculated', lastResult }
      : { ...base, lastResult, reason: vehicle.first_registration_date ? 'no_rule' : 'no_registration' };
  }

  // 3. Sin inspecciones registradas: se calcula desde la matriculación. Se asume que las ITV
  //    anteriores se pasaron a tiempo, por eso se marca `estimated` para avisar en la interfaz.
  if (!vehicle.first_registration_date) return { ...base, reason: 'no_registration' };
  if (!isRuleUsable(rule)) return { ...base, reason: 'no_rule' };
  const date = nextItvFromRegistration(vehicle.first_registration_date, rule, today);
  return date
    ? { ...base, dueDate: date, source: 'calculated', estimated: true }
    : { ...base, reason: 'no_rule' };
}
