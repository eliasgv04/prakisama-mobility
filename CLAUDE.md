# CLAUDE.md — Prakisama Mobility

App web instalable (PWA) para Prakisama, empresa de construcción: avisa de vencimientos de ITV y mantenimientos y guarda el historial de cada vehículo. La usan personas no técnicas, casi siempre desde el móvil. **Interfaz en español, simple y rápida.**

## Comandos

```bash
npm install
npm run dev        # servidor local (http://localhost:5173), requiere .env
npm run build      # genera dist/ (incluye dist/sw.js con la lista de precaché)
npm run preview    # sirve dist/ para probar la PWA y el service worker
npm run icons      # regenera public/icons/*.png (scripts/generate-icons.mjs)
```

## Estructura

```
src/                     frontend (JS vanilla, ES modules)
  main.js                arranque: config, sesión, router, registro del service worker
  router.js              router por hash (#/vehiculos/123)
  sw.js                  plantilla del service worker (la procesa scripts/vite-plugin-sw.mjs)
  lib/                   supabase, sesión, acceso a datos, offline, imágenes, matrícula...
  ui/                    helpers DOM (h()), componentes, toasts, diálogos
  views/                 una pantalla por archivo
supabase/
  migrations/            esquema versionado (1 esquema, 2 RLS, 3 storage, 4 extensiones, 5 endurecer funciones)
  functions/_shared/     LÓGICA PURA compartida frontend + Edge Functions (fechas, ITV, mantenimiento, avisos, .ics)
  functions/send-reminders/   email diario (lo llama pg_cron)
  functions/calendar-feed/    feed .ics por usuario con token revocable
  sql/programar_avisos.sql    alta del cron (lleva secretos: se ejecuta a mano)
docs/                    documentación (RLS explicada, etc.)
```

El alias `@shared` de Vite apunta a `supabase/functions/_shared`. **Toda la lógica de negocio de fechas vive ahí** para que el panel, los emails y el calendario calculen exactamente lo mismo. Las Edge Functions solo pueden importar de su carpeta y de `_shared`, por eso está ahí y no en `src/`.

## Convenciones

- Idioma: interfaz, comentarios de negocio, commits y docs en **español**. Nombres de código (variables, columnas, códigos de estado) en inglés/ASCII.
- Commits pequeños y claros, en español. Al final de cada fase, explicar cómo probarla.
- Fechas de calendario = cadenas `YYYY-MM-DD` tratadas en UTC (`_shared/dates.js`); nunca `new Date()` local para lógica de vencimientos. "Hoy" se calcula en `Europe/Madrid`.
- Las reglas de ITV están en la tabla `itv_rules` (editable), **no** en el código.
- Baja lógica de vehículos (`active=false`); no hay política DELETE sobre `vehicles`.
- RLS en todas las tablas y en Storage. Ver `docs/seguridad-rls.md`. Al añadir una tabla: activar RLS y escribir las políticas en la misma migración.
- Ningún secreto en el frontend: solo la anon key (`.env`, fuera de git; hay `.env.example`). Resend, `CRON_SECRET` y la service role van como secretos de las Edge Functions (`supabase/.env`, fuera de git).
- Sin dependencias innecesarias. Runtime del frontend: solo `@supabase/supabase-js`.
- Nunca `innerHTML` con datos de usuario: usar `h()` (crea nodos de texto).

## Identidad visual (Prakisama Mobility)

Nombre de la app: **Prakisama Mobility** (nombre corto en el móvil: "Mobility"). Estética copiada de prakisama.com (Astro): cabecera blanca con logo a la izquierda, titulares en Big Shoulders Display, etiquetas granate en mayúsculas con rayita, botones de 6 px, tarjetas de 14 px con sombra azulada. Tokens en `src/styles.css`: `--azul #074290`, `--rojo #c62654`, fondo `#f7f8fa`, texto `#15212e`. Botón primario en **azul** (el granate se reserva para acentos: etiquetas, pestaña activa, botón "+") y semáforo con rojo propio, para que "vencido" no se confunda con un botón. Fuentes alojadas en `src/assets/fonts` (no usar Google Fonts). Logo en `src/assets/logo-prakisama.png`. El texto visible "Flota Prakisama" ya no se usa.

