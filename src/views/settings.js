// Ajustes. Cuatro tarjetas plegables agrupadas en Avisos / ITV / Equipo.
// Cerradas enseñan un resumen de cómo está cada cosa; abiertas dejan cambiarla. Solo hay una abierta
// a la vez y al guardar no se recarga la pantalla: se actualiza el resumen de la propia tarjeta.

import { VEHICLE_TYPES } from '@shared/constants.js';
import { describeItvRule, isRuleUsable, itvAgeSequence } from '@shared/itv.js';
import { listProfiles, saveItvRule, saveSettings, updateProfile } from '../lib/api.js';
import { friendlyError } from '../lib/errors.js';
import { loadFleet } from '../lib/fleet.js';
import { fmtDateTime, fmtNumber } from '../lib/format.js';
import { session } from '../lib/session.js';
import { accordion, makeExclusive } from '../ui/accordion.js';
import { areaField, button, checkField, iconButton, readForm, section, textField, toInt } from '../ui/components.js';
import { h, toast } from '../ui/dom.js';

/** [30, 15, 7] → "30, 15 y 7" */
const listES = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default async function settings() {
  const fleet = await loadFleet({ force: true });
  if (fleet.offline) throw new Error('Necesitas conexión para cambiar los ajustes.');
  const cfg = { ...fleet.status.settings }; // copia local: se actualiza al guardar
  const typeOrder = Object.keys(VEHICLE_TYPES);
  const itvRules = [...fleet.snapshot.itvRules].sort((a, b) => typeOrder.indexOf(a.vehicle_type) - typeOrder.indexOf(b.vehicle_type));
  const profiles = await listProfiles();

  const root = h(
    'div',
    {},
    h('p', { class: 'muted' }, 'Toca una tarjeta para abrirla y cambiar sus ajustes.'),
    section('Avisos por email', whenCard(cfg).el, usageCard(cfg).el),
    section('ITV', itvCard(itvRules).el),
    section('Equipo', usersCard(profiles).el),
  );
  makeExclusive(root);
  return { title: 'Ajustes', tab: 'ajustes', node: root };
}

async function run(btn, task, okText) {
  btn.disabled = true;
  try {
    await task();
    toast(okText, 'success');
  } catch (err) {
    toast(friendlyError(err), 'error');
  } finally {
    btn.disabled = false;
  }
}

const saveButton = (label = 'Guardar cambios') => button(label, { type: 'submit', block: true, iconName: 'check' });

// ---------------------------------------------------------------------------
// Avisos · cuándo y de qué
// ---------------------------------------------------------------------------

function whenSummary(cfg) {
  const lead = [...cfg.lead_days].sort((a, b) => b - a);
  const parts = [lead.length ? `${listES(lead)} días antes` : 'Sin antelación'];
  if (cfg.notify_on_due_day) parts.push('el mismo día');
  if (cfg.weekly_overdue) parts.push('cada semana si vence');
  const off = [!cfg.notify_itv && 'ITV', !cfg.notify_maintenance && 'mantenimiento por fecha', !cfg.notify_usage && 'mantenimiento por km'].filter(Boolean);
  if (off.length) parts.push(`sin avisos de ${listES(off)}`);
  return { summary: parts.join(' · '), warn: off.length > 0 };
}

