// Reglas de mantenimiento periódico de un vehículo (solo administradores).
// "Cada X km/horas o cada Y meses, lo que ocurra antes": basta con rellenar uno de los dos.

import { MAINTENANCE_KINDS, RULE_KINDS } from '@shared/constants.js';
import { todayISO } from '@shared/dates.js';
import { deleteRule, saveRule } from '../lib/api.js';
import { friendlyError } from '../lib/errors.js';
import { loadFleet } from '../lib/fleet.js';
import { displayPlate } from '../lib/matricula.js';
import { refresh } from '../router.js';
import { button, checkField, readForm, selectField, textField, toInt } from '../ui/components.js';
import { confirmDialog, h, toast } from '../ui/dom.js';

// Valores sugeridos al elegir el tipo (solo rellenan campos vacíos; se pueden cambiar).
const PRESETS = {
  aceite: { every_usage: 15000, every_months: 12 },
  revision: { every_usage: null, every_months: 12 },
  neumaticos: { every_usage: 40000, every_months: null },
  otro: { every_usage: null, every_months: null },
};

export default async function rulesForm({ params }) {
  const fleet = await loadFleet();
  if (fleet.offline) throw new Error('Necesitas conexión para configurar reglas.');
  const entry = fleet.status.byVehicle.get(params.id);
  if (!entry) throw new Error('No se encuentra este vehículo.');
  const { vehicle } = entry;
  const settings = fleet.status.settings;
  const unit = vehicle.usage_unit === 'h' ? 'horas' : 'km';

  const existing = fleet.snapshot.maintRules.filter((r) => r.vehicle_id === vehicle.id);
  const usedKinds = new Set(existing.map((r) => r.kind));
  const freeKinds = RULE_KINDS.filter((k) => !usedKinds.has(k));

  /** Formulario de una regla (existente o nueva). */
  function ruleForm(rule) {
    const isNew = !rule;
    const r = rule ?? { kind: freeKinds[0], warn_before_usage: settings.default_warn_usage, base_date: todayISO(), base_usage: vehicle.current_usage, active: true };

    const kindField = isNew
      ? selectField('Tipo', 'kind', freeKinds.map((k) => [k, MAINTENANCE_KINDS[k]]), { value: r.kind, onChange: (e) => applyPreset(e.target.value) })
      : null;
    const every = textField(`Cada cuántos ${unit}`, 'every_usage', { type: 'number', inputmode: 'numeric', min: 1, value: r.every_usage ?? '', hint: 'Déjalo vacío si solo va por tiempo.' });
    const months = textField('Cada cuántos meses', 'every_months', { type: 'number', inputmode: 'numeric', min: 1, value: r.every_months ?? '', hint: 'Déjalo vacío si solo va por ' + unit + '.' });
    const form = h('form', { class: 'stack' });

    function applyPreset(kind) {
      const preset = PRESETS[kind] ?? {};
      const usageInput = every.querySelector('input');
      const monthsInput = months.querySelector('input');
      if (!usageInput.value && preset.every_usage) usageInput.value = preset.every_usage;
      if (!monthsInput.value && preset.every_months) monthsInput.value = preset.every_months;
    }
    if (isNew) applyPreset(r.kind);

    const save = button(isNew ? 'Añadir regla' : 'Guardar', { type: 'submit', iconName: 'check' });
    form.append(
      h('h3', {}, isNew ? 'Nueva regla' : MAINTENANCE_KINDS[r.kind]),
      kindField,
      textField('Nombre (opcional)', 'name', { value: r.name ?? '', placeholder: MAINTENANCE_KINDS[r.kind] }),
      h('div', { class: 'row2' }, every, months),
      textField(`Avisar cuando falten (${unit})`, 'warn_before_usage', { type: 'number', inputmode: 'numeric', min: 0, value: r.warn_before_usage, hint: 'Umbral para pasar a "próximo" en las reglas por ' + unit + '.' }),
      h('div', { class: 'row2' }, textField('Última vez: fecha', 'base_date', { type: 'date', value: r.base_date ?? '' }), textField(`Última vez: ${unit}`, 'base_usage', { type: 'number', inputmode: 'numeric', min: 0, value: r.base_usage ?? '' })),
      isNew ? null : checkField('Regla activa', 'active', r.active),
      h('div', { class: 'btn-row' }, save, isNew ? null : button('Borrar', { variant: 'danger', onClick: () => remove(r) })),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const f = readForm(form);
      const fields = {
        name: f.name,
        every_usage: toInt(f.every_usage),
        every_months: toInt(f.every_months),
        warn_before_usage: toInt(f.warn_before_usage) ?? 0,
        base_date: f.base_date,
        base_usage: toInt(f.base_usage),
        active: f.active ?? true,
      };
      if (!fields.every_usage && !fields.every_months) return toast(`Rellena "cada cuántos ${unit}" o "cada cuántos meses" (o los dos).`, 'error');
      save.disabled = true;
      try {
        await saveRule(rule?.id ?? null, isNew ? { ...fields, vehicle_id: vehicle.id, kind: f.kind } : fields);
        toast('Regla guardada', 'success');
        refresh();
      } catch (err) {
        toast(friendlyError(err), 'error');
        save.disabled = false;
      }
    });
    return h('div', { class: 'card' }, form);
  }

  async function remove(rule) {
    const ok = await confirmDialog({ title: '¿Borrar esta regla?', message: 'Dejará de calcularse su próximo vencimiento. Los registros del historial se conservan.', confirmText: 'Borrar', danger: true });
    if (!ok) return;
    try {
      await deleteRule(rule.id);
      toast('Regla borrada', 'success');
      refresh();
    } catch (err) {
      toast(friendlyError(err), 'error');
    }
  }

  const node = h(
    'div',
    { class: 'stack' },
    h('p', { class: 'muted' }, `${displayPlate(vehicle.plate)} · El siguiente vencimiento se calcula desde la última vez (fecha y ${unit}) o desde el último registro de ese tipo, lo que ocurra antes.`),
    ...existing.map(ruleForm),
    freeKinds.length ? ruleForm(null) : h('p', { class: 'muted' }, 'Ya están todos los tipos de regla creados para este vehículo.'),
  );

  return { title: 'Reglas de mantenimiento', back: `/vehiculos/${vehicle.id}`, tab: 'vehiculos', node };
}