## Decisiones tomadas (por defecto, revisables)

- **Vanilla JS, no Preact**: ~10 pantallas de listas y formularios; unos helpers DOM bastan y no añaden dependencias ni paso de build.
- **Router por hash**: funciona en cualquier hosting estático sin configurar reescrituras y no choca con el flujo de invitación/enlace mágico de Supabase.
- **Service worker a mano** (sin Workbox): precachea la app shell; los datos no se cachean en el SW. El modo offline de solo lectura guarda la última consulta en `localStorage` (se borra al cerrar sesión).
- **Login**: email + contraseña, con enlace mágico opcional. Alta solo por invitación (registro público desactivado); el primer usuario que existe es admin.
- **Email**: Resend, un email-resumen por destinatario al día, con `Idempotency-Key`. **Hosting**: Cloudflare Pages.
- **Cálculo de ITV**: prioridad manual > última inspección (caducidad de la tarjeta) > cálculo por matriculación y `itv_rules`. Sin inspecciones registradas se asume que las anteriores se pasaron a tiempo y se marca la fecha como "estimada".
- **Encargado**: ve todo, registra mantenimientos/averías con adjuntos y actualiza km. No crea ni edita vehículos, ni reglas, ni inspecciones de ITV, ni ajustes (fácil de ampliar en `supabase/migrations/…_rls_politicas.sql`).
- **Ajustes en tarjetas plegables** (`src/ui/accordion.js`, `<details>`): cerradas muestran un resumen del estado; solo una abierta a la vez; al guardar no se recarga la pantalla, se actualiza el resumen. Usar este patrón para pantallas de configuración largas.
- **`lookupMatricula(matricula)`** (`src/lib/lookupMatricula.js`) es `async` y devuelve `null`; punto de extensión para un servicio externo futuro. No hay ninguna API inventada.
- **Sin tests unitarios**: el brief pedía Vitest, pero el usuario decidió no hacerlos (no añadirlos salvo que los pida). La lógica sigue siendo pura y aislada en `_shared/`, así que añadirlos más adelante es trivial.

## Estado por fases

- [x] Fase 1 — proyecto, esquema, Auth, RLS, CRUD de vehículos con foto, cálculo de ITV
- [x] Fase 2 — mantenimiento, averías, reglas, panel con semáforo
- [x] Fase 3 — emails programados y feed .ics
- [x] Fase 4 — PWA, README y documentación

### Proyecto Supabase real: "Prakisama Mobility" (ref `wlbqtnmwlljrpkixuaqj`, región eu-west-1)

- [x] Migraciones 1-5 aplicadas (`supabase db push`). RLS activo en las 9 tablas; buckets `vehicle-photos` y `attachments` privados.
- [x] Auth: registro público desactivado; `site_url` = `http://localhost:5173` (**cambiar a la URL de producción al desplegar**, y el secreto `APP_URL`).
- [x] Edge Functions `send-reminders` y `calendar-feed` desplegadas (`--use-api --no-verify-jwt`). Secretos puestos: `CRON_SECRET`, `APP_URL`. **Faltan `RESEND_API_KEY` y `RESEND_FROM`** (sin ellos `send-reminders` no envía; `dry_run` sí funciona).
- [x] Cron `flota-enviar-avisos` programado a las 06:00 UTC (URL y secreto en Vault). Verificada la cadena cron → pg_net → función.
- [x] Verificado contra el proyecto real con usuarios de prueba (ya borrados): 38 comprobaciones de RLS como anónimo/encargado, 14 como admin (triggers de ITV, restricciones, tramos de aviso d30/d15/d7/d0/overdue), y 21 + 11 flujos de interfaz como admin y encargado (subida de fotos y adjuntos a Storage incluida).
- [ ] Pendiente: destinatarios de avisos (Ajustes), Resend, desplegar el frontend (Cloudflare Pages) y crear más usuarios.

Notas de operación: aplicar migraciones con `SUPABASE_ACCESS_TOKEN=… npx supabase db push --linked`; redesplegar una función con `npx supabase functions deploy <nombre> --use-api --no-verify-jwt`. `.env` y `supabase/.env` (gitignorados) contienen la anon key y el `CRON_SECRET`.