function whenCard(cfg) {
  const save = saveButton();
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        const f = readForm(form);
        const lead = [...new Set(String(f.lead_days ?? '').split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => b - a);
        const patch = {
          lead_days: lead,
          notify_on_due_day: f.notify_on_due_day,
          weekly_overdue: f.weekly_overdue,
          notify_itv: f.notify_itv,
          notify_maintenance: f.notify_maintenance,
          notify_usage: f.notify_usage,
        };
        run(save, async () => {
          await saveSettings(patch, session.user.id);
          Object.assign(cfg, patch);
          card.set(whenSummary(cfg));
        }, 'Avisos guardados');
      },
    },
    h('p', { class: 'muted' }, 'Elige con cuántos días de margen se avisa de un vencimiento y de qué cosas. Los avisos los reciben por email todos los usuarios activos.'),
    textField('Avisar con esta antelación (días)', 'lead_days', { value: cfg.lead_days.join(', '), hint: 'Separados por comas. Por defecto: 30, 15, 7. El número mayor también pone el vencimiento en "Próximo" en el panel.' }),
    checkField('Avisar también el mismo día del vencimiento', 'notify_on_due_day', cfg.notify_on_due_day),
    checkField('Recordar cada semana mientras siga vencido', 'weekly_overdue', cfg.weekly_overdue),
    h('div', { class: 'field-label', style: 'margin-top:4px' }, 'Qué avisar'),
    checkField('ITV', 'notify_itv', cfg.notify_itv),
    checkField('Mantenimiento por fecha', 'notify_maintenance', cfg.notify_maintenance),
    checkField('Mantenimiento por km u horas', 'notify_usage', cfg.notify_usage),
    save,
  );
  const card = accordion({ group: 'top', iconName: 'clock', title: 'Cuándo y de qué avisar', ...whenSummary(cfg), content: form });
  return card;
}

// ---------------------------------------------------------------------------
// Avisos · kilómetros y horas
// ---------------------------------------------------------------------------

const usageSummary = (cfg) => ({ summary: `Avisar a menos de ${fmtNumber(cfg.default_warn_usage)} · datos desfasados tras ${plural(cfg.usage_stale_days, 'día', 'días')}`, warn: false });

function usageCard(cfg) {
  const save = saveButton();
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        const f = readForm(form);
        const patch = { default_warn_usage: toInt(f.default_warn_usage) ?? 500, usage_stale_days: Math.max(1, toInt(f.usage_stale_days) ?? 30) };
        run(save, async () => {
          await saveSettings(patch, session.user.id);
          Object.assign(cfg, patch);
          card.set(usageSummary(cfg));
        }, 'Ajustes guardados');
      },
    },
    h('p', { class: 'muted' }, 'Los avisos por kilómetros solo son fiables si alguien mantiene el contador al día.'),
    textField('Avisar cuando falten menos de… (km u horas)', 'default_warn_usage', { type: 'number', inputmode: 'numeric', min: 0, value: cfg.default_warn_usage, hint: 'Se propone al crear una regla nueva de mantenimiento; cada regla puede cambiarlo.' }),
    textField('Considerar los km desfasados tras… (días)', 'usage_stale_days', { type: 'number', inputmode: 'numeric', min: 1, value: cfg.usage_stale_days, hint: 'Si nadie actualiza los km en ese tiempo, el panel lo indica.' }),
    save,
  );
  const card = accordion({ group: 'top', iconName: 'gauge', title: 'Kilómetros y horas', ...usageSummary(cfg), content: form });
  return card;
}

// ---------------------------------------------------------------------------
// ITV · reglas por tipo de vehículo
// ---------------------------------------------------------------------------

/** 'ok' = calendario definido · 'unset' = faltan años · 'off' = no se controla la ITV de ese tipo */
const ruleState = (rule) => (rule.applies === false ? 'off' : isRuleUsable(rule) ? 'ok' : 'unset');

function itvSummary(rules) {
  const states = rules.map((r) => ({ state: ruleState(r), verified: r.verified }));
  const configured = states.filter((s) => s.state !== 'unset').length;
  const unverified = states.filter((s) => s.state === 'ok' && !s.verified).length;
  const parts = [`${configured} de ${rules.length} tipos configurados`];
  if (unverified) parts.push('a verificar con el RD 920/2017');
  return { summary: parts.join(' · '), warn: configured < rules.length || unverified > 0 };
}

const ageList = (ages) => ages.map((n) => String(n).replace('.', ',')).join(', ');

const exampleText = (rule) => {
  if (rule.applies === false) return 'No se controla la ITV de este tipo de vehículo.';
  if (!isRuleUsable(rule)) return 'Indica la primera ITV y al menos un tramo para ver el calendario.';
  return `Toca ITV a los ${ageList(itvAgeSequence(rule, 9))}… años de antigüedad.`;
};

