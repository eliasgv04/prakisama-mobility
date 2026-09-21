// Ajustes (solo administradores). Cinco tarjetas plegables agrupadas en Avisos / ITV / Equipo.
// Cerradas enseñan un resumen de cómo está cada cosa; abiertas dejan cambiarla. Solo hay una abierta
// a la vez y al guardar no se recarga la pantalla: se actualiza el resumen de la propia tarjeta.

import { VEHICLE_TYPES } from '@shared/constants.js';
import { isRuleUsable, itvAgeSequence } from '@shared/itv.js';
import { listProfiles, saveItvRule, saveSettings, updateProfile } from '../lib/api.js';
import { friendlyError } from '../lib/errors.js';
import { loadFleet } from '../lib/fleet.js';
import { fmtDateTime, fmtNumber } from '../lib/format.js';
import { roleLabel, session } from '../lib/session.js';
import { accordion, makeExclusive } from '../ui/accordion.js';
import { areaField, button, checkField, icon, readForm, section, selectField, textField, toInt } from '../ui/components.js';
import { h, toast } from '../ui/dom.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
    section('Avisos por email', recipientsCard(cfg).el, whenCard(cfg).el, usageCard(cfg).el),
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
// Avisos · quién los recibe
// ---------------------------------------------------------------------------

const recipientsSummary = (cfg) => {
  const n = cfg.recipients.length;
  return { summary: n === 0 ? 'Nadie: no se enviará ningún email' : n === 1 ? cfg.recipients[0] : `${n} personas`, warn: n === 0 };
};

function recipientsCard(cfg) {
  let draft = [...cfg.recipients];
  const chips = h('div', { class: 'chips' });
  const input = h('input', { type: 'email', placeholder: 'nombre@empresa.com', inputmode: 'email', autocapitalize: 'none', 'aria-label': 'Añadir destinatario' });

  function renderChips() {
    chips.replaceChildren(
      ...draft.map((email) =>
        h('span', { class: 'chip neutral' }, email, h('button', { type: 'button', 'aria-label': `Quitar ${email}`, onclick: () => { draft = draft.filter((r) => r !== email); renderChips(); } }, icon('x', 16))),
      ),
    );
    if (draft.length === 0) chips.append(h('span', { class: 'muted' }, 'Todavía no hay nadie.'));
  }
  function addEmail() {
    const value = input.value.trim().toLowerCase();
    if (!value) return true;
    if (!EMAIL_RE.test(value)) {
      toast('Ese email no parece válido.', 'error');
      return false;
    }
    if (!draft.includes(value)) draft.push(value);
    input.value = '';
    renderChips();
    return true;
  }
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addEmail();
    }
  });
  renderChips();

  const save = saveButton();
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        if (!addEmail()) return; // por si escribió uno y no pulsó "Añadir"
        run(save, async () => {
          await saveSettings({ recipients: draft }, session.user.id);
          cfg.recipients = [...draft];
          card.set(recipientsSummary(cfg));
        }, 'Destinatarios guardados');
      },
    },
    h('p', { class: 'muted' }, 'Reciben un único email cada mañana, y solo cuando hay algo que avisar.'),
    chips,
    h('div', { class: 'btn-row' }, input, button('Añadir', { variant: 'ghost', onClick: addEmail })),
    save,
  );
  const card = accordion({ group: 'top', iconName: 'mail', title: 'Quién recibe los avisos', ...recipientsSummary(cfg), content: form });
  return card;
}

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
    h('p', { class: 'muted' }, 'Elige con cuántos días de margen se avisa de un vencimiento y de qué cosas.'),
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

const exampleText = (rule) => {
  if (rule.applies === false) return 'No se controla la ITV de este tipo de vehículo.';
  if (!isRuleUsable(rule)) return 'Rellena la primera ITV y cada cuántos años para ver el calendario.';
  return `Toca ITV a los ${itvAgeSequence(rule, 7).join(', ')}… años de antigüedad.`;
};

function itvCard(rules) {
  const subs = rules.map((rule) => itvRuleCard(rule, () => card.set(itvSummary(rules))));
  const card = accordion({
    group: 'top',
    iconName: 'clipboard',
    title: 'Cada cuánto toca la ITV',
    ...itvSummary(rules),
    content: [h('p', { class: 'muted' }, 'Cada tipo de vehículo tiene su calendario según los años que cumple desde la matriculación. Toca un tipo para verlo o cambiarlo.'), ...subs.map((s) => s.el)],
  });
  return card;
}