- Futuro: notificaciones push (en iOS solo con la app instalada en pantalla de inicio), servicio real para `lookupMatricula`, verificar las reglas de ITV con el RD 920/2017.

---

# Brief original del proyecto

## Contexto
Prakisama es una empresa de construcción con una flota de vehículos y posiblemente maquinaria. Necesitan una aplicación web instalable en el móvil (PWA) que les avise de los vencimientos de ITV y de los mantenimientos, y que permita llevar el historial de cada vehículo. La usarán personas no técnicas, casi siempre desde el móvil. La interfaz debe estar en español y ser simple y rápida.

## Stack
- Frontend: JavaScript moderno (ES modules) con Vite. Sin frameworks pesados: vanilla JS o, si lo ves claramente mejor, Preact. Explícame la elección antes de empezar.
- Backend: Supabase (Postgres, Auth, Storage, Edge Functions, pg_cron).
- Email: Resend (o el proveedor que recomiendes con plan gratuito), llamado desde una Edge Function.
- PWA: manifest, service worker, iconos, instalable en la pantalla de inicio de Android e iOS.
- Despliegue del frontend: propón una opción gratuita (Netlify, Vercel o Cloudflare Pages).

## Funcionalidades

### 1. Vehículos
- Alta, edición y baja lógica (marcar como inactivo, no borrar) de vehículos y maquinaria.
- Campos: matrícula, tipo (turismo, furgoneta/mercancías ≤3.500 kg, camión >3.500 kg, maquinaria, otro), marca, modelo, alias opcional, fecha de primera matriculación, MMA en kg (opcional), km u horas actuales (según el tipo), foto y notas.
- La matrícula se normaliza (mayúsculas, sin espacios ni guiones) y se valida con el formato español actual (4 números + 3 letras) admitiendo también formatos antiguos. La validación debe avisar pero no bloquear.
- La fecha de matriculación se introduce a mano. Deja una función aislada `lookupMatricula(matricula)` que por defecto devuelve null, pensada para conectar más adelante un servicio externo de pago sin tocar el resto de la app. No inventes ninguna API ni endpoint.
- Foto del vehículo: subida desde la cámara o galería del móvil a Supabase Storage (bucket privado), con redimensionado y compresión en el cliente antes de subir (máx. ~1200 px).

### 2. Cálculo de la ITV
- A partir de la fecha de matriculación y el tipo de vehículo, la app calcula la fecha de la próxima ITV.
- Las reglas de periodicidad deben estar en una tabla de configuración editable (no hardcodeadas), con un tramo por tipo de vehículo: años hasta la primera ITV, periodicidad en cada tramo de antigüedad y cuándo pasa a anual. Precárgala con estas reglas orientativas y márcalas claramente como "a verificar con el RD 920/2017":
  - Turismos: primera a los 4 años, cada 2 hasta los 10 años, anual a partir de ahí.
  - Furgonetas y mercancías ≤3.500 kg: primera a los 2 años, cada 2 hasta los 6, anual después.
  - Camiones >3.500 kg y maquinaria: déjalos configurables sin asumir valores definitivos.
- La fecha calculada se puede sobrescribir a mano por vehículo (campo "próxima ITV manual"), y la app debe mostrar claramente si la fecha es calculada o manual.
- Registro de ITV pasadas: fecha de la inspección, resultado (favorable, desfavorable, negativa), fecha de caducidad que figura en la tarjeta y adjunto opcional. Al registrar una ITV favorable, la próxima fecha pasa a tomarse de ahí.

### 3. Mantenimiento y averías
- Registros por vehículo de tipo: cambio de aceite, avería, revisión, neumáticos, otro.
- Cada registro: fecha, km u horas, descripción, coste opcional, taller opcional y adjuntos opcionales (fotos de facturas).
- Reglas de mantenimiento periódico configurables por vehículo (por ejemplo, aceite cada X km o cada Y meses, lo que ocurra antes). Al registrar un cambio de aceite se calcula el siguiente.
- Botón rápido "Actualizar kilómetros" en la ficha del vehículo. Cualquier registro con km actualiza también los km actuales del vehículo.
- Los avisos por km funcionan con un umbral configurable (por ejemplo, "faltan menos de 500 km"). Ten en cuenta que dependen de que alguien mantenga los km al día, y muestra en la ficha la fecha de la última actualización de km para que se note si están desfasados.

