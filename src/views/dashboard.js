// Panel principal: semáforo (vencidos / próximos / OK) y vencimientos ordenados por urgencia.

import { STATUS_LABELS } from '@shared/constants.js';
import { displayPlate } from '../lib/matricula.js';
import { daysAgo } from '../lib/format.js';
import { loadFleet } from '../lib/fleet.js';
import { button, empty, section } from '../ui/components.js';
import { itemCard } from '../ui/cards.js';
import { clear, h } from '../ui/dom.js';
import { openUsageSheet } from './usageSheet.js';

const MAX_ROWS = 6;

export default async function dashboard() {
  const fleet = await loadFleet();
  const { status, offline, cachedAt } = fleet;
  const entries = [...status.byVehicle.values()].filter((e) => e.vehicle.active);

  let filter = null; // 'overdue' | 'soon' | 'ok' | null
  const listHost = h('div', { class: 'list-grid' });
  const tileHost = h('div', { class: 'tiles', role: 'group', 'aria-label': 'Resumen por estado' });

  function renderTiles() {
    clear(tileHost);
    for (const key of ['overdue', 'soon', 'ok']) {
      tileHost.append(
        h(
          'button',
          {
            class: `tile ${key}`,
            type: 'button',
            'aria-pressed': String(filter === key),
            onclick: () => {
              filter = filter === key ? null : key;
              renderTiles();
              renderList();
            },
          },
          h('b', {}, String(status.counts[key])),
          h('span', {}, STATUS_LABELS[key] === 'OK' ? 'Al día' : `${STATUS_LABELS[key]}s`),
        ),
      );
    }
  }

  function renderList() {
    clear(listHost);
    const shown = status.items.filter((item) => !filter || item.status === filter);
    if (shown.length === 0) {
      listHost.append(
        empty(
          status.items.length === 0
            ? 'Todavía no hay vencimientos. Añade vehículos y aparecerán aquí ordenados por urgencia.'
            : 'No hay vencimientos con este estado.',
        ),
      );
      return;
    }
    for (const item of shown) listHost.append(itemCard(item, status.byVehicle.get(item.vehicleId).itv));
  }

  renderTiles();
  renderList();

  // --- Avisos de calidad de datos: sin ellos, los avisos por km y por ITV no son fiables ---
  const stale = entries.filter((e) => e.rules.some((r) => r.rule.every_usage && r.usageIsStale));
  const noItv = entries.filter((e) => e.itv.applies && !e.itv.dueDate);

  // Portada: fecha de hoy y cuántos vencimientos piden atención.
  const attention = status.counts.overdue + status.counts.soon;
  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const summary =
    status.items.length === 0
      ? 'Añade vehículos para ver aquí sus vencimientos.'
      : attention === 0
        ? 'Toda la flota está al día.'
        : `${attention === 1 ? '1 vencimiento pide' : `${attention} vencimientos piden`} atención.`;
  const hero = h(
    'div',
    { class: 'hero-band' },
    h('div', { class: 'eyebrow' }, 'Panel de control'),
    h('h1', {}, 'Estado de la flota'),
    h('p', {}, `${today.charAt(0).toUpperCase()}${today.slice(1)} · `, h('strong', {}, summary)),
  );

  const node = h('div', {}, hero, tileHost, section('Vencimientos', listHost));

  if (stale.length) {
    node.append(
      section(
        `Km sin actualizar (${stale.length})`,
        h('p', { class: 'muted', style: 'margin:0 4px 8px' }, 'Los avisos por km dependen de que el contador esté al día.'),
        h('div', { class: 'list-grid' }, ...stale.slice(0, MAX_ROWS).map((entry) =>
          h(
            'div',
            { class: 'item' },
            h(
              'div',
              { class: 'grow' },
              h('a', { class: 'plate', href: `#/vehiculos/${entry.vehicle.id}` }, displayPlate(entry.vehicle.plate)),
              h('div', { class: 'muted small' }, entry.usageUpdatedOn ? `Última vez ${daysAgo(entry.rules.find((r) => r.usageStaleDays != null)?.usageStaleDays ?? 0)}` : 'Nunca actualizado'),
            ),
            offline ? null : button('Actualizar', { small: true, onClick: () => openUsageSheet(entry.vehicle) }),
          ),
        )),
        stale.length > MAX_ROWS ? h('p', { class: 'muted', style: 'margin:8px 4px' }, `…y ${stale.length - MAX_ROWS} más en Vehículos.`) : null,
      ),
    );
  }

  if (noItv.length) {
    node.append(
      section(
        `ITV sin fecha (${noItv.length})`,
        h('p', { class: 'muted', style: 'margin:0 4px 8px' }, 'No se puede calcular la próxima ITV: falta la matriculación o la regla de ese tipo.'),
        h('div', { class: 'list-grid' }, ...noItv.slice(0, MAX_ROWS).map((entry) =>
          h(
            'a',
            { class: 'item', href: `#/vehiculos/${entry.vehicle.id}` },
            h('div', { class: 'grow' }, h('span', { class: 'plate' }, displayPlate(entry.vehicle.plate))),
            h('span', { class: 'chip neutral' }, entry.itv.reason === 'no_registration' ? 'Falta matriculación' : 'Sin regla'),
          ),
        )),
      ),
    );
  }

  return { title: 'Panel', node, tab: 'panel', offline, cachedAt, wide: true, hideTitle: true };
}
