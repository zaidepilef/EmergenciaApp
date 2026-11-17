# Decisiones técnicas

Registro de decisiones tomadas al preparar el workspace y al adoptar MongoDB
(local en Docker y Atlas en producción) y Auth.js. Cada decisión puede revisarse
si cambia el contexto.

## 1. Decisiones aplicadas

| #    | Decisión                                                                  | Alternativas                                   | Motivo                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | Node.js 24.19.0 LTS y npm 11.17.0                                         | Node 22, pnpm, yarn, bun                       | Node 24 es LTS y es la versión instalada. Solo npm está disponible en el entorno; evita instalar otro gestor sin necesidad.                                                                 |
| D-02 | Next.js 16.4.3 con App Router y Turbopack                                 | Pages Router, Next 15                          | Versión estable actual, compatible con Tailwind 4 y React 19. App Router es el estándar para server components y server actions.                                                            |
| D-03 | React 19.3.1                                                              | React 18                                       | Requerido por la línea de Next 16 y soportado por Testing Library 16.                                                                                                                       |
| D-04 | TypeScript 5.9.3                                                          | TypeScript 7.0.2                               | TS 7 es estable, pero `typescript-eslint` 8.72.1 declara peer `<6.1.0`. Se prioriza compatibilidad y estabilidad; revisar TS 7 en una etapa posterior.                                      |
| D-05 | Tailwind CSS 4.3.3 con `@tailwindcss/turbopack`                           | Tailwind 3, CSS Modules                        | Generado por create-next-app para la integración oficial con Turbopack. Evita configuración PostCSS redundante.                                                                             |
| D-06 | MongoDB local en Docker y Atlas en producción, con driver `mongodb` 7.8.0 | PostgreSQL, ORM/ODM, backend propio            | Persistencia documental con replica set local y Atlas administrado en producción. El driver oficial evita una capa de abstracción y permite controlar índices, validadores y transacciones. |
| D-07 | Versiones exactas y `package-lock.json`                                   | Rangos `^`/`~`                                 | Reproducibilidad y prevención de actualizaciones silenciosas.                                                                                                                               |
| D-08 | Vitest 5 + jsdom + Testing Library                                        | Jest                                           | Configuración más simple con TypeScript/ESM y buena integración con Vite.                                                                                                                   |
| D-09 | Sin `@vitejs/plugin-react` en pruebas                                     | Plugin React                                   | Vitest transforma TSX con esbuild en modo automático; el plugin agrega dependencias y no es necesario para las pruebas unitarias actuales.                                                  |
| D-10 | Sin Playwright en Etapa 0                                                 | Instalarlo ahora                               | Evita descargar navegadores antes de tener flujos funcionales. Se incorpora en Etapa 6.                                                                                                     |
| D-11 | PWA inicial basada en manifest y metadata                                 | Service worker desde ahora                     | La PWA necesita identidad e instalación básica; el service worker y la estrategia offline se decidirán con las notificaciones y la bandeja interna. Candidato: Serwist.                     |
| D-12 | Sin librería de componentes UI                                            | shadcn/ui, MUI, Chakra                         | La Etapa 1 definirá el sistema visual. Tailwind alcanza para el workspace y evita comprometer el diseño antes de tiempo.                                                                    |
| D-13 | Sin ORM ni ODM                                                            | Prisma, Mongoose, Drizzle                      | El driver oficial cubre el MVP sin capas adicionales. Los tipos se declaran en TypeScript y las consultas quedan explícitas.                                                                |
| D-14 | Auth.js `next-auth` 5.0.0-beta.32 con Credentials Provider                | `next-auth` 4.24.15                            | v5 es la línea compatible con Next 16 y la API que se usará. Es beta: se fija la versión y se documenta el riesgo. v4 queda como alternativa estable si aparece un bloqueo.                 |
| D-15 | `cacheComponents` y `partialPrefetching` desactivados                     | Dejarlos activos                               | Se prioriza un comportamiento predecible y sencillo hasta que existan datos dinámicos y se evalúe su beneficio.                                                                             |
| D-16 | Documentación en español, código e identificadores en inglés              | Todo en español                                | Coincide con el idioma del producto y mantiene convenciones habituales del ecosistema.                                                                                                      |
| D-17 | Contraseñas con Argon2id mediante `@node-rs/argon2` 2.2.2                 | `argon2` 0.45.1, bcrypt                        | Argon2id es el algoritmo recomendado y `@node-rs` ofrece binarios precompilados para el entorno. Evita compilación nativa y mantiene verificación en servidor.                              |
| D-18 | Sin `@auth/mongodb-adapter`                                               | Adaptador oficial de MongoDB                   | Credentials Provider con sesión JWT no requiere adaptador. Además, `@auth/mongodb-adapter` 3.11.3 declara peer `mongodb ^6`, incompatible con el driver 7.                                  |
| D-19 | Validación de RUT propia con módulo 11                                    | Librería externa                               | La regla es pequeña, estable y crítica; implementarla con TDD evita una dependencia y permite controlar normalización y errores.                                                            |
| D-20 | Variables de MongoDB y Auth.js solo en servidor                           | Prefijo `NEXT_PUBLIC_`                         | `MONGODB_URI` y `AUTH_SECRET` son secretos. El navegador nunca debe recibirlos ni conectarse directamente a MongoDB.                                                                        |
| D-21 | Migraciones con scripts Node versionados                                  | Herramienta de migración externa               | MongoDB no impone un sistema de migraciones. Scripts idempotentes con el driver, registrados en `schema_migrations`, cubren colecciones, validadores e índices sin dependencias extra.      |
| D-22 | Sesión JWT con revalidación de usuario en operaciones sensibles           | Confiar solo en el rol del token               | Credentials no admite sesión persistida. Reconsultar `users` permite aplicar desactivaciones y cambios de rol sin esperar el vencimiento del token.                                         |
| D-23 | MongoDB local con Docker como entorno primario de desarrollo              | Atlas desde el inicio, `mongodb-memory-server` | Permite desarrollar y probar transacciones sin credenciales ni red. `compose.yaml` fija MongoDB 8.2.12 y un replica set `rs0` en `127.0.0.1:27018`. Atlas queda para producción.            |

