// Edge Function: calendar-feed
//
// Feed de calendario (.ics) para suscribirse desde Google Calendar, Apple Calendar u Outlook.
// URL:  https://<proyecto>.supabase.co/functions/v1/calendar-feed/<TOKEN>.ics
//
// El token es el `calendar_token` de profiles: aleatorio (64 hex) y revocable (el usuario lo
// regenera desde la app y el enlace anterior deja de funcionar). La función no lleva JWT
// (verify_jwt = false) porque los clientes de calendario no pueden enviarlo; el token ES la
// credencial, así que hay que tratar la URL como una contraseña.
// Usa la service_role (solo existe en el servidor) para leer los datos sin sesión de usuario.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { todayISO } from '../_shared/dates.js';
import { buildFleetStatus } from '../_shared/fleet.js';
import { buildCalendar, itemsToEventLines } from '../_shared/ics.js';
import { fetchSnapshotWithRetry } from '../_shared/snapshot.js';

const plain = (message: string, status: number) =>
  new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain('Método no permitido', 405);

  // Token en la ruta (/calendar-feed/<token>.ics) o, alternativamente, en ?token=
  const url = new URL(req.url);
  const lastSegment = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const raw = url.searchParams.get('token') ?? (lastSegment === 'calendar-feed' ? '' : lastSegment);
  const token = raw.replace(/\.ics$/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) return plain('Enlace no válido', 404);

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });

    const { data: profile, error } = await supabase.from('profiles').select('id, active').eq('calendar_token', token).maybeSingle();
    if (error) throw new Error(error.message);
    // Mismo mensaje si no existe o está desactivado: no se filtra qué tokens hubo.
    if (!profile || !profile.active) return plain('Enlace no válido o revocado', 404);

    const today = todayISO();
    const snapshot = await fetchSnapshotWithRetry(supabase);
    const { items, settings } = buildFleetStatus(snapshot, today);

    const body = buildCalendar({
      name: 'Prakisama Mobility · Vencimientos',
      eventLines: itemsToEventLines(items, {
        today,
        leadDays: settings.lead_days,
        notifyOnDueDay: settings.notify_on_due_day,
        appUrl: Deno.env.get('APP_URL') ?? undefined,
      }),
    });

    return new Response(req.method === 'HEAD' ? null : body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="flota-prakisama.ics"',
        // La URL contiene una credencial: que no se guarde en cachés compartidas.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error(err);
    return plain('Error generando el calendario', 500);
  }
});