/** Frecuencias que se pueden elegir en un tramo (la norma solo usa estas). */
const FREQUENCIES = [
  [6, 'Semestral'],
  [12, 'Anual'],
  [24, 'Bienal'],
  [36, 'Trienal'],
  [48, 'Cuatrienal'],
];

function itvCard(rules) {
  const subs = rules.map((rule) => itvRuleCard(rule, () => card.set(itvSummary(rules))));
  const card = accordion({
    group: 'top',
    iconName: 'clipboard',
    title: 'Cada cuánto toca la ITV',
    ...itvSummary(rules),
    content: [
      h('p', { class: 'muted' }, 'Según el artículo 6 del RD 920/2017, cada tipo de vehículo tiene su calendario según los años que cumple desde la matriculación. Toca un tipo para verlo o cambiarlo.'),
      ...subs.map((s) => s.el),
    ],
  });
  return card;
}

function itvRuleCard(rule, onSaved) {
  const describe = (r) => {
    const state = ruleState(r);
    if (state === 'off') return { summary: 'No se controla la ITV', warn: false, badge: null };
    if (state === 'unset') return { summary: 'Sin configurar', warn: true, badge: null };
    return {
      summary: describeItvRule(r),
      warn: false,
      badge: r.verified ? h('span', { class: 'chip ok' }, 'Verificada') : h('span', { class: 'chip soon' }, 'A verificar'),
    };
  };

  let steps = (rule.steps ?? []).map((step) => ({ ...step })); // copia editable
  const stepsHost = h('div', { class: 'stack tight' });
  const example = h('div', { class: 'example', role: 'status' });

  const currentRule = () => ({
    applies: form.elements.applies.checked,
    first_itv_years: form.elements.first_itv_years.value === '' ? null : Number(form.elements.first_itv_years.value),
    steps,
  });
  const refreshExample = () => {
    example.textContent = exampleText(currentRule());
  };

  function stepRow(step, index) {
    const from = h('input', { type: 'number', inputmode: 'numeric', min: 0, step: 1, value: step.from_years ?? '', 'aria-label': `Tramo ${index + 1}: a partir de los (años)` });
    from.addEventListener('input', () => {
      step.from_years = from.value === '' ? null : Number(from.value);
      refreshExample();
    });
    const options = FREQUENCIES.some(([months]) => months === step.every_months) ? FREQUENCIES : [...FREQUENCIES, [step.every_months, `Cada ${step.every_months} meses`]];
    const frequency = h('select', { 'aria-label': `Tramo ${index + 1}: frecuencia` }, options.map(([months, label]) => h('option', { value: months }, label)));
    frequency.value = String(step.every_months);
    frequency.addEventListener('change', () => {
      step.every_months = Number(frequency.value);
      refreshExample();
    });
    return h(
      'div',
      { class: 'step' },
      h('label', { class: 'field' }, h('span', { class: 'field-hint' }, 'A partir de los (años)'), from),
      h('label', { class: 'field' }, h('span', { class: 'field-hint' }, 'ITV'), frequency),
      iconButton('x', 'Quitar este tramo', () => {
        steps.splice(index, 1);
        renderSteps();
      }),
    );
  }
  function renderSteps() {
    stepsHost.replaceChildren(
      ...steps.map(stepRow),
      button('Añadir tramo', {
        variant: 'ghost',
        small: true,
        iconName: 'plus',
        onClick: () => {
          const last = steps.at(-1);
          steps.push({ from_years: last ? (last.from_years ?? 0) + 4 : 0, every_months: 12 });
          renderSteps();
        },
      }),
    );
    refreshExample();
  }

  const save = saveButton('Guardar');
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        const f = readForm(form);
        if (steps.some((step) => step.from_years === null || !Number.isFinite(step.from_years) || step.from_years < 0)) {
          return toast('Hay un tramo sin la antigüedad: rellénala o quita el tramo.', 'error');
        }
        const patch = {
          applies: f.applies,
          first_itv_years: toInt(f.first_itv_years),
          steps: [...steps].sort((a, b) => a.from_years - b.from_years).map(({ from_years, every_months }) => ({ from_years, every_months })),
          verified: f.verified,
          notes: f.notes,
        };
        run(save, async () => {
          await saveItvRule(rule.vehicle_type, patch);
          Object.assign(rule, patch);
          steps = patch.steps.map((step) => ({ ...step }));
          renderSteps();
          card.set(describe(rule));
          onSaved();
        }, 'Calendario de ITV guardado');
      },
    },
    checkField('Calcular la ITV de este tipo', 'applies', rule.applies),
    textField('La primera ITV toca a los (años)', 'first_itv_years', { type: 'number', inputmode: 'numeric', min: 0, value: rule.first_itv_years ?? '', hint: 'Antigüedad del vehículo, contada desde la matriculación.' }),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Después, según su antigüedad'), stepsHost, h('span', { class: 'field-hint' }, 'Cada tramo indica cada cuánto se repite la ITV a partir de esa antigüedad: semestral = cada 6 meses, anual = cada año, bienal = cada 2 años.')),
    example,
    checkField('Ya lo he comprobado con la normativa', 'verified', rule.verified),
    areaField('Notas', 'notes', { value: rule.notes ?? '' }),
    save,
  );
  form.addEventListener('change', refreshExample);
  form.addEventListener('input', refreshExample);
  renderSteps();

  const card = accordion({ group: 'itv', sub: true, title: VEHICLE_TYPES[rule.vehicle_type]?.label ?? rule.vehicle_type, ...describe(rule), content: form });
  return card;
}

