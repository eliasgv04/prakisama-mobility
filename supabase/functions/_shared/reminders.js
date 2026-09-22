// Decide qué avisos hay que enviar hoy. Función pura: recibe los vencimientos, los ajustes y lo que
// ya se envió (tabla notifications_sent) y devuelve la lista de avisos pendientes.
//
// Diseño anti-duplicados y tolerante a fallos:
//   - Antelaciones (30/15/7 días y el mismo día): se avisa cuando el vencimiento "entra" en un tramo
//     (días restantes <= tramo) y ese tramo no se ha avisado ya para ESA fecha de vencimiento.
//     Así, si un día falla el envío o se da de alta un vehículo con 20 días por delante, el aviso
//     se manda igualmente una sola vez (en el tramo más ajustado), sin depender de que el cron
//     acierte justo el día exacto.
//   - Vencidos: un primer aviso y, mientras siga vencido, un recordatorio cada 7 días.
//   - Km/horas: un aviso cuando pasa a "próximo" y luego el de vencido.
// La clave de deduplicación es (item_key, due_ref, stage): si el vencimiento se renueva
// (nueva fecha o nuevos km), `due_ref` cambia y el ciclo de avisos empieza de nuevo.

import { diffDays } from './dates.js';
import { compareUrgency } from './status.js';

/** Identifica "qué" vence: la fecha, o el límite de km/horas. */
export const dueRefOf = (item) => (item.trigger === 'date' ? item.dueDate : `usage:${item.dueUsage}`);

/**
 * @param {object} p
 * @param {object[]} p.items      vencimientos (buildFleetStatus().items)
 * @param {object} p.settings     ajustes normalizados
 * @param {{item_key:string, due_ref:string, stage:string, sent_on:string}[]} p.sentRows
 *        lo ya enviado A ESTE DESTINATARIO
 * @param {string} p.today        YYYY-MM-DD
 * @returns {{item:object, stage:string, dueRef:string}[]} ordenados por urgencia
 */
export function decideReminders({ items, settings, sentRows, today }) {
  const stages = [
    ...new Set([...settings.lead_days.map(Number).filter((n) => Number.isFinite(n) && n > 0), ...(settings.notify_on_due_day ? [0] : [])]),
  ].sort((a, b) => a - b);

  const sentByKey = new Map();
  for (const row of sentRows) {
    const key = `${row.item_key}|${row.due_ref}`;
    if (!sentByKey.has(key)) sentByKey.set(key, []);
    sentByKey.get(key).push(row);
  }

  const due = [];
  for (const item of items) {
    if (item.type === 'itv' && !settings.notify_itv) continue;
    if (item.type === 'insurance' && !settings.notify_insurance) continue;
    if (item.type === 'maintenance' && !(item.trigger === 'date' ? settings.notify_maintenance : settings.notify_usage)) continue;

    const dueRef = dueRefOf(item);
    const rows = sentByKey.get(`${item.id}|${dueRef}`) ?? [];

    if (item.status === 'overdue') {
      const lastSent = rows.reduce((max, r) => (r.sent_on > max ? r.sent_on : max), '');
      const firstNotice = lastSent === '';
      const weeklyDue = settings.weekly_overdue && lastSent !== '' && diffDays(lastSent, today) >= 7;
      if (firstNotice || weeklyDue) due.push({ item, stage: 'overdue', dueRef });
      continue;
    }

    if (item.trigger === 'date') {
      const tramo = stages.find((s) => item.daysRemaining <= s);
      if (tramo !== undefined && !rows.some((r) => r.stage === `d${tramo}`)) {
        due.push({ item, stage: `d${tramo}`, dueRef });
      }
    } else if (item.status === 'soon' && !rows.some((r) => r.stage === 'usage_soon')) {
      due.push({ item, stage: 'usage_soon', dueRef });
    }
  }

  return due.sort((a, b) => compareUrgency(a.item, b.item));
}
