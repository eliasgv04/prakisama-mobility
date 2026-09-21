// Modo offline de solo lectura: guardamos la última consulta correcta (flota entera + perfil)
// en localStorage y, si no hay conexión, la app se muestra con esos datos.
// Se borra al cerrar sesión para no dejar datos de la empresa en un móvil ajeno.

const SNAPSHOT_KEY = 'flota.snapshot.v1';
const PROFILE_KEY = 'flota.profile.v1';

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento lleno o bloqueado: la app sigue funcionando, solo sin modo offline */
  }
}

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const saveSnapshot = (snapshot) => write(SNAPSHOT_KEY, { savedAt: new Date().toISOString(), snapshot });
/** @returns {{savedAt:string, snapshot:object}|null} */
export const readSnapshot = () => read(SNAPSHOT_KEY);

export const saveProfile = (profile) => write(PROFILE_KEY, profile);
export const readProfile = () => read(PROFILE_KEY);

export function clearOffline() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* nada */
  }
}
