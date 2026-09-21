// Botón "Añadir al calendario": genera un .ics de un solo vencimiento y lo descarga.
// (Para que los vencimientos aparezcan y se actualicen solos, está el feed de suscripción en Cuenta.)

import { todayISO } from '@shared/dates.js';
import { buildCalendar, itemsToEventLines } from '@shared/ics.js';

const slug = (text) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

/** @param {object} item vencimiento (buildFleetStatus().items[n]) @param {object} settings ajustes normalizados */
export function downloadItemIcs(item, settings) {
  const eventLines = itemsToEventLines([item], {
    today: todayISO(),
    leadDays: settings.lead_days,
    notifyOnDueDay: settings.notify_on_due_day,
    maxPastDays: 36500,
  });
  const text = buildCalendar({ name: 'Flota Prakisama', eventLines });
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slug(item.plate)}-${slug(item.title)}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
