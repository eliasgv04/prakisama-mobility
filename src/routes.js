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

// `admin: true` → solo administradores (la RLS de la base de datos lo exige igualmente).
// El orden importa: "/vehiculos/nuevo" debe ir antes de "/vehiculos/:id".
export const routes = [
  { path: '/login', load: login, public: true },
  { path: '/nueva-clave', load: newPassword },
  { path: '/', load: dashboard },
  { path: '/vehiculos', load: vehiclesList },
  { path: '/vehiculos/nuevo', load: vehicleForm, admin: true },
  { path: '/vehiculos/:id', load: vehicleDetail },
  { path: '/vehiculos/:id/editar', load: vehicleForm, admin: true },
  { path: '/vehiculos/:id/registro/nuevo', load: recordForm },
  { path: '/vehiculos/:id/itv/nueva', load: itvForm, admin: true },
  { path: '/vehiculos/:id/reglas', load: rulesForm, admin: true },
  { path: '/ajustes', load: settings, admin: true },
  { path: '/cuenta', load: account },
];
