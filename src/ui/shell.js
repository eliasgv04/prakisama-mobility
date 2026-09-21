// Estructura común de pantalla: barra superior, contenido y barra de pestañas inferior.

import { session } from '../lib/session.js';
import { navigate } from '../router.js';
import { fmtDateTime } from '../lib/format.js';
import { banner, button, icon, iconButton, spinner } from './components.js';
import { clear, h } from './dom.js';

const TABS = [
  { id: 'panel', path: '/', label: 'Panel', icon: 'home' },
  { id: 'vehiculos', path: '/vehiculos', label: 'Vehículos', icon: 'truck' },
  { id: 'ajustes', path: '/ajustes', label: 'Ajustes', icon: 'sliders', admin: true },
  { id: 'cuenta', path: '/cuenta', label: 'Cuenta', icon: 'user' },
];

/**
 * Una "vista" es { title, node, back?, actions?, tab?, offline?, cachedAt?, bare? }.
 * `back` es la ruta a la que vuelve la flecha; `bare` oculta barras (pantalla de acceso).
 */
export function createShell(root) {
  const titleEl = h('h1');
  const backSlot = h('div');
  const actionsSlot = h('div', { style: 'display:flex' });
  const topbar = h('header', { class: 'topbar' }, backSlot, titleEl, actionsSlot);
  const main = h('main', { class: 'main', id: 'main' });
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Navegación principal' });
  const shell = h('div', { class: 'shell' }, topbar, main, tabbar);
  root.replaceChildren(shell);

  function renderTabs(active) {
    clear(tabbar);
    for (const tab of TABS) {
      if (tab.admin && session.profile?.role !== 'admin') continue;
      tabbar.append(h('a', { href: `#${tab.path}`, 'aria-current': tab.id === active ? 'page' : null }, icon(tab.icon), tab.label));
    }
  }

  return {
    showLoading() {
      main.replaceChildren(spinner());
    },

    showError(err, retry) {
      main.replaceChildren(
        banner(err?.message || 'Ha ocurrido un error inesperado.', 'error'),
        retry ? button('Reintentar', { onClick: retry, block: true }) : null,
      );
    },

    show(view) {
      const bare = Boolean(view.bare);
      shell.classList.toggle('bare', bare);
      topbar.hidden = bare;
      tabbar.hidden = bare;

      titleEl.textContent = view.title ?? 'Flota Prakisama';
      document.title = view.title ? `${view.title} · Flota Prakisama` : 'Flota Prakisama';
      clear(backSlot);
      if (view.back) backSlot.append(iconButton('back', 'Volver', () => navigate(view.back)));
      clear(actionsSlot);
      for (const action of view.actions ?? []) actionsSlot.append(action);
      renderTabs(view.tab);

      clear(main);
      if (view.offline) {
        const when = view.cachedAt ? ` Datos de ${fmtDateTime(view.cachedAt)}.` : '';
        main.append(banner(`Sin conexión: modo solo lectura.${when}`, 'warn'));
      }
      main.append(view.node);
      window.scrollTo(0, 0);
    },
  };
}
