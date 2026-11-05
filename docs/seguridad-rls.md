# Seguridad y políticas RLS

Toda la seguridad de datos está en la base de datos (Row Level Security), no en el frontend. Aunque alguien lea la clave `anon` del navegador o modifique el JavaScript, solo puede hacer lo que las políticas permiten a su usuario. Por eso el código de la app se puede publicar sin riesgo: la protección no está en ocultarlo.

## Principios

1. **RLS activado en las 10 tablas** y en Storage. Sin política = denegado.
2. Solo el rol `authenticated` (usuario con sesión) recibe políticas. `anon` no puede nada.
3. **Todos los usuarios son iguales** (decisión de la empresa, migración 7): no hay administradores ni encargados. Cualquier usuario con la cuenta **activa** puede hacer lo mismo. Desactivar una cuenta (`active = false`) corta su acceso al instante.
4. `is_member()` es `SECURITY DEFINER` (lee `profiles` sin recursión de RLS) con `search_path` vacío. En las políticas se usa como `(select public.is_member())` para que Postgres la evalúe una vez por consulta y no por fila.
5. Las Edge Functions usan la `service_role`, que se salta RLS. Esa clave solo existe en el servidor (secretos de Supabase), nunca en el frontend ni en git.

## Tabla de permisos

`miembros` = cualquier usuario activo · `—` = denegado

| Tabla | Ver | Crear | Modificar | Borrar |
|---|---|---|---|---|
| `profiles` | miembros (sin el token) | trigger `handle_new_user` | miembros: solo nombre y `active` | — |
| `vehicles` | miembros | miembros | miembros | **nadie** (baja lógica: `active=false`) |
| `itv_rules` | miembros | — (5 filas fijas) | miembros | — |
| `itv_inspections` | miembros | miembros | miembros | miembros |
| `maintenance_rules` | miembros | miembros | miembros | miembros |
| `maintenance_records` | miembros | miembros (`created_by` = yo) | miembros | miembros |
| `attachments` | miembros | miembros (`created_by` = yo) | — | miembros |
| `insurance_history` | miembros | miembros (o `renew_insurance()`, *security invoker*) | — | miembros |
| `notification_settings` | miembros | — (fila única id=1) | miembros | — |
| `notifications_sent` | miembros | solo Edge Function (service_role) | — | — |

## Quién recibe los avisos

**Todos los usuarios activos** reciben el email-resumen diario: la Edge Function lee sus emails de `profiles` (ya no hay una lista de destinatarios aparte). Para que alguien reciba los avisos, se le da de alta como usuario; para que deje de recibirlos, se desactiva su cuenta.

## Cosas que RLS no puede hacer y cómo se resuelven

RLS decide por **fila**, no por **columna**. Para esos casos hay permisos por columna, triggers y funciones:

| Necesidad | Solución |
|---|---|
| Que nadie vea el token del calendario de otra persona (es su credencial del feed .ics) | Permisos por columna: `authenticated` solo puede leer `id, email, full_name, active, created_at, updated_at` de `profiles`. Cada uno lee **su** token con `my_calendar_token()`. Consecuencia: al consultar `profiles` hay que pedir las columnas por nombre (no vale `select *`) |
| Que nadie cambie el email, el id o el token de otra persona | Permisos por columna: solo se puede actualizar `full_name` y `active` |
| Nadie puede quedarse fuera por error | Trigger `profiles_guard`: no se puede desactivar la propia cuenta ni dejar el sistema sin ningún usuario activo |
| Un registro con km sube los km del vehículo | Trigger `sync_vehicle_usage_from_record` (solo hacia arriba: una factura antigua no "rebobina") |
| Fecha del último cambio de km | Trigger `vehicles_stamp_usage` y función `set_vehicle_usage()` |
| Rotar el token del calendario | `rotate_calendar_token()` (solo el propio perfil) |
| Registrar ITV favorable sustituye la fecha manual | Trigger `itv_clear_manual_date` (solo si es la inspección más reciente) |

Las funciones `SECURITY DEFINER` tienen `EXECUTE` revocado a `public` y `anon`: las que usa la app (`set_vehicle_usage`, `rotate_calendar_token`, `my_calendar_token`, `is_member`) solo para `authenticated`, y las de trigger para nadie (Postgres no comprueba `EXECUTE` al dispararlas).

> Verificado contra el proyecto real con usuarios de prueba (ya borrados): un anónimo no puede leer ninguna tabla ni llamar a ninguna función; un usuario puede crear, editar y borrar todo lo que toca, pero no borrar vehículos; nadie puede leer el token de otro, cambiar el email de otro ni desactivarse a sí mismo; un usuario desactivado pierde el acceso y deja de recibir avisos.

## Storage

Dos buckets **privados**, sin URLs públicas. La app pide URLs firmadas que caducan en 1 hora.

| Bucket | Contenido | Ver | Subir | Borrar |
|---|---|---|---|---|
| `vehicle-photos` | foto del vehículo (≤ 1200 px, ≤ 5 MB) | miembros | miembros | miembros |
| `attachments` | facturas, tarjeta ITV (imágenes y PDF, ≤ 10 MB) | miembros | miembros | miembros |

Los tipos MIME y el tamaño máximo se fuerzan en el propio bucket.

## Edge Functions

| Función | Protección |
|---|---|
| `send-reminders` | Sin JWT de usuario. Exige la cabecera `x-cron-secret` = secreto `CRON_SECRET` (comparación en tiempo constante). El cron guarda el secreto en Supabase Vault. |
| `calendar-feed` | Sin JWT (los clientes de calendario no pueden enviarlo). **El token de la URL es la credencial**: 64 hex aleatorios (~244 bits), por usuario, revocable. Un token desconocido, revocado o de un usuario desactivado devuelve el mismo 404. |

Trata la URL del calendario como una contraseña: quien la tenga ve los vencimientos de la flota (no edita nada). Si se filtra, "Generar un enlace nuevo" en Cuenta invalida la anterior.

## Secretos: dónde vive cada cosa

| Secreto | Dónde | En git |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `.env` local y variables del hosting (públicas por diseño: van dentro del JavaScript) | no (`.env.example` sí) |
| `SUPABASE_SERVICE_ROLE_KEY` | Inyectada por Supabase en las Edge Functions | nunca |
| `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET`, `APP_URL` | Secretos de Edge Functions (`supabase secrets set`) | no (`supabase/.env.example` sí) |

## Cómo cambiar permisos más adelante

- **Volver a tener roles** (p. ej. "solo consulta"): añadir la columna `role` a `profiles`, una función `has_role(...)` y cambiar `is_member()` por ella en las políticas de escritura, en una migración nueva.
- Toda tabla nueva debe activar RLS y traer sus políticas **en la misma migración**.
