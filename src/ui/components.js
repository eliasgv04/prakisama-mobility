// Componentes de interfaz reutilizables (funciones que devuelven nodos DOM).

import { STATUS_LABELS } from '@shared/constants.js';
import logoUrl from '../assets/logo-prakisama.png';
import { h } from './dom.js';

// ---------- Iconos (SVG en línea, trazo) ----------
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  truck: '<path d="M2 6h12v10H2z"/><path d="M14 9h4l4 4v3h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-3 3-2.5-.5-.5-2.5z"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5S15.5 16.5 15.5 20"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17.5 14.5c2.5 0 4 1.5 4 4"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h6"/>',
};

export function icon(name, size) {
  const span = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  span.setAttribute('viewBox', '0 0 24 24');
  span.setAttribute('class', 'icon');
  span.setAttribute('aria-hidden', 'true');
  if (size) {
    span.setAttribute('width', size);
    span.setAttribute('height', size);
  }
  span.innerHTML = ICONS[name] ?? ''; // contenido estático propio, nunca datos de usuario
  return span;
}

// ---------- Estados ----------
export const statusChip = (status) => h('span', { class: `chip ${status}` }, STATUS_LABELS[status] ?? status);

// ---------- Botones ----------
export function button(label, { onClick, variant = '', type = 'button', iconName, block = false, small = false, disabled = false } = {}) {
  return h(
    'button',
    { class: ['btn', variant, block ? 'block' : '', small ? 'small' : ''].filter(Boolean).join(' '), type, onclick: onClick, disabled },
    iconName ? icon(iconName) : null,
    label,
  );
}

export function iconButton(iconName, label, onClick) {
  return h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onclick: onClick }, icon(iconName));
}

/** Deshabilita el botón mientras dura la tarea: evita dobles envíos. */
export async function withBusy(btn, task) {
  btn.disabled = true;
  try {
    return await task();
  } finally {
    btn.disabled = false;
  }
}

// ---------- Campos de formulario ----------
function wrapField(label, control, { hint, warn } = {}) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null,
    warn ?? null,
  );
}

export function textField(label, name, { value = '', type = 'text', required = false, hint, placeholder, ...rest } = {}) {
  const input = h('input', { type, name, value: value ?? '', required, placeholder, ...rest });
  return wrapField(label, input, { hint });
}

export function areaField(label, name, { value = '', hint, placeholder } = {}) {
  return wrapField(label, h('textarea', { name, placeholder }, value ?? ''), { hint });
}

export function selectField(label, name, options, { value = '', required = false, hint, onChange } = {}) {
  const select = h(
    'select',
    { name, required, onchange: onChange },
    options.map(([optValue, optLabel]) => h('option', { value: optValue }, optLabel)),
  );
  select.value = value ?? ''; // después de crear las opciones
  return wrapField(label, select, { hint });
}

export function checkField(label, name, checked = false) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked }), label);
}

/** Botones tipo "segmentado" (una opción entre pocas), más cómodos que un desplegable en el móvil. */
export function segmented(name, options, value) {
  return h(
    'div',
    { class: 'seg', role: 'radiogroup' },
    options.map(([optValue, optLabel]) =>
      h('label', {}, h('input', { type: 'radio', name, value: optValue, checked: optValue === value }), h('span', {}, optLabel)),
    ),
  );
}

/** Logo grande + nombre de la app, para las pantallas sin barras (acceso). */
export const brandHeader = (title, lead) => [
  h('img', { class: 'logo', src: logoUrl, alt: 'Prakisama, S.L. Construcciones', width: 300, height: 108 }),
  h('div', { class: 'eyebrow' }, 'Gestión de flota y maquinaria'),
  h('h1', {}, title),
  lead ? h('p', { class: 'lead' }, lead) : null,
];

export const section = (title, ...content) => h('section', { class: 'section' }, h('div', { class: 'section-title' }, title), ...content);

export const empty = (text, ...extra) => h('div', { class: 'empty' }, h('p', {}, text), ...extra);

export const spinner = () => h('div', { class: 'spinner', role: 'status', 'aria-label': 'Cargando' });

export const banner = (text, kind = 'info') => h('div', { class: `banner ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);

/** Lee un <form> como objeto plano (checkbox → booleano, vacío → null). */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else if (el.type === 'file') continue;
    else out[el.name] = el.value.trim() === '' ? null : el.value.trim();
  }
  return out;
}

export const toInt = (value) => (value === null || value === undefined || value === '' ? null : Math.round(Number(value)));
export const toNum = (value) => (value === null || value === undefined || value === '' ? null : Number(value));
