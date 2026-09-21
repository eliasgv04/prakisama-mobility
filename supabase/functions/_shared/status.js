import { STATUS, STATUS_RANK } from './constants.js';

/**
 * Estado de un vencimiento por fecha.
 * - Vencido: la fecha ya pasó (días restantes < 0).
 * - Próximo: faltan `maxLeadDays` días o menos (incluido el propio día del vencimiento).
 * - OK: en cualquier otro caso.
 */
export function statusFromDays(daysRemaining, maxLeadDays) {
  if (daysRemaining < 0) return STATUS.OVERDUE;
  if (daysRemaining <= maxLeadDays) return STATUS.SOON;
  return STATUS.OK;
}

/**
 * Estado de un vencimiento por km/horas.
 * Misma convención que por fecha: vencido si se ha rebasado el límite (restante < 0);
 * próximo si faltan `warnBefore` o menos (incluido llegar justo al límite).
 */
export function statusFromUsage(usageRemaining, warnBefore) {
  if (usageRemaining < 0) return STATUS.OVERDUE;
  if (usageRemaining <= warnBefore) return STATUS.SOON;
  return STATUS.OK;
}

/** El peor de varios estados (vencido > próximo > ok). */
export function worstStatus(statuses) {
  let worst = STATUS.OK;
  for (const s of statuses) if (STATUS_RANK[s] < STATUS_RANK[worst]) worst = s;
  return worst;
}

/**
 * Comparador de urgencia para ordenar vencimientos:
 *  1. por estado (vencido, próximo, ok);
 *  2. los que tienen fecha, por días restantes (los más vencidos primero);
 *  3. los que solo tienen km/horas, después, por lo que les falta.
 */
export function compareUrgency(a, b) {
  if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  const aDate = a.trigger === 'date';
  const bDate = b.trigger === 'date';
  if (aDate !== bDate) return aDate ? -1 : 1;
  if (aDate) return a.daysRemaining - b.daysRemaining;
  return a.usageRemaining - b.usageRemaining;
}
