// Ajustes (solo administradores): avisos, reglas de ITV y usuarios.

import { VEHICLE_TYPES } from '@shared/constants.js';
import { listProfiles, saveItvRule, saveSettings, updateProfile } from '../lib/api.js';
import { friendlyError } from '../lib/errors.js';
import { loadFleet } from '../lib/fleet.js';
import { fmtDateTime } from '../lib/format.js';
import { roleLabel, session } from '../lib/session.js';
import { refresh } from '../router.js';
import { areaField, button, checkField, icon, readForm, section, selectField, textField, toInt } from '../ui/components.js';
import { h, toast } from '../ui/dom.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function settings() {
  const fleet = await loadFleet({ force: true });
  if (fleet.offline) throw new Error('Necesitas conexión para cambiar los ajustes.');
  const current = fleet.status.settings;
  const profiles = await listProfiles();

  const node = h('div', {}, noticesSection(current), itvRulesSection(fleet.snapshot.itvRules), usersSection(profiles));
  return { title: 'Ajustes', tab: 'ajustes', node };
}

async function run(button_, task, okText) {
  button_.disabled = true;
  try {
    await task();
    toast(okText, 'success');
  } catch (err) {
    toast(friendlyError(err), 'error');
  } finally {
    button_.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

function noticesSection(cfg) {
  let recipients = [...cfg.recipients];
  const chips = h('div', { class: 'chips' });
  const emailInput = h('input', { type: 'email', placeholder: 'nuevo@email.com', inputmode: 'email', autocapitalize: 'none', 'aria-label': 'Añadir destinatario' });

  function renderChips() {
    chips.replaceChildren(
      ...(recipients.length ? recipients : []).map((email) =>
        h('span', { class: 'chip neutral' }, email, h('button', { type: 'button', 'aria-label': `Quitar ${email}`, onclick: () => { recipients = recipients.filter((r) => r !== email); renderChips(); } }, icon('x', 16))),
      ),
    );
    if (recipients.length === 0) chips.append(h('span', { class: 'muted' }, 'Sin destinatarios: no se enviará ningún email.'));
  }
  const addEmail = () => {
    const value = emailInput.value.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_RE.test(value)) return toast('Ese email no parece válido.', 'error');
    if (!recipients.includes(value)) recipients.push(value);
    emailInput.value = '';
    renderChips();
  };
  emailInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addEmail();
    }
  });
  renderChips();

  const save = button('Guardar avisos', { type: 'submit', block: true, iconName: 'check' });
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        addEmail(); // por si escribió uno y no pulsó "Añadir"
        const f = readForm(form);
        const lead = [...new Set(String(f.lead_days ?? '').split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => b - a);
        run(
          save,
          () =>
            saveSettings(
              {
                recipients,
                lead_days: lead,
                notify_on_due_day: f.notify_on_due_day,
                weekly_overdue: f.weekly_overdue,
                notify_itv: f.notify_itv,
                notify_maintenance: f.notify_maintenance,
                notify_usage: f.notify_usage,
                default_warn_usage: toInt(f.default_warn_usage) ?? 500,
                usage_stale_days: Math.max(1, toInt(f.usage_stale_days) ?? 30),
              },
              session.user.id,
            ).then(() => refresh()),
          'Ajustes de avisos guardados',
        );
      },
    },
    h('p', { class: 'muted' }, 'Cada mañana se envía un único email-resumen a cada destinatario con los vencimientos que toca avisar ese día.'),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Destinatarios'), chips, h('div', { class: 'btn-row' }, emailInput, button('Añadir', { variant: 'ghost', onClick: addEmail }))),
    textField('Avisar con esta antelación (días)', 'lead_days', { value: cfg.lead_days.join(', '), hint: 'Separados por comas. Por defecto: 30, 15, 7. El mayor también marca el paso a "Próximo" en el panel.' }),
    checkField('Avisar también el mismo día del vencimiento', 'notify_on_due_day', cfg.notify_on_due_day),
    checkField('Recordatorio semanal mientras siga vencido', 'weekly_overdue', cfg.weekly_overdue),
    h('div', { class: 'field-label' }, 'Tipos de aviso'),
    checkField('ITV', 'notify_itv', cfg.notify_itv),
    checkField('Mantenimiento por fecha', 'notify_maintenance', cfg.notify_maintenance),
    checkField('Mantenimiento por km / horas', 'notify_usage', cfg.notify_usage),
    h('div', { class: 'row2' }, textField('Umbral por defecto (km/h)', 'default_warn_usage', { type: 'number', inputmode: 'numeric', min: 0, value: cfg.default_warn_usage, hint: 'Para reglas nuevas: "faltan menos de…".' }), textField('Km desfasados tras (días)', 'usage_stale_days', { type: 'number', inputmode: 'numeric', min: 1, value: cfg.usage_stale_days, hint: 'Sin actualizar km durante tanto tiempo, se avisa.' })),
    save,
  );
  return section('Avisos por email', h('div', { class: 'card' }, form));
}

