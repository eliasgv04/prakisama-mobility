// Registrar mantenimiento o avería (cualquier miembro). Un registro con km/horas también
// actualiza el contador del vehículo (lo hace un trigger en la base de datos).

import { MAINTENANCE_KINDS } from '@shared/constants.js';
import { todayISO } from '@shared/dates.js';
import { addMaintenanceRecord } from '../lib/api.js';
import { friendlyError } from '../lib/errors.js';
import { loadFleet } from '../lib/fleet.js';
import { fmtDate, fmtUsage, usageWord } from '../lib/format.js';
import { MAX_ATTACHMENT_BYTES, prepareAttachment } from '../lib/image.js';
import { displayPlate } from '../lib/matricula.js';
import { navigate } from '../router.js';
import { areaField, button, readForm, segmented, textField, toInt, toNum } from '../ui/components.js';
import { h, toast } from '../ui/dom.js';

export default async function recordForm({ params }) {
  const fleet = await loadFleet();
  if (fleet.offline) throw new Error('Necesitas conexión para registrar un mantenimiento.');
  const entry = fleet.status.byVehicle.get(params.id);
  if (!entry) throw new Error('No se encuentra este vehículo.');
  const { vehicle } = entry;

  let files = [];
  const fileList = h('div', { class: 'attachments' });
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*,application/pdf',
    multiple: true,
    hidden: true,
    onchange: (event) => {
      const chosen = [...event.target.files];
      const tooBig = chosen.filter((f) => f.size > MAX_ATTACHMENT_BYTES * 3); // el tope real se aplica tras comprimir
      if (tooBig.length) toast(`"${tooBig[0].name}" es demasiado grande.`, 'error');
      files = [...files, ...chosen.filter((f) => !tooBig.includes(f))];
      renderFiles();
      event.target.value = '';
    },
  });
  function renderFiles() {
    fileList.replaceChildren(
      ...files.map((file, index) =>
        h(
          'a',
          { href: '#', onclick: (event) => { event.preventDefault(); files = files.filter((_, i) => i !== index); renderFiles(); }, title: 'Quitar' },
          `${file.name} ✕`,
        ),
      ),
    );
  }

  const save = button('Guardar registro', { type: 'submit', block: true, iconName: 'check' });
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (event) => {
        event.preventDefault();
        const f = readForm(form);
        if (!f.record_date) return toast('Indica la fecha.', 'error');
        save.disabled = true;
        try {
          const prepared = [];
          for (const file of files) {
            const ready = await prepareAttachment(file);
            if (ready.size > MAX_ATTACHMENT_BYTES) throw new Error(`"${file.name}" pesa más de 10 MB.`);
            prepared.push(ready);
          }
          const { record, failedUploads } = await addMaintenanceRecord(
            {
              vehicle_id: vehicle.id,
              kind: f.kind,
              record_date: f.record_date,
              usage: toInt(f.usage),
              description: f.description,
              cost: toNum(f.cost),
              workshop: f.workshop,
            },
            prepared,
          );
          if (failedUploads.length) toast(`Registro guardado, pero no se pudo subir: ${failedUploads.join(', ')}`, 'error', 6000);
          else toast(await nextDueMessage(vehicle.id, record.kind), 'success', 5000);
          navigate(`/vehiculos/${vehicle.id}`);
        } catch (err) {
          toast(friendlyError(err), 'error');
          save.disabled = false;
        }
      },
    },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tipo'), segmented('kind', Object.entries(MAINTENANCE_KINDS), 'aceite')),
    textField('Fecha', 'record_date', { type: 'date', required: true, value: todayISO() }),
    textField(`${usageWord(vehicle.usage_unit)} en este momento`, 'usage', {
      type: 'number',
      inputmode: 'numeric',
      min: 0,
      step: 1,
      value: vehicle.current_usage ?? '',
      hint: 'Actualiza también el contador del vehículo si es mayor que el actual.',
    }),
    areaField('Descripción', 'description', { placeholder: 'Qué se ha hecho o qué ha fallado' }),
    h('div', { class: 'row2' }, textField('Coste (€), opcional', 'cost', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01' }), textField('Taller, opcional', 'workshop')),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Adjuntos (facturas, fotos)'),
      fileInput,
      button('Hacer foto o elegir archivos', { variant: 'ghost', iconName: 'camera', onClick: () => fileInput.click() }),
      fileList,
    ),
    save,
  );

  return {
    title: 'Nuevo registro',
    back: `/vehiculos/${vehicle.id}`,
    tab: 'vehiculos',
    node: h('div', { class: 'stack' }, h('p', { class: 'muted' }, `${displayPlate(vehicle.plate)}${vehicle.current_usage != null ? ` · ${fmtUsage(vehicle.current_usage, vehicle.usage_unit)}` : ''}`), form),
  };
}

/** Tras guardar, recalcula y dice cuándo toca el siguiente de ese tipo ("lo que ocurra antes"). */
async function nextDueMessage(vehicleId, kind) {
  try {
    const { status } = await loadFleet({ force: true });
    const view = status.byVehicle.get(vehicleId)?.rules.find((r) => r.rule.kind === kind);
    if (!view || view.missingReference || !view.trigger) return 'Registro guardado';
    const unit = status.byVehicle.get(vehicleId).vehicle.usage_unit;
    const parts = [view.dueUsage != null ? `a los ${fmtUsage(view.dueUsage, unit)}` : null, view.dueDate ? `el ${fmtDate(view.dueDate)}` : null].filter(Boolean);
    return `Registro guardado. Próximo: ${parts.join(' o ')}${parts.length > 1 ? ' (lo que ocurra antes)' : ''}.`;
  } catch {
    return 'Registro guardado';
  }
}
