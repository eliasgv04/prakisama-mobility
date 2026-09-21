-- =============================================================================
-- Programación diaria del envío de avisos (pg_cron + pg_net + Vault)
-- Ejecutar UNA vez en el SQL Editor de Supabase, DESPUÉS de desplegar la función send-reminders.
-- Sustituye los tres valores marcados con <<...>>. No subas este archivo con valores reales al repo.
-- =============================================================================

-- 1) Guardar URL y secreto en Vault (cifrados; el cron los lee desde ahí).
select vault.create_secret('https://<<REF-DEL-PROYECTO>>.supabase.co', 'project_url');
select vault.create_secret('<<MISMO-VALOR-QUE-CRON_SECRET>>',          'cron_secret');

-- 2) Programar la llamada cada día a las 06:00 UTC (= 07:00 en invierno / 08:00 en verano en España).
--    pg_cron trabaja en UTC. Cambia el "0 6 * * *" si prefieres otra hora.
select cron.schedule(
  'flota-enviar-avisos',
  '0 6 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Comprobaciones útiles:
--   select * from cron.job;                                             -- tareas programadas
--   select * from cron.job_run_details order by start_time desc limit 10;  -- últimas ejecuciones
--   select * from net._http_response order by created desc limit 5;     -- respuesta de la función
-- Para desprogramar:  select cron.unschedule('flota-enviar-avisos');
