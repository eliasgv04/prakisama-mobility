// Formato de fechas, números y dinero en español.

import { formatES } from '@shared/dates.js';

const numberFormat = new Intl.NumberFormat('es-ES');
const moneyFormat = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

export const fmtDate = (iso) => (iso ? formatES(iso) : '—');
export const fmtNumber = (n) => (n === null || n === undefined ? '—' : numberFormat.format(n));
export const fmtUsage = (n, unit) => (n === null || n === undefined ? '—' : `${numberFormat.format(n)} ${unit === 'h' ? 'h' : 'km'}`);
export const fmtMoney = (n) => (n === null || n === undefined ? '—' : moneyFormat.format(n));
export const fmtDateTime = (timestamp) =>
  new Date(timestamp).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

export const usageWord = (unit) => (unit === 'h' ? 'Horas de uso' : 'Kilómetros');

/** Cuántos días hace de algo: "hoy", "ayer", "hace 12 días". */
export function daysAgo(days) {
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}
