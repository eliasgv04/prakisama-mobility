// Ficha del vehículo: ITV, kilómetros, mantenimiento periódico e historial.

import { ITV_RESULTS, MAINTENANCE_KINDS, VEHICLE_TYPES } from '@shared/constants.js';
import { diffDays, todayISO } from '@shared/dates.js';
import { describeDue } from '@shared/fleet.js';
import { deleteInspection, deleteMaintenanceRecord, getHistory, setItvManualDate, signedUrls } from '../lib/api.js';
import { downloadItemIcs } from '../lib/calendar.js';
import { friendlyError } from '../lib/errors.js';
import { itvSourceTag, loadFleet } from '../lib/fleet.js';
import { daysAgo, fmtDate, fmtMoney, fmtUsage, usageWord } from '../lib/format.js';
import { displayPlate } from '../lib/matricula.js';
import { session } from '../lib/session.js';
import { navigate, refresh } from '../router.js';
import { button, empty, icon, section, spinner, statusChip } from '../ui/components.js';
import { clear, confirmDialog, h, openSheet, toast } from '../ui/dom.js';
import { openUsageSheet } from './usageSheet.js';

export default async function vehicleDetail({ params }) {
  const fleet = await loadFleet();
  const entry = fleet.status.byVehicle.get(params.id);
  if (!entry) throw new Error('No se encuentra este vehículo.');

  const { vehicle, itv, rules } = entry;
  const settings = fleet.status.settings;
  const online = !fleet.offline;

  // Dos columnas en pantalla ancha (datos, ITV y km | mantenimiento e historial); una sola en el móvil.
  const left = h('div', { class: 'col' });
  const right = h('div', { class: 'col' });
  const node = h('div', { class: 'detail-grid' }, left, right);
  left.append(heroCard(vehicle, entry, fleet), itvCard({ vehicle, entry, itv, settings, online }), usageCard({ vehicle, entry, settings, online }));
  right.append(rulesCard({ vehicle, rules, entry, settings, canEdit: online }));

  // El historial se carga aparte para que la ficha aparezca al instante.
  const historyHost = h('div', {});
  right.append(section('Historial', historyHost));
  if (online) loadHistory(historyHost, vehicle);
  else historyHost.append(h('div', { class: 'card muted' }, 'El historial no está disponible sin conexión.'));

  if (online) {
    right.append(h('div', { class: 'spacer' }), button('Editar vehículo', { variant: 'ghost', block: true, iconName: 'edit', onClick: () => navigate(`/vehiculos/${vehicle.id}/editar`) }));
  }

  return { title: displayPlate(vehicle.plate), hideTitle: true, wide: true, back: '/vehiculos', tab: 'vehiculos', node, offline: fleet.offline, cachedAt: fleet.cachedAt };
}

// ---------------------------------------------------------------------------

function heroCard(vehicle, entry) {
  const photo = h('div', { class: 'thumb' }, icon('truck', 34));
  if (vehicle.photo_path && navigator.onLine) {
    signedUrls('vehicle-photos', [vehicle.photo_path]).then((urls) => {
      if (urls[vehicle.photo_path]) photo.replaceChildren(h('img', { src: urls[vehicle.photo_path], alt: 'Foto del vehículo', style: 'width:100%;height:100%;object-fit:cover' }));
    });
  }
  const name = [vehicle.alias, [vehicle.brand, vehicle.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const rows = [
    ['Tipo', VEHICLE_TYPES[vehicle.vehicle_type]?.label],
    ['Matriculación', vehicle.first_registration_date ? fmtDate(vehicle.first_registration_date) : null],
    ['MMA', vehicle.gvw_kg ? `${vehicle.gvw_kg.toLocaleString('es-ES')} kg` : null],
  ].filter(([, value]) => value);

  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'hero' },
      photo,
      h(
        'div',
        { class: 'grow', style: 'min-width:0' },
        h('h2', { class: 'plate' }, displayPlate(vehicle.plate)),
        name ? h('div', { class: 'muted' }, name) : null,
        h('div', { style: 'margin-top:6px' }, vehicle.active ? statusChip(entry.status) : h('span', { class: 'chip neutral' }, 'De baja')),
      ),
    ),
    h('div', { class: 'spacer' }),
    h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    vehicle.notes ? h('p', { class: 'muted', style: 'margin-top:10px;white-space:pre-wrap' }, vehicle.notes) : null,
  );
}

