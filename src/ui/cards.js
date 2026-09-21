// Tarjetas compartidas por varias pantallas.

import { describeDue } from '@shared/fleet.js';
import { VEHICLE_TYPES } from '@shared/constants.js';
import { fmtUsage } from '../lib/format.js';
import { itvSourceTag } from '../lib/fleet.js';
import { displayPlate } from '../lib/matricula.js';
import { h } from './dom.js';
import { icon, statusChip } from './components.js';

/** Un vencimiento (ITV o mantenimiento) del panel. */
export function itemCard(item, itv = null) {
  const tag = item.type === 'itv' && itv ? itvSourceTag(itv) : null;
  return h(
    'a',
    { class: `item ${item.status}`, href: `#/vehiculos/${item.vehicleId}` },
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 'line1' }, h('span', { class: 'plate' }, displayPlate(item.plate)), item.vehicleName ? h('span', { class: 'name' }, item.vehicleName) : null),
      h('div', { class: 'what' }, item.title, tag ? ' ' : null, tag ? h('span', { class: 'chip tag' }, tag) : null),
      h('div', { class: 'muted' }, describeDue(item)),
    ),
    statusChip(item.status),
  );
}

/** Miniatura de vehículo: foto si la hay (la URL firmada llega después) o un icono. */
export function thumb(vehicle) {
  const box = h('div', { class: 'thumb' }, icon('truck', 28));
  box.dataset.photoPath = vehicle.photo_path ?? '';
  return box;
}

/** Sustituye el icono por la foto cuando ya se conoce la URL. */
export function fillThumb(box, url) {
  if (!url) return;
  box.replaceChildren(h('img', { src: url, alt: '', loading: 'lazy', style: 'width:100%;height:100%;object-fit:cover' }));
}

/** Vehículo en la lista. */
export function vehicleCard(entry, thumbBox) {
  const { vehicle, status } = entry;
  const type = VEHICLE_TYPES[vehicle.vehicle_type]?.label ?? vehicle.vehicle_type;
  const name = [vehicle.alias, [vehicle.brand, vehicle.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  return h(
    'a',
    { class: `item ${vehicle.active ? status : ''}`, href: `#/vehiculos/${vehicle.id}` },
    thumbBox,
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 'line1' }, h('span', { class: 'plate' }, displayPlate(vehicle.plate))),
      name ? h('div', { class: 'name' }, name) : null,
      h('div', { class: 'muted small' }, `${type} · ${fmtUsage(vehicle.current_usage, vehicle.usage_unit)}`),
    ),
    vehicle.active ? statusChip(status) : h('span', { class: 'chip neutral' }, 'Baja'),
  );
}
