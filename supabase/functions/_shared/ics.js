// Generador de calendarios iCalendar (.ics, RFC 5545). Puro: devuelve texto.
// Lo usan el feed de suscripción (Edge Function) y el botón "Añadir al calendario" de la app.
//
// Los vencimientos son eventos de DÍA COMPLETO. Los VALARM se expresan relativos al inicio del
// evento (00:00 del día del vencimiento), pero desplazados para que suenen a las 9:00 del día
// que toca en lugar de a medianoche.

import { describeDue } from './fleet.js';
import { addDays, compareISO } from './dates.js';

const CRLF = '\r\n';
const encoder = new TextEncoder();

/** Escapa texto según RFC 5545 (barra, punto y coma, coma y saltos de línea). */
export function escapeText(text) {
  return String(text ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Pliega líneas a 75 octetos máximo (sin partir caracteres multibyte). */
export function foldLine(line) {
  if (encoder.encode(line).length <= 75) return line;
  const chunks = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      chunks.push(current);
      current = '';
      bytes = 0;
      limit = 74; // la línea de continuación empieza con un espacio
    }
    current += ch;
    bytes += size;
  }
  chunks.push(current);
  return chunks.join(`${CRLF} `);
}

const dateValue = (iso) => iso.replaceAll('-', '');
export const dtstampValue = (now) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * TRIGGER de un aviso `daysBefore` días antes del vencimiento, sonando a las `hour`:00.
 *  daysBefore = 30, hour = 9 → -P29DT15H  (00:00 del día D − 29 d 15 h = 09:00 del día D−30)
 *  daysBefore = 0            → PT9H       (09:00 del propio día)
 */
export function alarmTrigger(daysBefore, hour = 9) {
  if (daysBefore <= 0) return `PT${hour}H`;
  return `-P${daysBefore - 1}DT${24 - hour}H`;
}

/**
 * @param {object} e
 * @param {string} e.uid
 * @param {string} e.date              YYYY-MM-DD (día completo)
 * @param {string} e.summary
 * @param {string} [e.description]
 * @param {string} [e.url]
 * @param {number[]} [e.alarmsDaysBefore]
 * @param {string} [e.alarmText]
 * @param {Date} e.now
 */
export function buildEvent({ uid, date, summary, description, url, alarmsDaysBefore = [], alarmText, now }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstampValue(now)}`,
    `DTSTART;VALUE=DATE:${dateValue(date)}`,
    `DTEND;VALUE=DATE:${dateValue(addDays(date, 1))}`,
    `SUMMARY:${escapeText(summary)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (url) lines.push(`URL:${url}`);
  lines.push('TRANSP:TRANSPARENT');
  for (const days of alarmsDaysBefore) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(alarmText ?? summary)}`,
      `TRIGGER;RELATED=START:${alarmTrigger(days)}`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

/** Envuelve eventos (arrays de líneas) en un VCALENDAR completo. */
export function buildCalendar({ name, eventLines, refreshHours = 6 }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Prakisama//Flota//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:Europe/Madrid',
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshHours}H`,
    `X-PUBLISHED-TTL:PT${refreshHours}H`,
    ...eventLines.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * Vencimientos (buildFleetStatus().items) → líneas de eventos. Solo los que tienen fecha.
 * Los vencidos hace más de `maxPastDays` se omiten para no ensuciar el calendario.
 */
export function itemsToEventLines(items, { today, leadDays = [30, 15, 7], notifyOnDueDay = true, appUrl, now = new Date(), maxPastDays = 90 }) {
  const alarms = [...new Set([...leadDays, ...(notifyOnDueDay ? [0] : [])])].sort((a, b) => b - a);
  return items
    .filter((item) => item.dueDate && compareISO(item.dueDate, addDays(today, -maxPastDays)) >= 0)
    .map((item) => {
      const summary = `${item.title} · ${item.plate}`;
      const description = [item.vehicleName ? `${item.plate} · ${item.vehicleName}` : item.plate, item.title, describeDue(item)]
        .filter(Boolean)
        .join('\n');
      return buildEvent({
        uid: `${item.id}@flota.prakisama`,
        date: item.dueDate,
        summary,
        description,
        url: appUrl,
        alarmsDaysBefore: alarms,
        alarmText: summary,
        now,
      });
    });
}
