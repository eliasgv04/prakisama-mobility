import './styles.css';
import { configured } from './lib/supabase.js';
import { initSession, isAdmin, onSessionChange, session } from './lib/session.js';
import { currentLocation, defineRoutes, matchRoute, navigate, refresh, startRouter } from './router.js';
import { routes } from './routes.js';
import { banner, button } from './ui/components.js';
import { h, toast } from './ui/dom.js';
import { createShell } from './ui/shell.js';

const root = document.getElementById('app');

/** Comprueba la configuración, registra el service worker, restaura la sesión y arranca el router. */
async function boot() {
  if (!configured) {
    root.replaceChildren(
      h(
        'div',
        { class: 'main' },
        banner('Falta la configuración de Supabase. Copia .env.example a .env y rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver README).', 'error'),
      ),
    );
    return;
  }

  registerServiceWorker();

  try {
    await initSession();
  } catch (err) {
    root.replaceChildren(h('div', { class: 'main' }, banner(`No se pudo iniciar la aplicación: ${err.message}`, 'error'), button('Reintentar', { onClick: () => location.reload(), block: true })));
    return;
  }

  const shell = createShell(root);
  defineRoutes(routes);
  onSessionChange(() => refresh());
  // Al recuperar la conexión estando en modo offline, se recarga para volver a tener datos frescos.
  window.addEventListener('online', () => session.offline && location.reload());

  let renderId = 0;
  startRouter(async () => {
    const mine = ++renderId;
    const { path, query } = currentLocation();

    // --- Guardas de acceso ---
    if (!session.user) return path === '/login' ? show(shell, path, query, mine) : navigate('/login', { replace: true });
    if (path === '/login') return navigate('/', { replace: true });
    if (session.needsPassword && path !== '/nueva-clave') return navigate('/nueva-clave', { replace: true });
    show(shell, path, query, mine);
  });

  async function show(shell, path, query, mine) {
    const found = matchRoute(path);
    if (!found) return navigate('/', { replace: true });
    if (found.route.admin && !isAdmin()) {
      shell.show({ title: 'Sin permiso', tab: null, node: banner('Esta pantalla es solo para administradores.', 'warn') });
      return;
    }
    shell.showLoading();
    try {
      const view = await found.route.load({ params: found.params, query });
      if (mine === renderId) shell.show(view); // si el usuario ya navegó a otra pantalla, se descarta
    } catch (err) {
      if (mine === renderId) shell.showError(err, refresh);
    }
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  // Si aparece una versión nueva mientras la app está abierta, se ofrece recargar.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // primera instalación, no es una actualización
    toast(h('span', {}, 'Hay una versión nueva. ', h('button', { class: 'linklike', style: 'color:#fff', onclick: () => location.reload() }, 'Actualizar')), 'info', 12000);
  });
}

boot();