### 4. Avisos
- Estados por cada vencimiento: OK, próximo, vencido. Panel principal con semáforo (verde, ámbar, rojo) y los vencimientos ordenados por urgencia.
- Antelaciones configurables, por defecto 30, 15 y 7 días antes y el mismo día del vencimiento, y un recordatorio semanal mientras siga vencido.
- Envío por email mediante una Edge Function programada con pg_cron (una vez al día, por la mañana). Un resumen diario por destinatario en lugar de un email por vehículo, para no saturar.
- Tabla de avisos enviados para evitar duplicados.
- Ajustes: destinatarios de los avisos, antelaciones y activar o desactivar tipos de aviso.

### 5. Calendario
- Feed de calendario en formato .ics por usuario, servido por una Edge Function y protegido con un token aleatorio revocable en la URL. Así se puede suscribir desde Google Calendar, Apple Calendar u Outlook y los vencimientos aparecen y se actualizan solos.
- Los eventos incluyen matrícula, tipo de vencimiento y recordatorios (VALARM) coherentes con las antelaciones.
- Además, un botón "Añadir al calendario" por vencimiento que descargue un .ics suelto.
- No integres la API de Google Calendar; el feed .ics es suficiente y más simple.

### 6. Usuarios y seguridad
- Supabase Auth con email y contraseña (o enlace mágico).
- Dos roles: admin (todo, incluida la configuración) y encargado (ver vehículos, registrar mantenimientos y km).
- Row Level Security activado en todas las tablas y en Storage, con políticas explícitas. Explícame las políticas que apliques.
- Ningún secreto en el frontend: solo la anon key. Las claves de Resend y la service role van como secretos de las Edge Functions y en `.env` fuera de git (incluye `.env.example`).

### 7. PWA
- Manifest, iconos, service worker con caché de la app shell y modo offline de solo lectura para la lista de vehículos consultada por última vez.
- Diseño mobile-first, botones grandes, formularios cortos, uso cómodo con una mano.
- Deja las notificaciones push como fase posterior. Ten presente que en iOS solo funcionan con la app instalada en la pantalla de inicio, y no las implementes ahora.

## Modelo de datos orientativo
Propón el esquema SQL completo con migraciones versionadas. Como base: `profiles` (rol, token de calendario), `vehicles`, `itv_rules`, `itv_inspections`, `maintenance_rules`, `maintenance_records`, `attachments`, `notification_settings`, `notifications_sent`. Justifica cualquier cambio que hagas.

## Forma de trabajar
1. Antes de escribir código, revisa este documento y hazme las preguntas que necesites (máximo 5, agrupadas). Si algo es ambiguo, propón una opción por defecto y sigue.
2. Muéstrame un plan por fases y espera mi confirmación:
   - Fase 1: proyecto, Supabase, esquema, Auth, RLS, CRUD de vehículos con foto y cálculo de ITV.
   - Fase 2: mantenimiento, averías, reglas y panel de avisos con semáforo.
   - Fase 3: emails programados y feed .ics.
   - Fase 4: PWA completa, pulido, documentación y despliegue.
3. Trabaja fase a fase, con commits pequeños y mensajes claros en español. Al terminar cada fase, dime cómo probarla.
4. ~~Pon la lógica de cálculo de fechas en funciones puras y añade tests unitarios (Vitest)~~ → **Decisión posterior del usuario: funciones puras sí, tests NO.**
5. Código claro y comentado donde haya lógica de negocio. Sin dependencias innecesarias.
6. Incluye un README con puesta en marcha local, variables de entorno, cómo desplegar las Edge Functions y cómo configurar pg_cron y el proveedor de email.

## Fuera de alcance (por ahora)
Telemetría o GPS, integración con la API de Google Calendar, consulta automática de datos por matrícula, control de costes avanzado e informes.
