// Registrar una inspección de ITV (solo administradores).
// Si es favorable y es la más reciente, la próxima fecha pasa a tomarse de la caducidad de la tarjeta
// (un trigger de la base de datos borra la fecha manual que hubiera).

import { ITV_RESULTS } from '@shared/constants.js';
import { todayISO } from '@shared/dates.js';
import { addInspection } from '../lib/api.js';
import { friendlyError } from '../lib/errors.js';
import { loadFleet } from '../lib/fleet.js';
import { fmtDate } from '../lib/format.js';
import { MAX_ATTACHMENT_BYTES, prepareAttachment } from '../lib/image.js';
import { displayPlate } from '../lib/matricula.js';
import { navigate } from '../router.js';
import { areaField, button, readForm, segmented, textField, toNum } from '../ui/components.js';
import { h, toast } from '../ui/dom.js';

export default async function itvForm({ params }) {
  const fleet = await loadFleet();
  if (fleet.offline) throw new Error('Necesitas conexión para registrar una ITV.');
  const entry = fleet.status.byVehicle.get(params.id);
  if (!entry) throw new Error('No se encuentra este vehículo.');
  const { vehicle } = entry;

  let file = null;
  const fileName = h('span', { class: 'field-hint' });
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*,application/pdf',
    hidden: true,
    onchange: (event) => {
      file = event.target.files?.[0] ?? null;
      fileName.textContent = file ? file.name : '';
    },
  });

  const validUntil = textField('Caduca el (fecha de la tarjeta ITV)', 'valid_until', {
    type: 'date',
    hint: 'Es la fecha que figura en la tarjeta. En una ITV favorable de esa fecha saldrá la próxima.',
  });

  const save = button('Guardar inspección', { type: 'submit', block: true, iconName: 'check' });
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (event) => {
        event.preventDefault();
        const f = readForm(form);
        if (!f.inspection_date) return toast('Indica la fecha de la inspección.', 'error');
        if (f.result === 'favorable' && !f.valid_until) return toast('Indica la fecha de caducidad de la tarjeta.', 'error');
        if (f.valid_until && f.valid_until < f.inspection_date) return toast('La caducidad no puede ser anterior a la inspección.', 'error');
        save.disabled = true;
        try {
          const attachments = [];
          if (file) {
            const ready = await prepareAttachment(file);
            if (ready.size > MAX_ATTACHMENT_BYTES) throw new Error('El adjunto pesa más de 10 MB.');
            attachments.push(ready);
          }
          const { failedUploads } = await addInspection(
            {
              vehicle_id: vehicle.id,
              inspection_date: f.inspection_date,
              result: f.result,
              valid_until: f.valid_until,
              station: f.station,
              cost: toNum(f.cost),
              notes: f.notes,
            },
            attachments,
          );
          const { status } = await loadFleet({ force: true });
          const itv = status.byVehicle.get(vehicle.id)?.itv;
          const next = itv?.dueDate ? ` Próxima fecha: ${fmtDate(itv.dueDate)}.` : '';
          toast(failedUploads.length ? 'Inspección guardada, pero el adjunto no se pudo subir.' : `Inspección guardada.${next}`, failedUploads.length ? 'error' : 'success', 5000);
          navigate(`/vehiculos/${vehicle.id}`);
        } catch (err) {
          toast(friendlyError(err), 'error');
          save.disabled = false;
        }
      },
    },
    textField('Fecha de la inspección', 'inspection_date', { type: 'date', required: true, value: todayISO() }),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Resultado'), segmented('result', Object.entries(ITV_RESULTS), 'favorable')),
    validUntil,
    h('div', { class: 'row2' }, textField('Estación, opcional', 'station'), textField('Coste (€), opcional', 'cost', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01' })),
    areaField('Notas', 'notes', { placeholder: 'Defectos anotados, etc.' }),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Adjunto (foto de la tarjeta ITV)'), fileInput, button('Hacer foto o elegir archivo', { variant: 'ghost', iconName: 'camera', onClick: () => fileInput.click() }), fileName),
    save,
  );

  return {
    title: 'Registrar ITV',
    back: `/vehiculos/${vehicle.id}`,
    tab: 'vehiculos',
    node: h('div', { class: 'stack' }, h('p', { class: 'muted' }, displayPlate(vehicle.plate)), form),
  };
}
