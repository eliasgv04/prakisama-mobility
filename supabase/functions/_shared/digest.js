// Composición del email resumen diario (HTML + texto plano). Puro: no envía nada.

import { STATUS_LABELS } from './constants.js';
import { formatES } from './dates.js';
import { describeDue } from './fleet.js';
import { displayPlate } from './plate.js';

const SOURCE_NOTE = { manual: 'fecha manual', calculated: 'fecha calculada', inspection: 'según tarjeta ITV' };

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const COLORS = { overdue: '#b91c1c', soon: '#b45309', ok: '#15803d' };

function detailLine(item) {
  const extra = item.type === 'itv' && SOURCE_NOTE[item.source] ? ` · ${SOURCE_NOTE[item.source]}` : '';
  const stale = item.usageIsStale ? ' · km sin actualizar, puede estar desfasado' : '';
  return `${describeDue(item)}${extra}${stale}`;
}

/**
 * @param {{item:object, stage:string}[]} entries avisos de hoy (ya decididos)
 * @param {{today:string, appUrl?:string}} ctx
 * @returns {{subject:string, html:string, text:string}}
 */
export function renderDigest(entries, { today, appUrl }) {
  const overdue = entries.filter((e) => e.item.status === 'overdue');
  const soon = entries.filter((e) => e.item.status !== 'overdue');

  const parts = [];
  if (overdue.length) parts.push(`${overdue.length} ${overdue.length === 1 ? 'vencido' : 'vencidos'}`);
  if (soon.length) parts.push(`${soon.length} ${soon.length === 1 ? 'próximo' : 'próximos'}`);
  const subject = `Prakisama Mobility: ${parts.join(', ')} (${formatES(today)})`;

  const section = (title, list, status) =>
    list.length === 0
      ? ''
      : `<h2 style="font-size:16px;margin:24px 0 8px;color:${COLORS[status]}">${escapeHtml(title)} (${list.length})</h2>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
${list
  .map(
    ({ item }) => `<tr><td style="padding:10px 12px;border-left:4px solid ${COLORS[item.status]};background:#f7f8fa;border-bottom:6px solid #fff">
<strong style="font-size:15px">${escapeHtml(displayPlate(item.plate))}</strong>${item.vehicleName ? ` · ${escapeHtml(item.vehicleName)}` : ''}<br>
<span style="font-size:14px">${escapeHtml(item.title)}</span><br>
<span style="font-size:13px;color:#475569">${escapeHtml(detailLine(item))}</span>
</td></tr>`,
  )
  .join('\n')}
</table>`;

  // Colores de marca de prakisama.com. En email no hay tipografías web: se usa Arial/sistema.
  // El logo se carga desde la web de la empresa (los clientes de correo no admiten imágenes locales).
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:16px;background:#f7f8fa;font-family:Barlow,Arial,Helvetica,sans-serif;color:#15212e">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-top:4px solid #c62654;padding:20px 20px 24px">
<img src="https://prakisama.com/images/logo-prakisama.png" alt="Prakisama, S.L. Construcciones" width="150" style="display:block;border:0;height:auto;margin:0 0 16px">
<p style="margin:0 0 4px;color:#c62654;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">Prakisama Mobility</p>
<h1 style="font-size:24px;margin:0 0 4px;color:#074290">Resumen de la flota</h1>
<p style="margin:0;color:#54616f;font-size:14px">${escapeHtml(formatES(today))} · Vencimientos que requieren atención</p>
${section('Vencidos', overdue, 'overdue')}
${section('Próximos', soon, 'soon')}
${appUrl ? `<p style="margin:28px 0 0"><a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#074290;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:6px;font-size:14px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Abrir la app</a></p>` : ''}
<p style="margin:24px 0 0;color:#8b96a3;font-size:12px">Aviso automático de Prakisama Mobility. Puedes cambiar los destinatarios y las antelaciones en Ajustes.</p>
</div></body></html>`;

  const textSection = (title, list) =>
    list.length
      ? `${title.toUpperCase()} (${list.length})\n${list
          .map(({ item }) => `- ${displayPlate(item.plate)}${item.vehicleName ? ` (${item.vehicleName})` : ''} · ${item.title}\n  ${detailLine(item)}`)
          .join('\n')}\n`
      : '';
  const text = [`Resumen de la flota · ${formatES(today)}`, '', textSection('Vencidos', overdue), textSection('Próximos', soon), appUrl ? `Abrir la app: ${appUrl}` : '']
    .filter((block) => block !== '')
    .join('\n');

  return { subject, html, text };
}

/** Etiqueta del estado (exportada por comodidad para los tests y otros consumidores). */
export const statusLabel = (status) => STATUS_LABELS[status] ?? status;
