// Cálculo de la próxima ITV. Funciones puras: no leen la BD ni el reloj.
//
// Las reglas de periodicidad NO están aquí: vienen de la tabla `itv_rules` (una fila por tipo) y se
// pueden editar en la app. Origen de los valores por defecto: art. 6.1 del RD 920/2017.
//
// Modelo de una regla (columnas de itv_rules):
//   first_itv_years  antigüedad (años desde la matriculación) a la que toca la primera ITV
//   steps            tramos [{ from_years, every_months }]: "a partir de los `from_years` años, cada
//                    `every_months` meses". En cada ITV manda el último tramo ya cumplido.
//   applies          false = a este tipo no se le calcula ITV
//
// Ejemplo furgoneta N1: first_itv_years 2, steps [{2,24},{6,12},{10,6}] →
//   ITV a los 2, 4, 6, 7, 8, 9, 10 años y, desde entonces, cada 6 meses: 10,5 · 11 · 11,5…
//
// Matiz de la norma: la frecuencia depende de la antigüedad EN LA FECHA DE LA INSPECCIÓN y el plazo
// real lo fija la tarjeta ITV (por eso, en cuanto hay una inspección registrada, manda su caducidad).
// Esta secuencia es la estimación desde la matriculación, y en el límite de un tramo (p. ej. justo a
// los 10 años) aplica el tramo nuevo: es la lectura más prudente, avisa antes.

import { addDays, addMonths } from './dates.js';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/** Tramos válidos y ordenados por antigüedad de inicio. */
export function ruleSteps(rule) {
  const steps = Array.isArray(rule?.steps) ? rule.steps : [];
  return steps
    .filter((s) => s && isNum(s.from_years) && s.from_years >= 0 && isNum(s.every_months) && s.every_months > 0)
    .sort((a, b) => a.from_years - b.from_years);
}

/** ¿Se puede calcular con esta regla? (los tipos sin configurar no). */
export function isRuleUsable(rule) {
  return Boolean(rule && rule.applies !== false && isNum(rule.first_itv_years) && rule.first_itv_years >= 0 && ruleSteps(rule).length > 0);
}

/** Tramo aplicable a una antigüedad (en meses): el último cuyo inicio ya se ha cumplido. */
export function stepFor(ageMonths, steps) {
  let chosen = steps[0];
  for (const step of steps) if (step.from_years * 12 <= ageMonths) chosen = step;
  return chosen;
}

/** Antigüedades (en meses desde la matriculación) de las primeras `count` ITV. */
export function itvMonthSequence(rule, count) {
  const steps = ruleSteps(rule);
  const months = [];
  let m = Math.round(rule.first_itv_years * 12);
  for (let i = 0; i < count; i++) {
    months.push(m);
    m += stepFor(m, steps).every_months;
  }
  return months;
}

/** Igual, en años (puede haber medios años: 10,5). Para mostrar ejemplos. */
export const itvAgeSequence = (rule, count) => itvMonthSequence(rule, count).map((m) => m / 12);

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
  const steps = ruleSteps(rule);
  let m = Math.round(rule.first_itv_years * 12);
  for (let i = 0; i < 400; i++) {
    const date = addMonths(registrationIso, m);
    if (date >= fromIso) return date;
    m += stepFor(m, steps).every_months;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Texto legible de una regla
// ---------------------------------------------------------------------------

const FREQUENCY_NAMES = { 6: 'semestral', 12: 'anual', 24: 'bienal', 36: 'trienal', 48: 'cuatrienal' };
const yearsText = (n) => `${String(n).replace('.', ',')} ${n === 1 ? 'año' : 'años'}`;

/** 12 → "anual", 6 → "semestral", 18 → "cada 18 meses". */
export const frequencyName = (months) => FREQUENCY_NAMES[months] ?? `cada ${months} meses`;

/** "1.ª ITV a los 2 años · bienal de 2 a 6 · anual de 6 a 10 · semestral desde los 10" */
export function describeItvRule(rule) {
  if (!isRuleUsable(rule)) return null;
  const steps = ruleSteps(rule);
  const parts = [`1.ª ITV a los ${yearsText(rule.first_itv_years)}`];
  steps.forEach((step, i) => {
    const next = steps[i + 1];
    parts.push(`${frequencyName(step.every_months)} ${next ? `de ${step.from_years} a ${next.from_years}` : `desde los ${step.from_years}`}`);
  });
  return parts.join(' · ');
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
