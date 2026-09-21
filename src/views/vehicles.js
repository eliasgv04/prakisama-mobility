// Lista de vehículos: búsqueda, estado por semáforo y acceso a la ficha.

import { STATUS_RANK } from '@shared/constants.js';
import { signedUrls } from '../lib/api.js';
import { loadFleet } from '../lib/fleet.js';
import { isAdmin } from '../lib/session.js';
import { fillThumb, thumb, vehicleCard } from '../ui/cards.js';
import { empty, icon } from '../ui/components.js';
import { clear, h } from '../ui/dom.js';

export default async function vehiclesList() {
  const { status, offline, cachedAt } = await loadFleet();
  const all = [...status.byVehicle.values()];
  const admin = isAdmin();

  let text = '';
  let showInactive = false;
  const listHost = h('div');
  const thumbs = new Map(); // photo_path → cajas de miniatura por rellenar

  const matches = (entry) => {
    if (!text) return true;
    const v = entry.vehicle;
    return [v.plate, v.brand, v.model, v.alias, v.notes].filter(Boolean).join(' ').toUpperCase().replace(/[\s-]/g, '').includes(text);
  };

  function renderList() {
    clear(listHost);
    const shown = all
      .filter((e) => (showInactive ? true : e.vehicle.active))
      .filter(matches)
      .sort((a, b) => {
        if (a.vehicle.active !== b.vehicle.active) return a.vehicle.active ? -1 : 1;
        return STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.vehicle.plate.localeCompare(b.vehicle.plate);
      });
    if (shown.length === 0) {
      listHost.append(empty(all.length === 0 ? 'Aún no hay vehículos.' : 'No hay vehículos que coincidan.'));
      return;
    }
    for (const entry of shown) {
      const box = thumb(entry.vehicle);
      if (entry.vehicle.photo_path) {
        if (!thumbs.has(entry.vehicle.photo_path)) thumbs.set(entry.vehicle.photo_path, []);
        thumbs.get(entry.vehicle.photo_path).push(box);
      }
      listHost.append(vehicleCard(entry, box));
    }
    loadPhotos();
  }

  async function loadPhotos() {
    if (offline || thumbs.size === 0) return;
    const urls = await signedUrls('vehicle-photos', [...thumbs.keys()]);
    for (const [path, boxes] of thumbs) for (const box of boxes) if (box.isConnected) fillThumb(box, urls[path]);
    thumbs.clear();
  }

  const search = h('input', {
    type: 'search',
    placeholder: 'Buscar matrícula, marca, alias…',
    'aria-label': 'Buscar vehículo',
    autocomplete: 'off',
    oninput: (event) => {
      text = event.target.value.toUpperCase().replace(/[\s-]/g, '');
      renderList();
    },
  });

  const node = h('div', { class: 'stack' }, search);
  if (all.some((e) => !e.vehicle.active)) {
    node.append(
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', onchange: (event) => { showInactive = event.target.checked; renderList(); } }),
        'Mostrar vehículos de baja',
      ),
    );
  }
  node.append(listHost);
  if (admin && !offline) {
    node.append(h('a', { class: 'fab', href: '#/vehiculos/nuevo', 'aria-label': 'Añadir vehículo' }, icon('plus')));
  }
  renderList();

  return { title: 'Vehículos', node, tab: 'vehiculos', offline, cachedAt };
}
