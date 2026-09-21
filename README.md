# Prakisama Mobility

App web instalable (PWA) para controlar la **ITV** y el **mantenimiento** de la flota de Prakisama, con avisos por email, calendario suscribible y historial por vehículo. Pensada para usarse desde el móvil.

- **Frontend:** JavaScript vanilla (ES modules) + Vite. Única dependencia de runtime: `@supabase/supabase-js`.
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions, pg_cron).
- **Email:** Resend, llamado desde una Edge Function.
- **Hosting:** GitHub Pages (gratis), con publicación automática.

> Más contexto del proyecto y decisiones de diseño: [CLAUDE.md](CLAUDE.md). Políticas de seguridad: [docs/seguridad-rls.md](docs/seguridad-rls.md).

## Índice

1. [Puesta en marcha local](#1-puesta-en-marcha-local)
2. [Configurar Supabase](#2-configurar-supabase)
3. [Variables de entorno](#3-variables-de-entorno)
4. [Edge Functions](#4-edge-functions)
5. [Avisos por email (Resend + pg_cron)](#5-avisos-por-email-resend--pg_cron)
6. [Calendario](#6-calendario)
7. [Desplegar el frontend](#7-desplegar-el-frontend)
8. [Instalar la app en el móvil](#8-instalar-la-app-en-el-móvil)
9. [Cómo funciona el cálculo](#9-cómo-funciona-el-cálculo)
10. [Problemas frecuentes](#10-problemas-frecuentes)

---

## 1. Puesta en marcha local

Requisitos: Node 20+ y una cuenta de Supabase.

```bash
npm install
cp .env.example .env        # y rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev                 # http://localhost:5173
```

Otros comandos: `npm run build` (genera `dist/`), `npm run preview` (sirve `dist/`, útil para probar la PWA y el service worker), `npm run icons` (regenera los iconos).

El service worker solo se registra en el build de producción (`build` + `preview`), no en `npm run dev`.

## 2. Configurar Supabase

### 2.1 Crear el proyecto

En [supabase.com](https://supabase.com) → New project. Anota la **URL** y la clave **anon** (Project Settings → API) y la **contraseña de la base de datos**.

### 2.2 Aplicar el esquema (migraciones)

Con el CLI de Supabase (no hace falta instalarlo: `npx` lo descarga):

```bash
npx supabase login                          # abre el navegador
npx supabase link --project-ref TU_REF      # TU_REF = la parte inicial de la URL del proyecto
npx supabase db push                        # aplica supabase/migrations/* en orden
```

Las migraciones (en `supabase/migrations/`) crean, por este orden: tablas y triggers → políticas RLS → buckets y políticas de Storage → extensiones `pg_cron`/`pg_net`.

*Alternativa sin CLI:* pega el contenido de cada archivo, en orden, en el **SQL Editor** de Supabase.

### 2.3 Configurar Auth

En el panel: **Authentication**

1. **Sign In / Providers → Email:** activado. Desactiva **"Allow new users to sign up"** (acceso solo por invitación).
2. **URL Configuration:** `Site URL` = la URL de la app (p. ej. `https://flota.tudominio.com`). En `Redirect URLs` añade también `http://localhost:5173`.
3. *(Opcional, recomendado)* **Emails → plantillas:** traduce al español los correos de invitación, enlace mágico y recuperación.

### 2.4 Crear usuarios

1. **Authentication → Users → Add user** (con "Auto confirm user"). Pásale a la persona su email y una contraseña: podrá cambiarla en **Cuenta → Cambiar contraseña**.
2. **Todos los usuarios son iguales** (no hay roles): cualquiera puede hacerlo todo, y **todos los usuarios activos reciben los avisos por email**. Para dejar de dar acceso y avisos a alguien, desactiva su cuenta en **Ajustes → Usuarios**.
3. Si invitas por email, al abrir el enlace la app pide fijar una contraseña.

## 3. Variables de entorno

| Variable | Dónde | Descripción |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env` y hosting | URL del proyecto |
| `VITE_SUPABASE_ANON_KEY` | `.env` y hosting | Clave `anon` (pública; la seguridad la da RLS) |
| `RESEND_API_KEY` | secretos de Edge Functions | Clave de Resend |
| `RESEND_FROM` | secretos de Edge Functions | Remitente, p. ej. `Prakisama Mobility <avisos@tudominio.com>` |
| `CRON_SECRET` | secretos de Edge Functions **y** Vault | Secreto compartido cron ↔ función |
| `APP_URL` | secretos de Edge Functions | URL pública de la app (enlace en emails y calendario) |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase automáticamente en las funciones. **Nunca** pongas la service role ni la clave de Resend en `.env` del frontend ni en git.

## 4. Edge Functions

Hay dos, en `supabase/functions/`. Comparten la lógica de `_shared/` con el frontend.

```bash
cp supabase/.env.example supabase/.env      # rellena los 4 secretos (archivo ignorado por git)
npx supabase secrets set --env-file supabase/.env

npx supabase functions deploy send-reminders
npx supabase functions deploy calendar-feed
```

`supabase/config.toml` ya marca ambas con `verify_jwt = false` (no las llama un usuario con sesión: una la llama el cron con su secreto, y la otra los clientes de calendario con un token en la URL).

## 5. Avisos por email (Resend + pg_cron)

### 5.1 Resend

1. Crea cuenta en [resend.com](https://resend.com) (plan gratuito: 100 emails/día, 3.000/mes; sobra para un resumen diario).
2. **API Keys → Create** → cópiala en `RESEND_API_KEY`.
3. **Domains → Add domain** y añade los registros DNS (SPF/DKIM) que te indique. Con el dominio verificado, usa `RESEND_FROM="Prakisama Mobility <avisos@tudominio.com>"`.
   - *Solo para probar:* sin dominio verificado puedes usar `onboarding@resend.dev`, pero únicamente envía al email con el que te registraste en Resend.

### 5.2 Programar el envío diario (pg_cron)

Edita [supabase/sql/programar_avisos.sql](supabase/sql/programar_avisos.sql) (URL del proyecto y `CRON_SECRET`) y ejecútalo **una vez** en el SQL Editor. Programa la llamada a `send-reminders` cada día a las **06:00 UTC** (07:00 invierno / 08:00 verano en España; pg_cron trabaja en UTC). La URL y el secreto se guardan cifrados en Vault, no en el SQL del cron.

Comprobar que corre:

```sql
select * from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

### 5.3 Probar sin enviar nada

```bash
curl -X POST "https://TU_REF.supabase.co/functions/v1/send-reminders?dry_run=1" \
  -H "x-cron-secret: TU_CRON_SECRET"
```

Devuelve, por destinatario, qué avisos enviaría hoy. Con `&today=2026-10-01` simulas otra fecha (solo en `dry_run`). Sin `dry_run=1` envía de verdad.

### 5.4 Qué se envía

- **Un email-resumen por destinatario y día**, no uno por vehículo.
- Antelaciones configurables (por defecto 30, 15 y 7 días antes y el mismo día) y **recordatorio semanal mientras siga vencido**.
- Sin duplicados: cada aviso queda en `notifications_sent`. Si un día falla el envío o se da de alta un vehículo con poco margen, el aviso se manda igualmente una sola vez (no depende de acertar el día exacto).
- Todo se configura en la app: **Ajustes → Avisos por email** (tarjetas *Cuándo y de qué avisar* y *Kilómetros y horas*). **No hay lista de destinatarios**: reciben el email todos los usuarios activos.

## 6. Calendario

Cada usuario tiene un enlace personal en **Cuenta → Calendario** (`…/functions/v1/calendar-feed/<token>.ics`). Suscríbete desde Google Calendar (Otros calendarios → Desde URL), Apple Calendar u Outlook y los vencimientos aparecen y se actualizan solos, con recordatorios (VALARM) a las 9:00 en las mismas antelaciones de los avisos.

- Es una suscripción de solo lectura: Google puede tardar hasta 24 h en refrescar.
- El enlace es una credencial: no lo compartas. "Generar un enlace nuevo" invalida el anterior.
- Además, cada vencimiento tiene un botón **Añadir al calendario** que descarga un `.ics` suelto.

## 7. Desplegar el frontend

**GitHub Pages** (gratis), con publicación automática. El flujo está en [.github/workflows/deploy.yml](.github/workflows/deploy.yml): cada vez que se sube algo a `main`, GitHub compila la app y la publica en `https://USUARIO.github.io/REPOSITORIO/`.

Configuración (una sola vez, en el repositorio de GitHub):

1. **Settings → Pages → Build and deployment → Source: "GitHub Actions".**
2. **Settings → Secrets and variables → Actions → pestaña *Variables*:** crea `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. La clave anon es pública (va dentro del JavaScript); nunca pongas aquí la service role ni la de Resend.
3. Sube el código a `main` y espera a que termine la acción (pestaña *Actions*).
4. En **Supabase → Authentication → URL Configuration** pon como *Site URL* la dirección publicada (con la barra final) y añádela a *Redirect URLs*. Pon esa misma dirección en el secreto `APP_URL` (`supabase/.env` → `npx supabase secrets set --env-file supabase/.env`).

Notas:

- **Con el plan gratuito de GitHub el repositorio tiene que ser público para usar Pages; con GitHub Pro/Team puede ser privado** (este proyecto está en un repositorio privado). En cualquier caso la web publicada es pública. Publicar el código tampoco expondría nada sensible: no hay secretos en él y la seguridad la da RLS en la base de datos, no ocultar el código.
- **Publicación actual:** https://eliasgv04.github.io/prakisama-mobility/ (repositorio `eliasgv04/prakisama-mobility`). Para publicar un cambio basta con hacer `git push` a `main`.
- **Dominio propio** (p. ej. `mobility.prakisama.com`): Settings → Pages → Custom domain y un registro DNS `CNAME` hacia `USUARIO.github.io`. Después actualiza la URL en Supabase y en `APP_URL`.
- La app usa rutas por hash (`#/vehiculos`) y rutas relativas, así que funciona colgando de una subruta y en cualquier otro hosting estático sin reglas de reescritura (Cloudflare Pages, Netlify o Vercel valen igual: build `npm run build`, salida `dist`, y las dos variables de entorno).

## 8. Instalar la app en el móvil

- **Android (Chrome):** menú ⋮ → *Instalar aplicación*.
- **iPhone (Safari):** Compartir → *Añadir a pantalla de inicio*. Tiene que ser Safari.

Instalada se abre a pantalla completa y arranca más rápido. **Modo offline:** sin conexión se pueden consultar (solo lectura) el panel, la lista y las fichas de la última vez que hubo conexión; los formularios de escritura exigen conexión. Al cerrar sesión se borran esos datos del dispositivo.

Las **notificaciones push** no están implementadas (fase futura; en iOS solo funcionarían con la app instalada en la pantalla de inicio). Por ahora los avisos van por email y calendario.

## 9. Cómo funciona el cálculo

### ITV

La fecha de la próxima ITV sale de, por este orden de prioridad:

1. **Manual:** el campo "próxima ITV manual" del vehículo (se ve etiquetada como *Manual*).
2. **Última inspección registrada:** si fue favorable, la caducidad de la tarjeta (*Según tarjeta ITV*). Si fue desfavorable o negativa, se marca que hay que repetirla. Al registrar una ITV favorable se borra la fecha manual.
3. **Calculada:** desde la fecha de primera matriculación y las reglas de la tabla `itv_rules` (*Calculada*). Si no hay ninguna ITV registrada se asume que las anteriores se pasaron a tiempo y se etiqueta como *estimada*.

Las reglas de periodicidad son datos (editables en **Ajustes → Cada cuánto toca la ITV**), no código. Cada regla es la antigüedad de la primera ITV más una lista de **tramos** ("a partir de los X años, cada N meses"), que es como está redactada la norma. Valores precargados, **comprobados el 21/09/2026 en el texto consolidado del BOE** (artículo 6.1 del [RD 920/2017](https://www.boe.es/buscar/act.php?id=BOE-A-2017-12841); la tabla no ha cambiado desde 2017, la última modificación de 2024 solo afecta a los vehículos históricos, apartado 6.2):

| Tipo en la app | Categoría del RD | Primera ITV | Frecuencia según antigüedad |
|---|---|---|---|
| Turismo | M1 (hasta 8 plazas) | a los 4 años | bienal de 4 a 10 · **anual** desde los 10 |
| Furgoneta / mercancías ≤ 3.500 kg | N1 | a los 2 años | bienal de 2 a 6 · anual de 6 a 10 · **semestral** desde los 10 |
| Camión > 3.500 kg | N2 y N3 (y remolques O2, O3, O4) | **al año** (sin exención) | anual hasta los 10 · **semestral** desde los 10 |
| Maquinaria | Vehículos especiales de obras y servicios y maquinaria automotriz **con velocidad por construcción ≥ 25 km/h** | a los 4 años | bienal de 4 a 10 · anual desde los 10 |
| Otro | — | sin configurar | según el caso |

Cosas a tener en cuenta:

- **Maquinaria lenta (< 25 km/h) no pasa ITV**: en esos vehículos desmarca "Controlar la ITV" (la app lo recuerda en el formulario).
- **No cubre casos con frecuencia propia**: taxis, ambulancias, transporte escolar y autoescuelas (más exigentes), caravanas remolcadas, motos, tractores y maquinaria agrícola (exentos 4 u 8 años, bienal hasta 16 y anual después). Para esos usa el tipo "Otro" y configura sus tramos.
- **La antigüedad se cuenta desde la primera matriculación** y la frecuencia depende de la antigüedad *en la fecha de la inspección*. Esto es una estimación: en cuanto registras una ITV, manda la caducidad de la tarjeta. En el límite de un tramo (justo a los 10 años) la app aplica el tramo nuevo, que es la lectura más prudente: avisa antes.
- Una ITV pasada en los 30 días anteriores a la caducidad no pierde tiempo: la nueva validez se suma a la fecha de caducidad anterior (art. 6.5). Como la app usa la caducidad de la tarjeta, ya lo refleja.
- **Reforma europea en trámite**: la Comisión propuso en abril de 2025 revisar el paquete de ITV (Consejo y Parlamento aún negocian). Si llega a España, basta con editar los tramos en Ajustes.

### Mantenimiento

Por vehículo se definen reglas ("aceite cada 15.000 km o 12 meses, lo que ocurra antes"). El siguiente vencimiento se calcula desde el último registro de ese tipo (o desde la referencia inicial de la regla). Al guardar un cambio de aceite, la app te dice cuándo toca el siguiente. Los avisos por km/horas dependen de que alguien mantenga el contador al día: por eso la ficha muestra la fecha de la última actualización y el panel avisa de los km desfasados.

Estados: **OK**, **Próximo** (dentro de la mayor antelación configurada, o por debajo del umbral de km) y **Vencido**.

Fechas: las de calendario se tratan como días (no instantes), con recorte de fin de mes (31-ene + 1 mes = 28/29-feb) y de 29-feb (+1 año = 28-feb). Toda la lógica está en `supabase/functions/_shared/` como funciones puras.

## 10. Problemas frecuentes

| Síntoma | Causa / solución |
|---|---|
| "Falta la configuración de Supabase" | Falta `.env` (o las variables en el hosting) |
| No llegan los emails | `dry_run=1` para ver si hay avisos hoy · revisa `cron.job_run_details` y los logs de la función · Resend sin dominio verificado solo envía a tu propio email |
| El enlace del email de invitación entra pero pide login | Falta la URL de la app en Auth → URL Configuration |
| "No tienes permiso" | Tu rol no puede hacerlo (ver tabla en [docs/seguridad-rls.md](docs/seguridad-rls.md)) |
| Cambié algo y la app se ve vieja | Actualización del service worker: recarga; la app avisa cuando hay versión nueva |
| El calendario no se actualiza | Los clientes refrescan cada varias horas (Google hasta 24 h) |

## Identidad visual

La app usa la identidad de [prakisama.com](https://prakisama.com): azul `#074290`, granate `#c62654`, tipografías **Big Shoulders Display** (titulares) y **Barlow** (texto), esquinas de 6 px en botones/campos y 14 px en tarjetas, y sombras suaves azuladas. Todo está en `src/styles.css` (variables `--azul`, `--rojo`, `--font-title`…).

- **Logo:** `src/assets/logo-prakisama.png` (el de la web). Sale en la cabecera y en la pantalla de acceso.
- **Fuentes:** alojadas en `src/assets/fonts/` (licencia OFL, ver `public/OFL-fuentes.txt`): funcionan offline y no llaman a Google.
- **Iconos de la PWA** (`public/icons/*`, `public/favicon.svg`): casa granate con una "P" azul dibujada por `npm run icons` a partir de los colores de marca. Si la empresa prefiere otro icono, sustituye esos PNG (192, 512 y 512 *maskable*) y el SVG.
- **Semáforo:** verde, ámbar y rojo propios (`--ok`, `--amber`, `--overdue`); el rojo de "vencido" es distinto del granate de marca para no confundirlo con un botón.
- **Emails:** cabecera con el logo servido desde `prakisama.com/images/logo-prakisama.png`.

## Estructura

```
src/                    frontend (main, router, lib/, ui/, views/, sw.js)
supabase/migrations/    esquema versionado
supabase/functions/     send-reminders, calendar-feed y _shared/ (lógica pura común)
supabase/sql/           programar_avisos.sql (alta del cron)
docs/                   seguridad-rls.md
scripts/                generate-icons.mjs, vite-plugin-sw.mjs
```