## 2. Versiones descartadas o postergadas

| Elemento                    | Versión disponible | Estado                                                                                                                                          |
| --------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase JS/SSR             | 2.118.0 / 0.12.7   | Descartado: se reemplaza por Auth.js y MongoDB (local/Atlas).                                                                                   |
| PostgreSQL administrado     | —                  | Descartado junto con Supabase; el modelo pasa a documentos.                                                                                     |
| `next-auth` 4               | 4.24.15            | Alternativa estable, no elegida porque v5 es la línea compatible con Next 16 y la API objetivo. Se reevalúa solo si la beta bloquea la Etapa 2. |
| `@auth/mongodb-adapter`     | 3.11.3             | No usado: Credentials con JWT no lo necesita y su peer es `mongodb ^6`.                                                                         |
| `mongodb` 6                 | 6.x                | No usado: el driver 7.8.0 es compatible con Node 24 y con el enfoque sin adaptador.                                                             |
| `argon2`                    | 0.45.1             | Alternativa si falla el binario precompilado de `@node-rs/argon2`; requiere compilación nativa.                                                 |
| Mongoose / Prisma / Drizzle | Estables           | Postergados: agregan una capa que el MVP no necesita.                                                                                           |
| TypeScript 7.0.2            | Estable            | Postergado por compatibilidad del ecosistema.                                                                                                   |
| ESLint 10.14.0              | Estable            | No adoptado: `eslint-plugin-import`, `eslint-plugin-jsx-a11y` y `eslint-plugin-react` todavía declaran peer `<=9`. Se usa ESLint 9.39.5.        |
| Node 26.x                   | Disponible         | No instalado en el entorno; se mantiene Node 24 LTS.                                                                                            |
| Playwright                  | Estable            | Postergado a Etapa 6.                                                                                                                           |
| Serwist / service worker    | Estable            | Postergado; la PWA queda instalable a nivel de manifest.                                                                                        |

## 3. Riesgos asumidos

- **Auth.js v5 beta:** la API puede cambiar antes de la versión estable. Mitigación:
  versión exacta, pruebas de autenticación y reevaluación antes de producción.
- **Driver 7 sin adaptador de Auth.js:** no es un problema para Credentials + JWT,
  pero impide usar el adaptador oficial mientras mantenga el peer `mongodb ^6`.
- **Migraciones propias:** requieren disciplina de idempotencia, orden y registro.
  Mitigación: scripts pequeños, revisión, pruebas en base limpia y respaldo antes
  de cambios destructivos.
- **Transacciones:** requieren replica set. `compose.yaml` inicia `rs0` localmente
  y Atlas lo provee en producción; una instancia standalone no sirve para probar
  activaciones concurrentes.
- **Datos locales:** `npm run db:reset` elimina el volumen de MongoDB. Es
  destructivo y solo debe usarse en desarrollo.

## 4. Auditoría de dependencias

Resultado de `npm audit` al actualizar la arquitectura:

- Dependencias de producción: **0 vulnerabilidades**.
- Dependencias de desarrollo: 17 avisos moderados por `minimatch < 11.0.1` en la
  cadena de ESLint. El riesgo es local (procesa archivos del propio repositorio) y
  no afecta al runtime.
- No existe corrección compatible: `npm audit fix --force` propone bajar a ESLint
  4, lo que rompería la configuración actual. Se monitorea y se actualizará cuando
  el ecosistema lo resuelva.

## 5. Decisiones pendientes

| Tema            | Qué falta definir                                               | Etapa sugerida       |
| --------------- | --------------------------------------------------------------- | -------------------- |
| Atlas           | Región, cluster, respaldos y allowlist de red.                  | Antes del despliegue |
| Modelo de datos | Validar colecciones, campos e índices definitivos.              | Antes de Etapa 2     |
| Auth            | Duración de sesión, política de contraseñas y alta de usuarios. | Etapa 2              |
| RUT             | Enmascaramiento por pantalla y retención en logs.               | Etapa 2              |
| Rate limiting   | Mecanismo y umbrales para login.                                | Etapa 2              |
| Auditoría       | Eventos obligatorios y tiempo de retención.                     | Etapa 2              |
| Zona horaria    | Zona de la brigada para presentar fechas (se guarda en UTC).    | Antes de Etapa 3     |
| Push            | Proveedor (FCM u otro) y estados de notificación.               | Etapa 5              |
| Service worker  | Serwist u otra estrategia y alcance offline.                    | Etapa 5/6            |
| Auth.js v5      | Reevaluar versión estable antes de producción.                  | Pre-producción       |
| TypeScript 7    | Reevaluar compatibilidad.                                       | Etapa posterior      |
| Node 26         | Reevaluar cuando sea LTS y el entorno lo adopte.                | Etapa posterior      |
| Capacitor       | Momento de empaquetado Android/iOS.                             | Post-MVP             |