function itvRuleCard(rule, onSaved) {
  const describe = (r) => {
    const state = ruleState(r);
    if (state === 'off') return { summary: 'No se controla la ITV', warn: false, badge: null };
    if (state === 'unset') return { summary: 'Sin configurar', warn: true, badge: null };
    return {
      summary: `ITV a los ${itvAgeSequence(r, 5).join(', ')}… años`,
      warn: false,
      badge: r.verified ? h('span', { class: 'chip ok' }, 'Verificada') : h('span', { class: 'chip soon' }, 'A verificar'),
    };
  };

  const example = h('div', { class: 'example', role: 'status' });
  const save = saveButton('Guardar');
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        const f = readForm(form);
        const patch = {
          applies: f.applies,
          first_itv_years: toInt(f.first_itv_years),
          interval_years: toInt(f.interval_years),
          switch_age_years: toInt(f.switch_age_years),
          late_interval_years: toInt(f.late_interval_years) ?? 1,
          verified: f.verified,
          notes: f.notes,
        };
        run(save, async () => {
          await saveItvRule(rule.vehicle_type, patch);
          Object.assign(rule, patch);
          card.set(describe(rule));
          onSaved();
        }, 'Calendario de ITV guardado');
      },
    },
    checkField('Calcular la ITV de este tipo', 'applies', rule.applies),
    h('div', { class: 'row2' }, textField('Primera ITV a los (años)', 'first_itv_years', { type: 'number', inputmode: 'numeric', min: 0, value: rule.first_itv_years ?? '' }), textField('Después, cada (años)', 'interval_years', { type: 'number', inputmode: 'numeric', min: 1, value: rule.interval_years ?? '' })),
    h('div', { class: 'row2' }, textField('Cambia de ritmo a los (años)', 'switch_age_years', { type: 'number', inputmode: 'numeric', min: 0, value: rule.switch_age_years ?? '', hint: 'Déjalo vacío si nunca cambia.' }), textField('Y desde entonces, cada (años)', 'late_interval_years', { type: 'number', inputmode: 'numeric', min: 1, value: rule.late_interval_years ?? 1 })),
    example,
    checkField('Ya lo he comprobado con el RD 920/2017', 'verified', rule.verified),
    areaField('Notas', 'notes', { value: rule.notes ?? '' }),
    save,
  );
  const refreshExample = () => {
    const f = readForm(form);
    example.textContent = exampleText({ applies: f.applies, first_itv_years: toInt(f.first_itv_years), interval_years: toInt(f.interval_years), switch_age_years: toInt(f.switch_age_years), late_interval_years: toInt(f.late_interval_years) ?? 1 });
  };
  form.addEventListener('input', refreshExample);
  form.addEventListener('change', refreshExample);
  refreshExample();

  const card = accordion({ group: 'itv', sub: true, title: VEHICLE_TYPES[rule.vehicle_type]?.label ?? rule.vehicle_type, ...describe(rule), content: form });
  return card;
}

// ---------------------------------------------------------------------------
// Equipo · usuarios y permisos
// ---------------------------------------------------------------------------

function usersSummary(profiles) {
  const admins = profiles.filter((p) => p.role === 'admin' && p.active).length;
  return { summary: `${plural(profiles.length, 'usuario', 'usuarios')} · ${plural(admins, 'administrador', 'administradores')}`, warn: false };
}

function usersCard(profiles) {
  const subs = profiles.map((profile) => userCard(profile, () => card.set(usersSummary(profiles))));
  const card = accordion({
    group: 'top',
    iconName: 'users',
    title: 'Usuarios y permisos',
    ...usersSummary(profiles),
    content: [
      h('p', { class: 'muted' }, 'Administrador: puede hacerlo todo. Encargado: consulta la flota, registra mantenimientos y actualiza los km.'),
      ...subs.map((s) => s.el),
      h('p', { class: 'muted', style: 'margin-top:12px' }, 'Para dar de alta a alguien nuevo, invítalo desde Supabase (Authentication → Users → Invite user). Al entrar por primera vez aparecerá aquí como encargado.'),
    ],
  });
  return card;
}

function userCard(profile, onSaved) {
  const isMe = profile.id === session.user?.id;
  const describe = (p) => ({
    summary: [roleLabel(p.role), p.active ? null : 'desactivado', isMe ? 'eres tú' : null].filter(Boolean).join(' · '),
    warn: !p.active,
  });

  let content;
  if (isMe) {
    content = h('p', { class: 'muted' }, `Es tu cuenta (${profile.email}). Por seguridad no puedes cambiar tu propio rol ni desactivarte.`);
  } else {
    const roleSelect = selectField('Rol', 'role', [['admin', 'Administrador'], ['encargado', 'Encargado']], { value: profile.role });
    const active = checkField('Cuenta activa (puede entrar en la app)', 'active', profile.active);
    // Sin <form>: dos campos sueltos, se guarda con el botón.
    const save = button('Guardar', {
      block: true,
      iconName: 'check',
      onClick: () => {
        const patch = { role: roleSelect.querySelector('select').value, active: active.querySelector('input').checked };
        run(save, async () => {
          await updateProfile(profile.id, patch);
          Object.assign(profile, patch);
          card.set(describe(profile));
          onSaved();
        }, 'Usuario actualizado');
      },
    });
    content = h('div', { class: 'stack' }, h('p', { class: 'muted small' }, `${profile.email} · alta ${fmtDateTime(profile.created_at)}`), roleSelect, active, save);
  }
  const card = accordion({ group: 'users', sub: true, title: profile.full_name || profile.email, ...describe(profile), content });
  return card;
}
