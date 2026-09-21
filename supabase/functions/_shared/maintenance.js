// Cálculo de vencimientos de mantenimiento periódico. Funciones puras.
//
// Una regla (maintenance_rules) dice "cada X km/horas o cada Y meses, lo que ocurra antes".
// El siguiente vencimiento se calcula desde la última vez que se hizo:
//   - el último registro de ese tipo (vista v_last_maintenance), o
//   - la referencia inicial de la regla (base_date / base_usage) si no hay registros
//     o si esa referencia es más reciente.
// Como se deriva de los registros, al guardar un cambio de aceite el siguiente se recalcula solo.

import { STATUS } from './constants.js';
import { addMonths, diffDays } from './dates.js';
import { statusFromDays, statusFromUsage } from './status.js';

/** Última vez que se hizo: elige entre el último registro y la referencia inicial de la regla. */
export function pickReference(rule, lastRecord) {
  const fromRecord = lastRecord ? { date: lastRecord.record_date, usage: lastRecord.usage ?? null, source: 'record' } : null;
  const fromBase =
    rule.base_date || rule.base_usage != null ? { date: rule.base_date ?? null, usage: rule.base_usage ?? null, source: 'base' } : null;
  if (fromRecord && fromBase) {
    // Gana el más reciente; si la referencia inicial no tiene fecha, manda el registro.
    return fromBase.date && fromBase.date > fromRecord.date ? fromBase : fromRecord;
  }
  return fromRecord ?? fromBase;
}

/**
 * Evalúa una regla de mantenimiento.
 *
 * @param {object} p
 * @param {object} p.rule            fila de maintenance_rules
 * @param {object|null} p.lastRecord fila de v_last_maintenance para (vehículo, tipo)
 * @param {number|null} p.currentUsage km/horas actuales del vehículo
 * @param {string|null} p.usageUpdatedOn día (YYYY-MM-DD) de la última actualización de km/horas
 * @param {string} p.today
 * @param {number} p.maxLeadDays     mayor antelación configurada (30 por defecto): umbral de "próximo" por fecha
 * @param {number} p.staleDays       días sin actualizar km a partir de los cuales se consideran desfasados
 */
export function evaluateRule({ rule, lastRecord = null, currentUsage = null, usageUpdatedOn = null, today, maxLeadDays, staleDays }) {
  const ref = pickReference(rule, lastRecord);

  const dueDate = ref?.date && rule.every_months ? addMonths(ref.date, rule.every_months) : null;
  const dueUsage = ref?.usage != null && rule.every_usage ? ref.usage + rule.every_usage : null;

  const daysRemaining = dueDate ? diffDays(today, dueDate) : null;
  const usageRemaining = dueUsage != null && currentUsage != null ? dueUsage - currentUsage : null;

  const dateStatus = daysRemaining != null ? statusFromDays(daysRemaining, maxLeadDays) : null;
  const usageStatus = usageRemaining != null ? statusFromUsage(usageRemaining, rule.warn_before_usage ?? 0) : null;

  // "Lo que ocurra antes": manda el estado más urgente; si empatan, la fecha.
  const rank = { [STATUS.OVERDUE]: 0, [STATUS.SOON]: 1, [STATUS.OK]: 2 };
  let trigger = null;
  let status = STATUS.OK;
  if (dateStatus && usageStatus) {
    trigger = rank[usageStatus] < rank[dateStatus] ? 'usage' : 'date';
    status = trigger === 'usage' ? usageStatus : dateStatus;
  } else if (dateStatus) {
    trigger = 'date';
    status = dateStatus;
  } else if (usageStatus) {
    trigger = 'usage';
    status = usageStatus;
  }

  // Los avisos por km/horas solo valen si alguien mantiene el contador al día.
  const usageStaleDays = usageUpdatedOn ? diffDays(usageUpdatedOn, today) : null;
  const usageIsStale = Boolean(rule.every_usage) && (usageStaleDays == null || usageStaleDays > staleDays);

  return {
    status,
    trigger,
    dueDate,
    dueUsage,
    daysRemaining,
    usageRemaining,
    reference: ref,
    /** Sin ninguna referencia no se puede calcular nada: falta indicar cuándo se hizo por última vez. */
    missingReference: ref === null,
    usageIsStale,
    usageStaleDays,
  };
}