// ---------------------------------------------------------------------------
// Equipo · usuarios (todos iguales: mismos permisos y todos reciben los avisos)
// ---------------------------------------------------------------------------

function usersSummary(profiles) {
  const active = profiles.filter((p) => p.active).length;
  return { summary: `${plural(active, 'usuario activo', 'usuarios activos')} · reciben los avisos`, warn: active === 0 };
}

function usersCard(profiles) {
  const subs = profiles.map((profile) => userCard(profile, () => card.set(usersSummary(profiles))));
  const card = accordion({
    group: 'top',
    iconName: 'users',
    title: 'Usuarios',
    ...usersSummary(profiles),
    content: [
      h('p', { class: 'muted' }, 'Todos los usuarios tienen los mismos permisos y todos los usuarios activos reciben los avisos por email. Si alguien deja de trabajar con la app, desactiva su cuenta.'),
      ...subs.map((s) => s.el),
      h('p', { class: 'muted', style: 'margin-top:12px' }, 'Para dar de alta a alguien nuevo, créalo en Supabase (Authentication → Users → Add user) y pásale su contraseña: podrá cambiarla en Cuenta.'),
    ],
  });
  return card;
}

function userCard(profile, onSaved) {
  const isMe = profile.id === session.user?.id;
  const describe = (p) => ({
    summary: [p.full_name ? p.email : null, p.active ? null : 'desactivado', isMe ? 'eres tú' : null].filter(Boolean).join(' · ') || 'Activo',
    warn: !p.active,
  });

  const nameField = textField('Nombre', 'full_name', { value: profile.full_name ?? '', placeholder: 'Para reconocerlo en la lista' });
  const active = isMe ? null : checkField('Cuenta activa (puede entrar en la app y recibe los avisos)', 'active', profile.active);
  // Sin <form>: se guarda con el botón.
  const save = button('Guardar', {
    block: true,
    iconName: 'check',
    onClick: () => {
      const patch = { full_name: nameField.querySelector('input').value.trim() || null };
      if (active) patch.active = active.querySelector('input').checked;
      run(save, async () => {
        await updateProfile(profile.id, patch);
        Object.assign(profile, patch);
        card.set(describe(profile));
        onSaved();
      }, 'Usuario actualizado');
    },
  });
  const content = h(
    'div',
    { class: 'stack' },
    h('p', { class: 'muted small' }, `${profile.email} · alta ${fmtDateTime(profile.created_at)}`),
    nameField,
    active,
    isMe ? h('p', { class: 'muted small' }, 'Es tu cuenta: no puedes desactivarla.') : null,
    save,
  );
  const card = accordion({ group: 'users', sub: true, title: profile.full_name || profile.email, ...describe(profile), content });
  return card;
}
