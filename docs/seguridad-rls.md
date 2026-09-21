# Seguridad y políticas RLS

Toda la seguridad de datos está en la base de datos (Row Level Security), no en el frontend. Aunque alguien lea la clave `anon` del navegador o modifique el JavaScript, solo puede hacer lo que las políticas permiten a su usuario.

## Principios

1. **RLS activado en las 9 tablas** y en Storage. Sin política = denegado.
2. Solo el rol `authenticated` (usuario con sesión) recibe políticas. `anon` no puede nada.
3. Dos roles de negocio, guardados en `profiles.role`:
   - **admin**: todo, incluida la configuración.
   - **encargado**: ver la flota, registrar mantenimientos/averías con adjuntos y actualizar km.
4. Ambos necesitan un perfil **activo**. Desactivar un perfil (`active = false`) corta el acceso al instante.
5. Las funciones `is_member()` e `is_admin()` son `SECURITY DEFINER` (leen `profiles` sin recursión de RLS) con `search_path` vacío. En las políticas se usan como `(select public.is_admin())` para que Postgres las evalúe una vez por consulta y no por fila.
6. Las Edge Functions usan la `service_role`, que se salta RLS. Esa clave solo existe en el servidor (secretos de Supabase), nunca en el frontend ni en git.

## Tabla de permisos

`✔` permitido · `—` denegado · `propio` = solo lo que creó ese usuario

| Tabla | Ver | Crear | Modificar | Borrar |
|---|---|---|---|---|
| `profiles` | propio · admin: todos | trigger `handle_new_user` | propio (solo nombre) · admin: todos | — |
| `vehicles` | miembros | admin | admin | **nadie** (baja lógica: `active=false`) |
| `itv_rules` | miembros | — (5 filas fijas) | admin | — |
| `itv_inspections` | miembros | admin | admin | admin |
| `maintenance_rules` | miembros | admin | admin | admin |
| `maintenance_records` | miembros | miembros (`created_by` = yo) | admin · propio | admin · propio |
| `attachments` | miembros | miembros a mantenimientos · admin a ITV | — | admin · propio |
| `notification_settings` | miembros | — (fila única id=1) | admin | — |
| `notifications_sent` | admin | solo Edge Function (service_role) | — | — |

**Por qué `notification_settings` y `itv_rules` se leen por todos los miembros:** la app calcula el semáforo en el cliente y necesita las antelaciones y las reglas de ITV. Los destinatarios de email quedan visibles para el encargado; si no se quiere, basta con mover `recipients` a una tabla solo-admin.

## Cosas que RLS no puede hacer y cómo se resuelven

RLS decide por **fila**, no por **columna**. Para esos casos hay triggers y funciones:

| Necesidad | Solución |
|---|---|
| El encargado debe actualizar los km sin poder editar el vehículo | `set_vehicle_usage(vehicle, km)` (`SECURITY DEFINER`, exige `is_member()`) |
| Un registro con km sube los km del vehículo | Trigger `sync_vehicle_usage_from_record` (solo hacia arriba: una factura antigua no "rebobina") |
| Fecha del último cambio de km | Trigger `vehicles_stamp_usage` |
| Un usuario no debe poder hacerse admin editando su propio perfil | Trigger `profiles_guard`: un no-admin solo cambia su nombre |
| No dejar el sistema sin administrador | `profiles_guard` impide desactivar/degradar al último admin activo |
| Rotar el token del calendario | `rotate_calendar_token()` (solo el propio perfil) |
| Registrar ITV favorable sustituye la fecha manual | Trigger `itv_clear_manual_date` (solo si es la inspección más reciente) |

Las funciones con `SECURITY DEFINER` tienen `EXECUTE` revocado a `public` y `anon`; solo `authenticated`.

## Storage

Dos buckets **privados**, sin URLs públicas. La app pide URLs firmadas que caducan en 1 hora.

| Bucket | Contenido | Ver | Subir | Borrar |
|---|---|---|---|---|
| `vehicle-photos` | foto del vehículo (≤ 1200 px, ≤ 5 MB) | miembros | admin | admin |
| `attachments` | facturas, tarjeta ITV (imágenes y PDF, ≤ 10 MB) | miembros | miembros | admin · quien lo subió |

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
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `.env` local y variables del hosting (públicas por diseño) | no (`.env.example` sí) |
| `SUPABASE_SERVICE_ROLE_KEY` | Inyectada por Supabase en las Edge Functions | nunca |
| `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET`, `APP_URL` | Secretos de Edge Functions (`supabase secrets set`) | no (`supabase/.env.example` sí) |

## Cómo ampliar permisos (ejemplos)

- **Que el encargado también registre ITV:** cambiar `is_admin()` por `is_member()` en las políticas `itv_inspections_insert` y en `attachments_insert` (rama `itv_inspection_id`), en una migración nueva.
- **Un tercer rol** (p. ej. "consulta", solo lectura): ampliar el `check` de `profiles.role`, y ajustar `is_member()`/las políticas de escritura.
- Toda tabla nueva debe activar RLS y traer sus políticas **en la misma migración**.
