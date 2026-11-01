# Decisiones técnicas — Etapa 0

Registro de decisiones tomadas al preparar el workspace. Cada decisión puede
revisarse si cambia el contexto.

## 1. Decisiones aplicadas

| #    | Decisión                                                            | Alternativas                  | Motivo                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | Node.js 24.19.0 LTS y npm 11.17.0                                   | Node 22, pnpm, yarn, bun      | Node 24 es LTS y es la versión instalada. Solo npm está disponible en el entorno; evita instalar otro gestor sin necesidad.                                             |
| D-02 | Next.js 16.4.3 con App Router y Turbopack                           | Pages Router, Next 15         | Versión estable actual, compatible con Tailwind 4 y React 19. App Router es el estándar para server components y server actions.                                        |
| D-03 | React 19.3.1                                                        | React 18                      | Requerido por la línea de Next 16 y soportado por Testing Library 16.                                                                                                   |
| D-04 | TypeScript 5.9.3                                                    | TypeScript 7.0.2              | TS 7 es estable, pero `typescript-eslint` 8.72.1 declara peer `<6.1.0`. Se prioriza compatibilidad y estabilidad; revisar TS 7 en una etapa posterior.                  |
| D-05 | Tailwind CSS 4.3.3 con `@tailwindcss/turbopack`                     | Tailwind 3, CSS Modules       | Generado por create-next-app para la integración oficial con Turbopack. Evita configuración PostCSS redundante.                                                         |
| D-06 | Supabase (`@supabase/supabase-js` 2.118.0 + `@supabase/ssr` 0.12.7) | ORM, backend propio           | Decisión del MVP: Auth, PostgreSQL y RLS integrados. `@supabase/ssr` es el camino soportado para sesiones con cookies en Next.                                          |
| D-07 | Versiones exactas y `package-lock.json`                             | Rangos `^`/`~`                | Reproducibilidad y prevención de actualizaciones silenciosas.                                                                                                           |
| D-08 | Vitest 5 + jsdom + Testing Library                                  | Jest                          | Configuración más simple con TypeScript/ESM y buena integración con Vite.                                                                                               |
| D-09 | Sin `@vitejs/plugin-react` en pruebas                               | Plugin React                  | Vitest transforma TSX con esbuild en modo automático; el plugin agrega dependencias y no es necesario para las pruebas unitarias actuales.                              |
| D-10 | Sin Playwright en Etapa 0                                           | Instalarlo ahora              | Evita descargar navegadores antes de tener flujos funcionales. Se incorpora en Etapa 6.                                                                                 |
| D-11 | PWA inicial basada en manifest y metadata                           | Service worker desde ahora    | La PWA necesita identidad e instalación básica; el service worker y la estrategia offline se decidirán con las notificaciones y la bandeja interna. Candidato: Serwist. |
| D-12 | Sin librería de componentes UI                                      | shadcn/ui, MUI, Chakra        | La Etapa 1 definirá el sistema visual. Tailwind alcanza para el workspace y evita comprometer el diseño antes de tiempo.                                                |
| D-13 | Sin librería de estado global ni ORM                                | Redux/Zustand, Prisma/Drizzle | Server Components, server actions y el SDK de Supabase cubren el MVP sin capas adicionales.                                                                             |
| D-14 | Supabase CLI 2.122.0 como devDependency                             | Instalación global            | Versión reproducible por proyecto y scripts `npm run db:*` sin depender de la máquina.                                                                                  |
| D-15 | `cacheComponents` y `partialPrefetching` desactivados               | Dejarlos activos              | Se prioriza un comportamiento predecible y sencillo hasta que existan datos dinámicos y se evalúe su beneficio.                                                         |
| D-16 | Documentación en español, código e identificadores en inglés        | Todo en español               | Coincide con el idioma del producto y mantiene convenciones habituales del ecosistema.                                                                                  |

## 2. Versiones descartadas o postergadas

| Elemento                 | Versión disponible | Estado                                                                                                                                                                          |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript 7.0.2         | Estable            | Postergado por compatibilidad del ecosistema.                                                                                                                                   |
| ESLint 10.14.0           | Estable            | No adoptado: `eslint-plugin-import`, `eslint-plugin-jsx-a11y` y `eslint-plugin-react` (dependencias de `eslint-config-next`) todavía declaran peer `<=9`. Se usa ESLint 9.39.5. |
| React 19.3.1             | Estable            | Adoptado.                                                                                                                                                                       |
| Node 26.x                | Disponible         | No instalado en el entorno; se mantiene Node 24 LTS.                                                                                                                            |
| Playwright               | Estable            | Postergado a Etapa 6.                                                                                                                                                           |
| Serwist / service worker | Estable            | Postergado; la PWA queda instalable a nivel de manifest.                                                                                                                        |

## 3. Auditoría de dependencias

Resultado de `npm audit` al preparar el workspace:

- Dependencias de producción: **0 vulnerabilidades**.
- Dependencias de desarrollo: 17 avisos moderados por `minimatch < 11.0.1` en la
  cadena de ESLint. El riesgo es local (procesa archivos del propio
  repositorio) y no afecta al runtime.
- No existe corrección compatible: `npm audit fix --force` propone bajar a
  ESLint 4, lo que rompería la configuración actual. Se monitorea y se
  actualizará cuando el ecosistema lo resuelva.

## 4. Decisiones pendientes

| Tema            | Qué falta definir                                            | Etapa sugerida   |
| --------------- | ------------------------------------------------------------ | ---------------- |
| Zona horaria    | Zona de la brigada para presentar fechas (se guarda en UTC). | Antes de Etapa 3 |
| Modelo de datos | Claves, relaciones, estados y reglas de cierre.              | Antes de Etapa 2 |
| RLS             | Funciones auxiliares de rol y políticas definitivas.         | Etapa 2          |
| Auth            | Mecanismo de alta y contraseña provisoria.                   | Etapa 2          |
| Push            | Proveedor (FCM u otro) y estados de notificación.            | Etapa 5          |
| Service worker  | Serwist u otra estrategia y alcance offline.                 | Etapa 5/6        |
| TypeScript 7    | Reevaluar compatibilidad.                                    | Etapa posterior  |
| Node 26         | Reevaluar cuando sea LTS y el entorno lo adopte.             | Etapa posterior  |
| Capacitor       | Momento de empaquetado Android/iOS.                          | Post-MVP         |
