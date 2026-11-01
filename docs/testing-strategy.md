# Estrategia de pruebas

La calidad se apoya en tres niveles: reglas de negocio puras, integración con la
base de datos y flujos críticos de extremo a extremo. La Etapa 0 deja operativo el
primer nivel.

## 1. Principios

- TDD en reglas de negocio y funcionalidades críticas: primero una prueba que
  falle, luego la implementación mínima, luego refactorización.
- Las pruebas describen comportamiento observable, no detalles de
  implementación.
- Sin red ni servicios externos en pruebas unitarias.
- Fechas deterministas: usar temporizadores falsos o inyectar un reloj.
- Toda regla RN-01 a RN-10 debe tener al menos una prueba unitaria y, cuando
  dependa de la base, una prueba de integración.
- Los permisos se prueban por rol: acceso permitido y acceso denegado.

## 2. Herramientas

| Nivel       | Herramienta                           | Estado                |
| ----------- | ------------------------------------- | --------------------- |
| Unitarias   | Vitest 5 + jsdom 30 + Testing Library | Configurado           |
| Integración | Vitest + Supabase local (Docker)      | Previsto para Etapa 2 |
| E2E         | Playwright                            | Previsto para Etapa 6 |

No se instala Playwright todavía para evitar descargas de navegadores antes de
tener flujos funcionales que probar.

## 3. Organización

```text
tests/
├── setup.ts                 Configuración global (jest-dom)
├── unit/
│   ├── env.test.ts
│   └── home.test.tsx
├── integration/             Se completa en Etapa 2
└── e2e/                     Se crea en Etapa 6
```

Convenciones:

- `*.test.ts` / `*.test.tsx` para unitarias.
- `*.integration.test.ts` para integración.
- `*.spec.ts` para E2E de Playwright.
- Un archivo de prueba por módulo o regla, con nombres en español.
- Estructura `describe` → `it` y patrón arrange / act / assert.
- Datos de prueba explícitos; evitar fixtures globales innecesarios.

## 4. Qué probar por etapa

| Etapa | Foco                                                                      |
| ----- | ------------------------------------------------------------------------- |
| 0     | Configuración de entorno, render base, comandos de calidad.               |
| 1     | Componentes de UI, navegación, estados visuales y accesibilidad básica.   |
| 2     | Autenticación, roles, activación/desactivación y RLS por rol.             |
| 3     | Transiciones de disponibilidad, historial y advertencia de 4 horas.       |
| 4     | Convocatoria única activa, respuestas `VOY`/`NO_PUEDO`, cierre y conteos. |
| 5     | Registro de intentos/resultados de notificación y bandeja interna.        |
| 6     | Flujos completos, permisos, PWA en dispositivos y regresión.              |

Reglas críticas y ejemplos de casos:

- RN-03: a las 4 h se muestra advertencia y el estado no cambia.
- RN-05: una segunda activación concurrente falla en base de datos.
- RN-06: la convocatoria incluye brigadistas `NO_DISPONIBLE` y desactualizados.
- RN-07: un brigadista desactivado no recibe nuevas convocatorias.
- RN-08/RN-09: solo `VOY`/`NO_PUEDO`; `VOY` no cambia disponibilidad a
  `EN_SERVICIO`.
- RN-10: el historial conserva cada cambio con fecha y hora.

## 5. Integración

Se ejecutará contra Supabase local, nunca contra producción:

- Migraciones aplicadas con `npm run db:reset`.
- Pruebas de restricciones: convocatoria activa única, respuesta duplicada,
  claves foráneas y estados válidos.
- Pruebas de RLS con clientes autenticados por rol.
- Limpieza de datos entre pruebas o transacciones con rollback.
- Sin `service_role` en pruebas que deban validar RLS; usarla solo para
  preparar datos cuando sea imprescindible y justificado.

Criterio de aceptación de seguridad: para cada rol y operación sensible debe
existir un caso permitido y uno denegado.

## 6. Cobertura y calidad

- Objetivo: 80% de líneas y funciones en reglas de negocio de `src/features` y
  utilidades críticas de `src/lib`.
- La cobertura es una señal, no un objetivo en sí mismo; no se agregan pruebas
  vacías para subir el porcentaje.
- No se exige cobertura alta en componentes puramente visuales.
- Configuración actual: `@vitest/coverage-v8`, reportes `text` y `html`.
- Los umbrales se activarán cuando existan módulos de dominio estables.

## 7. Comandos

```bash
npm test                # unitarias
npm run test:watch      # desarrollo TDD
npm run test:coverage   # cobertura
npm run lint            # reglas estáticas
npm run typecheck       # tipos
```

La validación completa antes de una entrega es:

```bash
npm run check && npm run build
```

## 8. Fuera de alcance en Etapa 0

- Pruebas de integración reales.
- Pruebas E2E.
- Pruebas de carga o estrés.
- Pruebas de notificaciones push.
