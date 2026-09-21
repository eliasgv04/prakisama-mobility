// Cuenta: datos del usuario, enlace de suscripción al calendario, cómo instalar la app y cerrar sesión.

import { calendarFeedUrl, rotateCalendarToken } from '../lib/api.js';
import { friendlyError } from '../lib/errors.js';
import { roleLabel, session, signOut } from '../lib/session.js';
import { navigate, refresh } from '../router.js';
import { button, section } from '../ui/components.js';
import { confirmDialog, h, toast } from '../ui/dom.js';

export default async function account() {
  const profile = session.profile;
  const online = !session.offline;
  const node = h('div', {});

  node.append(
    section(
      'Mi cuenta',
      h('div', { class: 'card' }, h('div', { class: 'strong' }, profile.full_name || profile.email), h('div', { class: 'muted' }, profile.full_name ? profile.email : null), h('div', { style: 'margin-top:6px' }, h('span', { class: 'chip tag' }, roleLabel(profile.role)))),
    ),
  );

  // --- Feed de calendario ---
  const url = calendarFeedUrl(profile.calendar_token);
  const webcal = url.replace(/^https?:/, 'webcal:');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Enlace copiado', 'success');
    } catch {
      toast('No se pudo copiar. Mantén pulsado el enlace para copiarlo.', 'error');
    }
  };
  node.append(
    section(
      'Calendario',
      h(
        'div',
        { class: 'card stack' },
        h('p', { class: 'muted' }, 'Suscríbete desde Google Calendar, Apple Calendar u Outlook y los vencimientos aparecerán y se actualizarán solos, con sus recordatorios.'),
        h('div', { class: 'url-box' }, url),
        h('p', { class: 'field-warn' }, 'Este enlace es personal: quien lo tenga puede ver los vencimientos de la flota. No lo compartas.'),
        h('div', { class: 'btn-row' }, button('Copiar enlace', { iconName: 'calendar', onClick: copy }), h('a', { class: 'btn ghost', href: webcal }, 'Abrir en mi calendario')),
        h(
          'details',
          {},
          h('summary', { class: 'strong', style: 'min-height:44px;display:flex;align-items:center' }, '¿Cómo lo añado?'),
          h(
            'div',
            { class: 'muted stack tight' },
            h('p', {}, 'Google Calendar (en el ordenador): Otros calendarios (+) → Desde URL → pega el enlace.'),
            h('p', {}, 'iPhone: Ajustes → Calendario → Cuentas → Añadir cuenta → Otra → Añadir calendario suscrito.'),
            h('p', {}, 'Outlook: Añadir calendario → Suscribirse desde la web → pega el enlace.'),
            h('p', {}, 'Los calendarios se refrescan solos cada cierto tiempo (Google puede tardar hasta 24 h).'),
          ),
        ),
        online
          ? button('Generar un enlace nuevo', {
              variant: 'danger',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: '¿Generar un enlace nuevo?',
                  message: 'El enlace actual dejará de funcionar y tendrás que volver a suscribirte con el nuevo.',
                  confirmText: 'Generar',
                  danger: true,
                });
                if (!ok) return;
                try {
                  profile.calendar_token = await rotateCalendarToken();
                  toast('Enlace nuevo generado', 'success');
                  refresh();
                } catch (err) {
                  toast(friendlyError(err), 'error');
                }
              },
            })
          : null,
      ),
    ),
  );

  // --- Instalación ---
  node.append(
    section(
      'Instalar la app',
      h(
        'div',
        { class: 'card' },
        h(
          'details',
          {},
          h('summary', { class: 'strong', style: 'min-height:44px;display:flex;align-items:center' }, 'Añadir a la pantalla de inicio'),
          h(
            'div',
            { class: 'muted stack tight' },
            h('p', {}, 'Android (Chrome): menú ⋮ → "Instalar aplicación" o "Añadir a pantalla de inicio".'),
            h('p', {}, 'iPhone (Safari): botón Compartir → "Añadir a pantalla de inicio". Tiene que ser Safari.'),
            h('p', {}, 'Instalada se abre a pantalla completa, como una app, y arranca más rápido.'),
          ),
        ),
      ),
    ),
  );

  node.append(h('div', { class: 'spacer' }), button('Cerrar sesión', { variant: 'ghost', block: true, onClick: async () => { await signOut(); navigate('/login', { replace: true }); } }));
  if (session.offline) node.prepend(h('div', { class: 'banner warn' }, 'Sin conexión: algunas opciones no están disponibles.'));

  return { title: 'Cuenta', tab: 'cuenta', node };
}