function itvCard({ vehicle, entry, itv, settings, online }) {
  const card = h('div', { class: 'card' });
  const item = entry.items.find((i) => i.type === 'itv');

  if (!itv.applies) {
    card.append(h('p', { class: 'muted' }, 'La ITV no se controla en este vehículo.'));
  } else if (!itv.dueDate) {
    card.append(
      h(
        'p',
        { class: 'muted' },
        itv.reason === 'no_registration'
          ? 'Falta la fecha de matriculación para calcular la ITV. Edita el vehículo o pon una fecha manual.'
          : 'No hay regla de ITV para este tipo de vehículo. Configúrala en Ajustes → Cada cuánto toca la ITV, o pon una fecha manual.',
      ),
    );
  } else {
    const tag = itvSourceTag(itv);
    card.append(
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, h('div', { class: 'big' }, fmtDate(itv.dueDate)), statusChip(itv.status)),
      h('p', { class: 'muted', style: 'margin-top:4px' }, describeDue(item)),
      h('div', { style: 'margin-top:8px' }, tag ? h('span', { class: 'chip tag' }, tag) : null),
    );
    if (itv.estimated) card.append(h('p', { class: 'field-hint', style: 'margin-top:8px' }, 'Estimada a partir de la matriculación, suponiendo que las ITV anteriores se pasaron a tiempo. Registra la última para afinarla.'));
    if (itv.retest) card.append(h('p', { class: 'field-warn', style: 'margin-top:8px' }, `La última inspección fue ${ITV_RESULTS[itv.lastResult]?.toLowerCase()}: hay que repetirla antes de esa fecha.`));
    if (itv.source === 'manual') card.append(h('p', { class: 'field-hint', style: 'margin-top:8px' }, 'Fecha puesta a mano. Al registrar una ITV favorable se sustituye por la de la tarjeta.'));
  }

  const actions = h('div', { class: 'btn-row', style: 'margin-top:12px' });
  if (item) actions.append(button('Añadir al calendario', { small: true, variant: 'ghost', iconName: 'calendar', onClick: () => downloadItemIcs(item, settings) }));
  if (online) {
    actions.append(button('Registrar ITV', { small: true, iconName: 'clipboard', onClick: () => navigate(`/vehiculos/${vehicle.id}/itv/nueva`) }));
    if (itv.applies) actions.append(button('Fecha manual', { small: true, variant: 'ghost', iconName: 'edit', onClick: () => openManualDateSheet(vehicle) }));
  }
  card.append(actions);
  return section('ITV', card);
}

