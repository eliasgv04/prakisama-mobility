// Ficha del vehículo: ITV, kilómetros, mantenimiento periódico e historial.

import { FINANCING_TYPES, ITV_RESULTS, MAINTENANCE_KINDS, VEHICLE_TYPES } from '@shared/constants.js';
import { addYears, diffDays, todayISO } from '@shared/dates.js';
import { describeDue } from '@shared/fleet.js';
import { deleteInspection, deleteInsuranceHistory, deleteMaintenanceRecord, getHistory, getInsuranceHistory, renewInsurance, setItvManualDate, signedUrls } from '../lib/api.js';
import { downloadItemIcs } from '../lib/calendar.js';
import { friendlyError } from '../lib/errors.js';
import { itvSourceTag, loadFleet } from '../lib/fleet.js';
import { daysAgo, fmtDate, fmtMoney, fmtUsage, usageWord } from '../lib/format.js';
import { displayPlate } from '../lib/matricula.js';
import { session } from '../lib/session.js';
import { navigate, refresh } from '../router.js';
import { button, icon, readForm, spinner, statusChip, textField, toNum } from '../ui/components.js';
import { clear, confirmDialog, h, openSheet, toast } from '../ui/dom.js';
import { openUsageSheet } from './usageSheet.js';

export default async function vehicleDetail({ params }) {
  const fleet = await loadFleet();
  const entry = fleet.status.byVehicle.get(params.id);
  if (!entry) throw new Error('No se encuentra este vehículo.');

  const { vehicle, itv, rules } = entry;
  const settings = fleet.status.settings;
  const online = !fleet.offline;

  // Cabecera del vehículo a todo el ancho y, debajo, una cuadrícula POR FILAS (dos tarjetas por fila
  // en pantalla ancha, una en el móvil): ITV | Seguro, Km | Mantenimiento periódico y el historial a
  // todo el ancho. Las tarjetas de una fila miden lo mismo y sus botones quedan alineados abajo.
  const grid = h(
    'div',
    { class: 'detail-grid' },
    itvCard({ vehicle, entry, itv, settings, online }),
    insuranceCard({ vehicle, entry, settings, online }),
    usageCard({ vehicle, entry, settings, online }),
    rulesCard({ vehicle, rules, entry, settings, canEdit: online }),
  );
  const node = h('div', {}, heroCard(vehicle, entry, online), grid);

  // El historial se carga aparte para que la ficha aparezca al instante.
  const historyHost = h('div', {});
  grid.append(h('div', { class: 'card panel full' }, h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, 'Historial')), historyHost));
  if (online) loadHistory(historyHost, vehicle);
  else historyHost.append(h('p', { class: 'panel-text' }, 'El historial no está disponible sin conexión.'));

  return { title: displayPlate(vehicle.plate), hideTitle: true, wide: true, back: '/vehiculos', tab: 'vehiculos', node, offline: fleet.offline, cachedAt: fleet.cachedAt };
}

// ---------------------------------------------------------------------------
// Piezas comunes. Todas las tarjetas siguen el mismo esquema y solo usan cuatro tamaños de letra:
//   título (etiqueta granate) + estado · dato grande · texto gris · datos · pie con botones iguales
// ---------------------------------------------------------------------------

/** Tarjeta con su título dentro y, opcionalmente, el estado a la derecha del título. */
const panel = (title, chip, ...content) =>
  h('div', { class: 'card panel' }, h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, title), chip ?? null), ...content);

/** Dato principal (fecha, km…). Sin dato se muestra en gris en el mismo sitio, para que la tarjeta no cambie de forma. */
const panelValue = (value, missing) => h('div', { class: `panel-value${value ? '' : ' missing'}` }, value || missing);

/** Texto secundario, siempre del mismo tamaño. */
const panelText = (...content) => h('p', { class: 'panel-text' }, ...content);

/** Pie de tarjeta: los botones se reparten el ancho a partes iguales. Si no hay ninguno, no se pinta. */
const cardActions = (...buttons) => {
  const list = buttons.filter(Boolean);
  return list.length ? h('div', { class: 'card-actions' }, list) : null;
};

