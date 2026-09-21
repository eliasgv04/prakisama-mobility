// Hoja "Actualizar kilómetros / horas": la usa el panel y la ficha del vehículo.

import { diffDays, isoDateOf, todayISO } from '@shared/dates.js';
import { updateUsage } from '../lib/api.js';
import { friendlyError } from '../lib/errors.js';
import { daysAgo, fmtUsage } from '../lib/format.js';
import { refresh } from '../router.js';
import { button } from '../ui/components.js';
import { confirmDialog, h, openSheet, toast } from '../ui/dom.js';

export function openUsageSheet(vehicle) {
  const unit = vehicle.usage_unit;
  const word = unit === 'h' ? 'horas de uso' : 'kilómetros';
  const last = vehicle.usage_updated_at ? daysAgo(diffDays(isoDateOf(vehicle.usage_updated_at), todayISO())) : null;

  return openSheet(`Actualizar ${word}`, (close) => {
    const input = h('input', {
      type: 'number',
      inputmode: 'numeric',
      min: 0,
      step: 1,
      required: true,
      autofocus: true,
      value: vehicle.current_usage ?? '',
      'aria-label': `Valor actual de ${word}`,
    });
    const save = button('Guardar', { type: 'submit', block: true, iconName: 'check' });

    const form = h(
      'form',
      {
        class: 'stack',
        onsubmit: async (event) => {
          event.preventDefault();
          const value = Math.round(Number(input.value));
          if (!Number.isFinite(value) || value < 0) return toast('Introduce un número válido.', 'error');
          if (vehicle.current_usage != null && value < vehicle.current_usage) {
            const ok = await confirmDialog({
              title: '¿Corregir a un valor menor?',
              message: `Ahora consta ${fmtUsage(vehicle.current_usage, unit)} y vas a poner ${fmtUsage(value, unit)}.`,
              confirmText: 'Sí, corregir',
            });
            if (!ok) return;
          }
          save.disabled = true;
          try {
            await updateUsage(vehicle.id, value);
            toast('Actualizado', 'success');
            close(true);
            refresh();
          } catch (err) {
            toast(friendlyError(err), 'error');
            save.disabled = false;
          }
        },
      },
      h('p', { class: 'muted' }, vehicle.current_usage != null ? `Ahora consta ${fmtUsage(vehicle.current_usage, unit)}${last ? ` (actualizado ${last})` : ''}.` : 'Todavía no hay ningún dato.'),
      input,
      save,
    );
    return form;
  });
}
