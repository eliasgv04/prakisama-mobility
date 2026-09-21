// Sesión, perfil y rol del usuario actual.

import { friendlyError, isNetworkError } from './errors.js';
import { clearOffline, readProfile, saveProfile } from './offline.js';
import { supabase } from './supabase.js';

/** Estado observable de la sesión (objeto único y mutable). */
export const session = {
  user: null,
  profile: null,
  /** true si estamos usando datos guardados porque no hay conexión */
  offline: false,
  /** true tras abrir un enlace de invitación o de recuperación: hay que fijar contraseña */
  needsPassword: false,
  /** motivo por el que se ha cerrado la sesión automáticamente */
  blocked: null,
};

const listeners = new Set();
export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn(session));

export const isAdmin = () => session.profile?.role === 'admin';
export const roleLabel = (role) => (role === 'admin' ? 'Administrador' : 'Encargado');

async function fetchProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Aplica un usuario autenticado: carga su perfil y bloquea cuentas sin perfil o desactivadas. */
async function applyUser(user) {
  let profile;
  try {
    profile = await fetchProfile(user.id);
  } catch (err) {
    const cached = readProfile();
    if (isNetworkError(err) && cached?.id === user.id) {
      Object.assign(session, { user, profile: cached, offline: true });
      return;
    }
    throw err;
  }
  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    clearOffline();
    Object.assign(session, { user: null, profile: null, offline: false, blocked: 'Tu cuenta no está activa. Habla con un administrador.' });
    return;
  }
  saveProfile(profile);
  Object.assign(session, { user, profile, offline: false, blocked: null });
}

export async function initSession() {
  // supabase-js consume y borra el hash del enlace de invitación/recuperación: anotamos el tipo antes.
  const linkType = new URLSearchParams(location.hash.replace(/^#/, '')).get('type');

  const { data } = await supabase.auth.getSession();
  if (data?.session) {
    await applyUser(data.session.user);
    session.needsPassword = Boolean(session.user) && (linkType === 'invite' || linkType === 'recovery');
  } else if (!navigator.onLine) {
    // Sin conexión y sin sesión en memoria: usamos el perfil guardado para poder consultar lo último.
    const cached = readProfile();
    if (cached) Object.assign(session, { user: { id: cached.id, email: cached.email }, profile: cached, offline: true });
  }

  supabase.auth.onAuthStateChange((event, next) => {
    // Importante: no llamar a supabase de forma síncrona dentro de este callback (bloqueo interno).
    setTimeout(async () => {
      if (event === 'SIGNED_OUT') {
        Object.assign(session, { user: null, profile: null, offline: false, needsPassword: false });
        emit();
      } else if (event === 'PASSWORD_RECOVERY') {
        if (next?.user && session.user?.id !== next.user.id) await applyUser(next.user);
        session.needsPassword = true;
        emit();
      } else if (event === 'SIGNED_IN' && next?.user && session.user?.id !== next.user.id) {
        await applyUser(next.user);
        emit();
      }
    }, 0);
  });
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyError(error));
  await applyUser(data.user);
  emit();
}

const redirectUrl = () => location.origin + location.pathname;

export async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectUrl() },
  });
  if (error) throw new Error(friendlyError(error));
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
  if (error) throw new Error(friendlyError(error));
}

export async function setPassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(friendlyError(error));
  session.needsPassword = false;
  emit();
}

export async function signOut() {
  await supabase.auth.signOut().catch(() => {});
  clearOffline();
  Object.assign(session, { user: null, profile: null, offline: false, needsPassword: false });
  emit();
}