/** Lista de "etiqueta: valor" (solo las filas con valor). */
const facts = (rows) => {
  const shown = rows.filter(([, value]) => value);
  return shown.length ? h('dl', { class: 'facts' }, shown.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))) : null;
};

/** Botón discreto (texto con icono) para acciones secundarias dentro de una lista. */
const linkButton = (label, iconName, onClick, danger = false) =>
  h('button', { type: 'button', class: `link-btn${danger ? ' danger' : ''}`, onclick: onClick }, icon(iconName, 18), label);

const deleteLink = (label, action, onDone = refresh, message = 'No se puede deshacer.') =>
  linkButton('Borrar', 'trash', async () => {
    if (!(await confirmDialog({ title: `¿Borrar ${label}?`, message, confirmText: 'Borrar', danger: true }))) return;
    try {
      await action();
      toast('Borrado', 'success');
      onDone();
    } catch (err) {
      toast(friendlyError(err), 'error');
    }
  }, true);

// ---------------------------------------------------------------------------

function heroCard(vehicle, entry, online) {
  const photo = h('div', { class: 'thumb' }, icon('truck', 34));
  if (vehicle.photo_path && navigator.onLine) {
    signedUrls('vehicle-photos', [vehicle.photo_path]).then((urls) => {
      if (urls[vehicle.photo_path]) photo.replaceChildren(h('img', { src: urls[vehicle.photo_path], alt: 'Foto del vehículo', style: 'width:100%;height:100%;object-fit:cover' }));
    });
  }
  const name = [vehicle.alias, [vehicle.brand, vehicle.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const financing = vehicle.financing_type
    ? [FINANCING_TYPES[vehicle.financing_type], vehicle.financing_lender, vehicle.financing_end_date ? `hasta ${fmtDate(vehicle.financing_end_date)}` : null].filter(Boolean).join(' · ')
    : null;
  return h(
    'div',
    { class: 'card vehicle-head' },
    h(
      'div',
      { class: 'hero' },
      photo,
      h(
        'div',
        { class: 'grow' },
        h('h2', { class: 'plate' }, displayPlate(vehicle.plate)),
        name ? h('div', { class: 'muted' }, name) : null,
        h('div', { style: 'margin-top:8px' }, vehicle.active ? statusChip(entry.status) : h('span', { class: 'chip neutral' }, 'De baja')),
      ),
      online ? button('Editar vehículo', { small: true, variant: 'ghost', iconName: 'edit', onClick: () => navigate(`/vehiculos/${vehicle.id}/editar`) }) : null,
    ),
    facts([
      ['Tipo', VEHICLE_TYPES[vehicle.vehicle_type]?.label],
      ['Matriculación', vehicle.first_registration_date ? fmtDate(vehicle.first_registration_date) : null],
      ['MMA', vehicle.gvw_kg ? `${vehicle.gvw_kg.toLocaleString('es-ES')} kg` : null],
      ['Financiación', financing],
    ]),
    vehicle.notes ? h('p', { class: 'notes' }, vehicle.notes) : null,
  );
}

function itvCard({ vehicle, entry, itv, settings, online }) {
  const item = entry.items.find((i) => i.type === 'itv');
  const card = panel(
    'ITV',
    itv.dueDate ? statusChip(itv.status) : null,
    panelValue(itv.dueDate ? fmtDate(itv.dueDate) : null, itv.applies ? 'Sin fecha' : 'No aplica'),
  );

  if (!itv.applies) {
    card.append(panelText('La ITV no se controla en este vehículo.'));
  } else if (!itv.dueDate) {
    card.append(
      panelText(
        itv.reason === 'no_registration'
          ? 'Falta la fecha de matriculación para calcularla. Edita el vehículo o pon una fecha manual.'
          : 'No hay regla de ITV para este tipo de vehículo. Configúrala en Ajustes o pon una fecha manual.',
      ),
    );
  } else {
    const tag = itvSourceTag(itv);
    card.append(panelText(describeDue(item), tag ? h('span', { class: 'chip tag' }, tag) : null));
    if (itv.estimated) card.append(panelText('Estimada a partir de la matriculación, suponiendo que las ITV anteriores se pasaron a tiempo. Registra la última para afinarla.'));
    if (itv.retest) card.append(h('p', { class: 'field-warn card-note' }, `La última inspección fue ${ITV_RESULTS[itv.lastResult]?.toLowerCase()}: hay que repetirla antes de esa fecha.`));
    if (itv.source === 'manual') card.append(panelText('Fecha puesta a mano. Al registrar una ITV favorable se sustituye por la de la tarjeta.'));
  }

  // Mismo orden en todas las tarjetas: acción principal, después las secundarias.
  card.append(
    cardActions(
      online && button('Registrar ITV', { small: true, iconName: 'clipboard', onClick: () => navigate(`/vehiculos/${vehicle.id}/itv/nueva`) }),
      online && itv.applies && button('Fecha manual', { small: true, variant: 'ghost', iconName: 'edit', onClick: () => openManualDateSheet(vehicle) }),
      item && button('Calendario', { small: true, variant: 'ghost', iconName: 'calendar', onClick: () => downloadItemIcs(item, settings) }),
    ) ?? '',
  );
  return card;
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

/**
 * Seguro: vencimiento, precio y pólizas anteriores. "Renovar seguro" pone la nueva póliza y guarda
 * la actual en el historial, para comparar precios cuando toca pedir presupuesto.
 */
function insuranceCard({ vehicle, entry, settings, online }) {
  const hasInsurance = Boolean(vehicle.insurance_type || vehicle.insurer || vehicle.insurance_expiry || vehicle.insurance_cost != null);
  if (!hasInsurance && !online) return null;
  const item = entry.items.find((i) => i.type === 'insurance');
  const card = panel('Seguro', item ? statusChip(item.status) : null, panelValue(item ? fmtDate(item.dueDate) : null, hasInsurance ? 'Sin fecha' : 'Sin seguro'));

  if (item) {
    card.append(panelText(describeDue(item)));
    if (item.status === 'overdue') card.append(h('p', { class: 'field-warn card-note' }, 'Si ya lo has renovado, pulsa "Renovar seguro" y pon la nueva fecha.'));
  } else {
    card.append(panelText(hasInsurance ? 'Pulsa "Renovar seguro" para añadir la fecha de vencimiento y que entre en los avisos.' : 'Añádelo para que avise antes de que venza.'));
  }

  card.append(
    facts([
      ['Aseguradora', vehicle.insurer],
      ['Tipo', vehicle.insurance_type],
      ['Precio', vehicle.insurance_cost != null ? `${fmtMoney(vehicle.insurance_cost)} al año` : null],
    ]) ?? '',
  );

  // Pólizas anteriores (se cargan aparte, solo con conexión), antes de los botones.
  if (online && hasInsurance) {
    const historyHost = h('div', {});
    card.append(historyHost);
    loadInsuranceHistory(historyHost, vehicle);
  }

  card.append(
    cardActions(
      online && button(hasInsurance ? 'Renovar seguro' : 'Añadir seguro', { small: true, iconName: hasInsurance ? 'check' : 'plus', onClick: () => openInsuranceSheet(vehicle) }),
      item && button('Calendario', { small: true, variant: 'ghost', iconName: 'calendar', onClick: () => downloadItemIcs(item, settings) }),
    ) ?? '',
  );
  return card;
}

async function loadInsuranceHistory(host, vehicle) {
  let history;
  try {
    history = await getInsuranceHistory(vehicle.id);
  } catch {
    return; // el historial es secundario: si falla, la tarjeta se queda sin él
  }
  if (history.length === 0) return;

  const previous = history.find((p) => p.cost != null);
  const compare =
    previous && vehicle.insurance_cost != null && Number(previous.cost) !== Number(vehicle.insurance_cost)
      ? (() => {
          const diff = Number(vehicle.insurance_cost) - Number(previous.cost);
          return panelText(`Pagas ${fmtMoney(Math.abs(diff))} ${diff < 0 ? 'menos' : 'más'} que en la póliza anterior.`);
        })()
      : null;

  host.replaceChildren(
    ...(compare ? [compare] : []),
    h('div', { class: 'sub-title' }, 'Pólizas anteriores'),
    h(
      'div',
      { class: 'records' },
      history.map((p) =>
        h(
          'div',
          { class: 'record' },
          h('div', { class: 'head' }, h('span', { class: 'strong' }, p.insurer ?? 'Sin aseguradora'), h('span', { class: 'strong' }, p.cost != null ? fmtMoney(p.cost) : '—')),
          h(
            'div',
            { class: 'record-foot' },
            h('span', { class: 'meta' }, [p.insurance_type, p.expiry_date ? `Vencía el ${fmtDate(p.expiry_date)}` : null].filter(Boolean).join(' · ')),
            deleteLink('esta póliza del historial', () => deleteInsuranceHistory(p.id), () => loadInsuranceHistory(host, vehicle)),
          ),
        ),
      ),
    ),
  );
}

function openInsuranceSheet(vehicle) {
  const renewing = Boolean(vehicle.insurance_expiry || vehicle.insurer);
  return openSheet(renewing ? 'Renovar seguro' : 'Añadir seguro', (close) => {
    // Lo normal es renovar por un año: se propone la fecha anterior + 1 año (editable).
    const suggested = vehicle.insurance_expiry ? addYears(vehicle.insurance_expiry, 1) : '';
    const save = button('Guardar', { type: 'submit', block: true, iconName: 'check' });
    const form = h(
      'form',
      {
        class: 'stack',
        onsubmit: async (event) => {
          event.preventDefault();
          const f = readForm(form);
          if (!f.insurance_expiry) return toast('Pon la fecha del nuevo vencimiento.', 'error');
          save.disabled = true;
          try {
            await renewInsurance(vehicle.id, { expiry: f.insurance_expiry, insurer: f.insurer, type: f.insurance_type, cost: toNum(f.insurance_cost) });
            toast('Seguro guardado', 'success');
            close(true);
            refresh();
          } catch (err) {
            toast(friendlyError(err), 'error');
            save.disabled = false;
          }
        },
      },
      renewing
        ? h(
            'p',
            { class: 'muted' },
            `La póliza actual${vehicle.insurance_cost != null ? ` (${fmtMoney(vehicle.insurance_cost)})` : ''} se guarda en "Pólizas anteriores" para poder comparar precios. Si cambias de compañía o de precio, escribe los nuevos.`,
          )
        : null,
      textField('Nuevo vencimiento', 'insurance_expiry', { type: 'date', required: true, value: suggested }),
      textField('Aseguradora', 'insurer', { value: vehicle.insurer ?? '' }),
      h(
        'div',
        { class: 'row2' },
        textField('Precio anual (€)', 'insurance_cost', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01', value: vehicle.insurance_cost ?? '' }),
        textField('Tipo de seguro', 'insurance_type', { value: vehicle.insurance_type ?? '', placeholder: 'Ej.: Todo riesgo' }),
      ),
      save,
    );
    return form;
  });
}

function usageCard({ vehicle, entry, settings, online }) {
  const stale = entry.usageUpdatedOn ? diffDays(entry.usageUpdatedOn, todayISO()) : null;
  const isStale = stale === null || stale > settings.usage_stale_days;
  const hasUsage = vehicle.current_usage != null;
  const card = panel(
    usageWord(vehicle.usage_unit),
    isStale && hasUsage ? h('span', { class: 'chip soon' }, 'Revisar') : null,
    panelValue(hasUsage ? fmtUsage(vehicle.current_usage, vehicle.usage_unit) : null, 'Sin datos'),
    panelText(entry.usageUpdatedOn ? `Actualizado el ${fmtDate(entry.usageUpdatedOn)} (${daysAgo(stale)})` : 'Todavía no se han apuntado.'),
    isStale && hasUsage
      ? h('p', { class: 'field-warn card-note' }, 'Puede estar desfasado: actualízalo para que los avisos por km sean fiables.')
      : null,
    cardActions(online && button(`Actualizar ${vehicle.usage_unit === 'h' ? 'horas' : 'km'}`, { small: true, iconName: 'gauge', onClick: () => openUsageSheet(vehicle) })),
  );
  return card;
}

function rulesCard({ vehicle, rules, entry, settings, canEdit }) {
  const card = panel('Mantenimiento periódico', null);
  if (rules.length === 0) {
    card.append(panelText(canEdit ? 'Sin reglas. Añade, por ejemplo, el cambio de aceite cada 15.000 km o 12 meses.' : 'Este vehículo no tiene mantenimientos periódicos configurados.'));
  }
  if (rules.length) {
    card.append(
      h(
        'div',
        { class: 'records' },
        rules.map((view) => {
          const item = entry.items.find((i) => i.ruleId === view.rule.id);
          return h(
            'div',
            { class: 'record' },
            h('div', { class: 'head' }, h('span', { class: 'strong' }, view.title), item ? statusChip(view.status) : h('span', { class: 'chip neutral' }, 'Sin datos')),
            h(
              'div',
              { class: 'record-foot' },
              h('span', { class: 'meta' }, item ? describeDue(item) : 'Indica cuándo se hizo por última vez (Reglas) para poder calcular el siguiente.'),
              item && view.dueDate ? linkButton('Calendario', 'calendar', () => downloadItemIcs({ ...item, trigger: 'date' }, settings)) : null,
            ),
          );
        }),
      ),
    );
  }
  card.append(cardActions(canEdit && button('Configurar reglas', { small: true, variant: 'ghost', iconName: 'wrench', onClick: () => navigate(`/vehiculos/${vehicle.id}/reglas`) })) ?? '');
  return card;
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
  const list = h('div', { class: 'records' });
  const add = h('div', { class: 'card-actions' });
  const content = h('div', {}, list, add);
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

  const remove = (label, action) => deleteLink(label, action, refresh, 'También se borrarán sus adjuntos. No se puede deshacer.');

  // Todos los registros con la misma forma: título y fecha · datos · texto · adjuntos · pie (detalle y "Borrar").
  const record = ({ title, date, meta, text, files, onDelete }) =>
    h(
      'div',
      { class: 'record' },
      h('div', { class: 'head' }, h('span', { class: 'strong' }, title), h('span', { class: 'meta' }, date)),
      text ? h('p', { class: 'record-text' }, text) : null,
      attachmentList(files),
      h('div', { class: 'record-foot' }, h('span', { class: 'meta' }, meta), onDelete),
    );

  function render() {
    for (const button_ of tabs.children) button_.setAttribute('aria-selected', String(button_.dataset.tab === tab));
    clear(list);
    // El botón de abajo registra lo que se está viendo.
    add.replaceChildren(
      tab === 'maintenance'
        ? button('Registrar mantenimiento o avería', { small: true, iconName: 'plus', onClick: () => navigate(`/vehiculos/${vehicle.id}/registro/nuevo`) })
        : button('Registrar ITV', { small: true, iconName: 'clipboard', onClick: () => navigate(`/vehiculos/${vehicle.id}/itv/nueva`) }),
    );
    if (tab === 'maintenance') {
      if (history.records.length === 0) list.append(panelText('Todavía no hay registros.'));
      for (const r of history.records) {
        list.append(
          record({
            title: MAINTENANCE_KINDS[r.kind] ?? r.kind,
            date: fmtDate(r.record_date),
            meta: [r.usage != null ? fmtUsage(r.usage, vehicle.usage_unit) : null, r.workshop, r.cost != null ? fmtMoney(r.cost) : null].filter(Boolean).join(' · '),
            text: r.description,
            files: attachmentsFor('maintenance_record_id', r.id),
            onDelete: remove('este registro', () => deleteMaintenanceRecord(r.id)),
          }),
        );
      }
    } else {
      if (history.inspections.length === 0) list.append(panelText('Todavía no hay inspecciones registradas.'));
      for (const i of history.inspections) {
        list.append(
          record({
            title: `ITV ${ITV_RESULTS[i.result]?.toLowerCase() ?? i.result}`,
            date: fmtDate(i.inspection_date),
            meta: [i.valid_until ? `Caduca el ${fmtDate(i.valid_until)}` : null, i.station, i.cost != null ? fmtMoney(i.cost) : null].filter(Boolean).join(' · '),
            text: i.notes,
            files: attachmentsFor('itv_inspection_id', i.id),
            onDelete: remove('esta inspección', () => deleteInspection(i.id)),
          }),
        );
      }
    }
  }

  for (const [id, label] of [['maintenance', 'Mantenimiento'], ['itv', 'ITV']]) {
    tabs.append(h('button', { type: 'button', role: 'tab', 'data-tab': id, onclick: () => { tab = id; render(); } }, label));
  }

  host.replaceChildren(tabs, content);
  render();
}
