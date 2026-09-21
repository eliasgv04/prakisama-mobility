// Edge Function: send-reminders
//
// La llama pg_cron una vez al día (ver supabase/sql/programar_avisos.sql). Calcula los
// vencimientos de la flota, decide qué avisos tocan hoy (sin repetir los ya enviados) y manda UN
// email-resumen por destinatario a través de Resend. Después anota lo enviado en notifications_sent.
//
// Seguridad: no lleva JWT de usuario (verify_jwt = false en config.toml); exige la cabecera
// `x-cron-secret` con el valor del secreto CRON_SECRET. Usa la service_role, que solo existe aquí.
//
// Prueba sin enviar nada:  POST .../send-reminders?dry_run=1  (opcional &today=YYYY-MM-DD)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { addDays, isValidISO, todayISO } from '../_shared/dates.js';
import { renderDigest } from '../_shared/digest.js';
import { buildFleetStatus } from '../_shared/fleet.js';
import { decideReminders } from '../_shared/reminders.js';
import { fetchSnapshotWithRetry } from '../_shared/snapshot.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

/** Comparación en tiempo constante para no filtrar el secreto por diferencias de tiempo. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sendEmail(opts: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM');
  if (!apiKey || !from) return { ok: false, error: 'Faltan los secretos RESEND_API_KEY / RESEND_FROM' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Si el cron se dispara dos veces con el mismo contenido, Resend no duplica el envío.
      'Idempotency-Key': opts.idempotencyKey,
    },
    body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text }),
  });
  if (!response.ok) return { ok: false, error: `Resend ${response.status}: ${(await response.text()).slice(0, 300)}` };
  return { ok: true, error: null };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Método no permitido' }, 405);

  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-cron-secret') ?? '', secret)) return json({ error: 'No autorizado' }, 401);

  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dry_run') === '1';
    const override = url.searchParams.get('today');
    const today = dryRun && override && isValidISO(override) ? override : todayISO();
    const appUrl = Deno.env.get('APP_URL') ?? undefined;

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });

    const snapshot = await fetchSnapshotWithRetry(supabase);
    const { items, settings } = buildFleetStatus(snapshot, today);

    const recipients: string[] = [...new Set((settings.recipients as string[]).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (recipients.length === 0) return json({ ok: true, today, sent: 0, note: 'No hay destinatarios configurados en Ajustes.' });

    // Historial de envíos (1 año) de estos destinatarios, paginado por el límite de filas de la API.
    const sentRows: { item_key: string; due_ref: string; stage: string; recipient: string; sent_on: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('notifications_sent')
        .select('item_key, due_ref, stage, recipient, sent_on')
        .in('recipient', recipients)
        .gte('sent_on', addDays(today, -400))
        .range(from, from + 999);
      if (error) throw new Error(`No se pudo leer notifications_sent: ${error.message}`);
      sentRows.push(...data);
      if (data.length < 1000) break;
    }

    const results = [];
    for (const recipient of recipients) {
      const entries = decideReminders({
        items,
        settings,
        sentRows: sentRows.filter((r) => r.recipient === recipient),
        today,
      });
      if (entries.length === 0) {
        results.push({ recipient, items: 0 });
        continue;
      }

      const digest = renderDigest(entries, { today, appUrl });
      if (dryRun) {
        results.push({
          recipient,
          items: entries.length,
          subject: digest.subject,
          entries: entries.map((e: any) => ({ id: e.item.id, plate: e.item.plate, title: e.item.title, stage: e.stage })),
        });
        continue;
      }

      const contentKey = await shortHash(entries.map((e: any) => `${e.item.id}:${e.stage}`).join('|'));
      const sent = await sendEmail({ to: recipient, ...digest, idempotencyKey: `flota-${today}-${recipient}-${contentKey}` });
      if (!sent.ok) {
        // No se anota nada: mañana se reintentará.
        console.error(`Fallo enviando a ${recipient}: ${sent.error}`);
        results.push({ recipient, items: entries.length, error: sent.error });
        continue;
      }

      const rows = entries.map((e: any) => ({
        item_key: e.item.id,
        due_ref: e.dueRef,
        stage: e.stage,
        recipient,
        sent_on: today,
      }));
      const { error } = await supabase
        .from('notifications_sent')
        .upsert(rows, { onConflict: 'item_key,due_ref,stage,recipient,sent_on', ignoreDuplicates: true });
      if (error) console.error(`Enviado a ${recipient} pero no se pudo anotar: ${error.message}`);
      results.push({ recipient, items: entries.length, sent: true });
    }

    return json({ ok: true, today, dryRun, results });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Error inesperado' }, 500);
  }
});
