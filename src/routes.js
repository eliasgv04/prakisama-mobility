import account from './views/account.js';
import dashboard from './views/dashboard.js';
import itvForm from './views/itvForm.js';
import login, { newPassword } from './views/login.js';
import recordForm from './views/recordForm.js';
import rulesForm from './views/rulesForm.js';
import settings from './views/settings.js';
import vehicleDetail from './views/vehicleDetail.js';
import vehicleForm from './views/vehicleForm.js';
import vehiclesList from './views/vehicles.js';

// El orden importa: "/vehiculos/nuevo" debe ir antes de "/vehiculos/:id".
export const routes = [
  { path: '/login', load: login, public: true },
  { path: '/nueva-clave', load: newPassword },
  { path: '/', load: dashboard },
  { path: '/vehiculos', load: vehiclesList },
  { path: '/vehiculos/nuevo', load: vehicleForm },
  { path: '/vehiculos/:id', load: vehicleDetail },
  { path: '/vehiculos/:id/editar', load: vehicleForm },
  { path: '/vehiculos/:id/registro/nuevo', load: recordForm },
  { path: '/vehiculos/:id/itv/nueva', load: itvForm },
  { path: '/vehiculos/:id/reglas', load: rulesForm },
  { path: '/ajustes', load: settings },
  { path: '/cuenta', load: account },
];
