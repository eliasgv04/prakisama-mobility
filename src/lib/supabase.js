import { createClient } from '@supabase/supabase-js';

// Solo la URL y la clave "anon" (pública por diseño). Todo el control de acceso lo hace RLS en
// la base de datos: aunque alguien lea esta clave en el navegador, sin sesión no puede hacer nada.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_URL = url;
export const configured = Boolean(url && anonKey);

export const supabase = configured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
