// Aritmética de fechas "de calendario" sobre cadenas ISO (YYYY-MM-DD).
//
// Por qué cadenas y no Date: una fecha de ITV es un día de calendario, no un instante.
// Trabajar con Date local introduce errores de zona horaria y de cambio de hora (DST).
// Aquí todo se calcula en UTC y se devuelve como 'YYYY-MM-DD'. Funciones puras, sin efectos.

import { TIMEZONE } from './constants.js';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(year, month /* 1-12 */) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Devuelve {y, m, d} o null si la cadena no es una fecha de calendario válida. */
export function parseISO(iso) {
  const match = typeof iso === 'string' ? ISO_RE.exec(iso) : null;
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export const isValidISO = (iso) => parseISO(iso) !== null;

function mustParse(iso) {
  const parts = parseISO(iso);
  if (!parts) throw new RangeError(`Fecha ISO no válida: ${iso}`);
  return parts;
}

const pad = (n, width = 2) => String(n).padStart(width, '0');
const fromParts = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** Suma (o resta) días naturales. */
export function addDays(iso, n) {
  const { y, m, d } = mustParse(iso);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return fromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Suma meses conservando el día; si el mes destino es más corto, se usa su último día.
 * 31-ene + 1 mes = 28/29-feb. Se calcula siempre desde la fecha original (no se encadena),
 * así el recorte de fin de mes no se acumula.
 */
export function addMonths(iso, n) {
  const { y, m, d } = mustParse(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return fromParts(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Suma años. 29-feb + 1 año = 28-feb; + 4 años = 29-feb. */
export const addYears = (iso, n) => addMonths(iso, n * 12);

/** Días naturales de `fromIso` a `toIso` (positivo si `toIso` es posterior). */
export function diffDays(fromIso, toIso) {
  const a = mustParse(fromIso);
  const b = mustParse(toIso);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export const compareISO = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria indicada. `now` se puede inyectar en tests. */
export function todayISO(tz = TIMEZONE, now = new Date()) {
  // El locale en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Día (YYYY-MM-DD) de un instante (timestamptz) en la zona horaria indicada. */
export const isoDateOf = (timestamp, tz = TIMEZONE) => todayISO(tz, new Date(timestamp));

/** 2026-09-21 → 21/09/2026 */
export function formatES(iso) {
  const p = parseISO(iso);
  return p ? `${pad(p.d)}/${pad(p.m)}/${pad(p.y, 4)}` : '';
}