function openManualDateSheet(vehicle) {
  return openSheet('Próxima ITV manual', (close) => {
    const input = h('input', { type: 'date', required: true, value: vehicle.itv_manual_date ?? '' });
    const run = async (value) => {
      try {
        await setItvManualDate(vehicle.id, value);
        toast(value ? 'Fecha manual guardada' : 'Vuelve el cálculo automático', 'success');
        close(true);
        refresh();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
    };
    return h(
      'form',
      { class: 'stack', onsubmit: (event) => { event.preventDefault(); run(input.value); } },
      h('p', { class: 'muted' }, 'Sustituye a la fecha calculada. Úsala si conoces la fecha exacta (por ejemplo, la de la tarjeta ITV).'),
      input,
      button('Guardar fecha', { type: 'submit', block: true, iconName: 'check' }),
      vehicle.itv_manual_date ? button('Volver al cálculo automático', { variant: 'ghost', block: true, onClick: () => run(null) }) : null,
    );
  });
}

function usageCard({ vehicle, entry, settings, online }) {
  const stale = entry.usageUpdatedOn ? diffDays(entry.usageUpdatedOn, todayISO()) : null;
  const isStale = stale === null || stale > settings.usage_stale_days;
  const card = h(
    'div',
    { class: 'card' },
    h('div', { class: 'muted small' }, usageWord(vehicle.usage_unit)),
    h('div', { class: 'big' }, fmtUsage(vehicle.current_usage, vehicle.usage_unit)),
    h('p', { class: 'muted', style: 'margin-top:4px' }, entry.usageUpdatedOn ? `Actualizado el ${fmtDate(entry.usageUpdatedOn)} (${daysAgo(stale)})` : 'Sin fecha de actualización'),
    isStale && vehicle.current_usage != null
      ? h('p', { class: 'field-warn', style: 'margin-top:8px' }, 'Puede estar desfasado: actualízalo para que los avisos por km sean fiables.')
      : null,
    online ? h('div', { style: 'margin-top:12px' }, button(`Actualizar ${vehicle.usage_unit === 'h' ? 'horas' : 'km'}`, { block: true, iconName: 'gauge', onClick: () => openUsageSheet(vehicle) })) : null,
  );
  return section(vehicle.usage_unit === 'h' ? 'Horas de uso' : 'Kilómetros', card);
}

function rulesCard({ vehicle, rules, entry, settings, canEdit }) {
  const card = h('div', { class: 'card' });
  if (rules.length === 0) {
    card.append(h('p', { class: 'muted' }, canEdit ? 'Sin reglas. Añade, por ejemplo, el cambio de aceite cada 15.000 km o 12 meses.' : 'Este vehículo no tiene mantenimientos periódicos configurados.'));
  }
  for (const view of rules) {
    const item = entry.items.find((i) => i.ruleId === view.rule.id);
    card.append(
      h(
        'div',
        { class: 'record' },
        h('div', { class: 'head' }, h('span', { class: 'strong' }, view.title), item ? statusChip(view.status) : h('span', { class: 'chip neutral' }, 'Sin datos')),
        item
          ? h('div', { class: 'muted' }, describeDue(item))
          : h('div', { class: 'muted' }, 'Indica cuándo se hizo por última vez (Reglas) para poder calcular el siguiente.'),
        item && view.dueDate ? button('Añadir al calendario', { small: true, variant: 'ghost', iconName: 'calendar', onClick: () => downloadItemIcs({ ...item, trigger: 'date' }, settings) }) : null,
      ),
    );
  }
  if (canEdit) card.append(h('div', { style: 'margin-top:12px' }, button('Configurar reglas', { variant: 'ghost', block: true, iconName: 'wrench', onClick: () => navigate(`/vehiculos/${vehicle.id}/reglas`) })));
  return section('Mantenimiento periódico', card);
}

// ---------------------------------------------------------------------------
// Historial (mantenimientos e inspecciones de ITV)
// ---------------------------------------------------------------------------

async function loadHistory(host, vehicle) {
  host.replaceChildren(spinner());
  let history;
  try {
    history = await getHistory(vehicle.id);
  } catch (err) {
    host.replaceChildren(h('div', { class: 'card muted' }, friendlyError(err)));
    return;
  }

  let tab = 'maintenance';
  const content = h('div', { class: 'card' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });

  const attachmentsFor = (key, id) => history.attachments.filter((a) => a[key] === id);
  const attachmentList = (files) =>
    files.length === 0
      ? null
      : h(
          'div',
          { class: 'attachments' },
          files.map((file) =>
            h(
              'a',
              { href: file.url ?? '#', target: '_blank', rel: 'noopener', 'aria-label': `Abrir ${file.file_name ?? 'adjunto'}` },
              file.mime_type?.startsWith('image/') && file.url ? h('img', { src: file.url, alt: '', loading: 'lazy' }) : icon('file', 18),
              h('span', {}, file.file_name ?? 'Adjunto'),
            ),
          ),
        );

  const remove = (label, action) =>
    button('Borrar', {
      small: true,
      variant: 'danger',
      onClick: async () => {
        if (!(await confirmDialog({ title: `¿Borrar ${label}?`, message: 'También se borrarán sus adjuntos. No se puede deshacer.', confirmText: 'Borrar', danger: true }))) return;
        try {
          await action();
          toast('Borrado', 'success');
          refresh();
        } catch (err) {
          toast(friendlyError(err), 'error');
        }
      },
    });

  function render() {
    for (const button_ of tabs.children) button_.setAttribute('aria-selected', String(button_.dataset.tab === tab));
    clear(content);
    if (tab === 'maintenance') {
      if (history.records.length === 0) content.append(empty('Todavía no hay registros.'));
      for (const r of history.records) {
        content.append(
          h(
            'div',
            { class: 'record' },
            h('div', { class: 'head' }, h('span', { class: 'strong' }, MAINTENANCE_KINDS[r.kind] ?? r.kind), h('span', { class: 'muted small' }, fmtDate(r.record_date))),
            h('div', { class: 'muted small' }, [r.usage != null ? fmtUsage(r.usage, vehicle.usage_unit) : null, r.workshop, r.cost != null ? fmtMoney(r.cost) : null].filter(Boolean).join(' · ')),
            r.description ? h('p', { style: 'white-space:pre-wrap;margin-top:4px' }, r.description) : null,
            attachmentList(attachmentsFor('maintenance_record_id', r.id)),
            h('div', { style: 'margin-top:8px' }, remove('este registro', () => deleteMaintenanceRecord(r.id))),
          ),
        );
      }
    } else {
      if (history.inspections.length === 0) content.append(empty('Todavía no hay inspecciones registradas.'));
      for (const i of history.inspections) {
        content.append(
          h(
            'div',
            { class: 'record' },
            h('div', { class: 'head' }, h('span', { class: 'strong' }, `ITV ${ITV_RESULTS[i.result]?.toLowerCase() ?? i.result}`), h('span', { class: 'muted small' }, fmtDate(i.inspection_date))),
            h('div', { class: 'muted small' }, [i.valid_until ? `Caduca el ${fmtDate(i.valid_until)}` : null, i.station, i.cost != null ? fmtMoney(i.cost) : null].filter(Boolean).join(' · ')),
            i.notes ? h('p', { style: 'white-space:pre-wrap;margin-top:4px' }, i.notes) : null,
            attachmentList(attachmentsFor('itv_inspection_id', i.id)),
            h('div', { style: 'margin-top:8px' }, remove('esta inspección', () => deleteInspection(i.id))),
          ),
        );
      }
    }
  }

  for (const [id, label] of [['maintenance', 'Mantenimiento'], ['itv', 'ITV']]) {
    tabs.append(h('button', { type: 'button', role: 'tab', 'data-tab': id, onclick: () => { tab = id; render(); } }, label));
  }

  const add = h(
    'div',
    { class: 'btn-row', style: 'margin-top:12px' },
    button('Registrar mantenimiento o avería', { iconName: 'plus', onClick: () => navigate(`/vehiculos/${vehicle.id}/registro/nuevo`) }),
  );

  host.replaceChildren(tabs, content, add);
  render();
}