// ---------------------------------------------------------------------------
// Reglas de ITV (una por tipo de vehículo)
// ---------------------------------------------------------------------------

function itvRulesSection(rules) {
  const order = Object.keys(VEHICLE_TYPES);
  const sorted = [...rules].sort((a, b) => order.indexOf(a.vehicle_type) - order.indexOf(b.vehicle_type));
  return section(
    'Reglas de ITV',
    h('p', { class: 'muted', style: 'margin:0 4px 8px' }, 'Periodicidad por antigüedad del vehículo. Se calcula desde la fecha de matriculación: primera ITV, luego cada X años y, a partir de cierta antigüedad, cada Y (normalmente 1 = anual).'),
    ...sorted.map(itvRuleCard),
  );
}

function itvRuleCard(rule) {
  const save = button('Guardar', { type: 'submit', iconName: 'check' });
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        const f = readForm(form);
        run(
          save,
          () =>
            saveItvRule(rule.vehicle_type, {
              applies: f.applies,
              first_itv_years: toInt(f.first_itv_years),
              interval_years: toInt(f.interval_years),
              switch_age_years: toInt(f.switch_age_years),
              late_interval_years: toInt(f.late_interval_years) ?? 1,
              verified: f.verified,
              notes: f.notes,
            }).then(() => refresh()),
          'Regla de ITV guardada',
        );
      },
    },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, h('h3', {}, VEHICLE_TYPES[rule.vehicle_type]?.label ?? rule.vehicle_type), rule.verified ? h('span', { class: 'chip ok' }, 'Verificada') : h('span', { class: 'chip soon' }, 'A verificar con el RD 920/2017')),
    checkField('Calcular ITV para este tipo', 'applies', rule.applies),
    h('div', { class: 'row2' }, textField('Primera ITV a los (años)', 'first_itv_years', { type: 'number', inputmode: 'numeric', min: 0, value: rule.first_itv_years ?? '' }), textField('Después, cada (años)', 'interval_years', { type: 'number', inputmode: 'numeric', min: 1, value: rule.interval_years ?? '' })),
    h('div', { class: 'row2' }, textField('Pasa a otra periodicidad a los (años)', 'switch_age_years', { type: 'number', inputmode: 'numeric', min: 0, value: rule.switch_age_years ?? '', hint: 'Vacío = nunca cambia.' }), textField('Y entonces, cada (años)', 'late_interval_years', { type: 'number', inputmode: 'numeric', min: 1, value: rule.late_interval_years ?? 1 })),
    checkField('Ya la he verificado con la normativa', 'verified', rule.verified),
    areaField('Notas', 'notes', { value: rule.notes ?? '' }),
    save,
  );
  return h('div', { class: 'card' }, form);
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

function usersSection(profiles) {
  return section(
    'Usuarios',
    h('p', { class: 'muted', style: 'margin:0 4px 8px' }, 'Para dar de alta a alguien, invítalo desde Supabase → Authentication → Users → "Invite user". Al entrar por primera vez aparecerá aquí como encargado.'),
    ...profiles.map((profile) => {
      const isMe = profile.id === session.user?.id;
      const roleSelect = selectField('Rol', 'role', [['admin', 'Administrador'], ['encargado', 'Encargado']], { value: profile.role });
      const active = checkField('Cuenta activa', 'active', profile.active);
      const save = button('Guardar', { small: true, iconName: 'check' });
      save.addEventListener('click', () =>
        run(
          save,
          () =>
            updateProfile(profile.id, {
              role: roleSelect.querySelector('select').value,
              active: active.querySelector('input').checked,
            }).then(() => refresh()),
          'Usuario actualizado',
        ),
      );
      return h(
        'div',
        { class: 'card stack tight' },
        h('div', {}, h('div', { class: 'strong' }, profile.full_name || profile.email), h('div', { class: 'muted small' }, `${profile.full_name ? `${profile.email} · ` : ''}${roleLabel(profile.role)} · alta ${fmtDateTime(profile.created_at)}${isMe ? ' · eres tú' : ''}`)),
        roleSelect,
        active,
        save,
      );
    }),
  );
}
