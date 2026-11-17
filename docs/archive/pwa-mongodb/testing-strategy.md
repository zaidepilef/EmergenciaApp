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
- Las pruebas usan datos ficticios; nunca datos personales reales.

## 2. Herramientas

| Nivel       | Herramienta                                          | Estado                |
| ----------- | ---------------------------------------------------- | --------------------- |
| Unitarias   | Vitest 5 + jsdom 30 + Testing Library                | Configurado           |
| Integración | Vitest + MongoDB local en Docker (replica set `rs0`) | Previsto para Etapa 2 |
| E2E         | Playwright                                           | Previsto para Etapa 6 |

No se instala Playwright todavía para evitar descargas de navegadores antes de
tener flujos funcionales que probar.

La base de integración será el contenedor local definido en `compose.yaml`, que
ya incluye un replica set para probar transacciones. `mongodb-memory-server` queda
como alternativa para CI si se necesita aislamiento sin Docker.

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

| Etapa | Foco                                                                          |
| ----- | ----------------------------------------------------------------------------- |
| 0     | Configuración de entorno, render base, comandos de calidad.                   |
| 1     | Componentes de UI, navegación, estados visuales y accesibilidad básica.       |
| 2     | RUT, Argon2id, login, sesión, roles, activación/desactivación y autorización. |
| 3     | Transiciones de disponibilidad, historial y advertencia de 4 horas.           |
| 4     | Convocatoria única activa, respuestas `VOY`/`NO_PUEDO`, cierre y conteos.     |
| 5     | Registro de intentos/resultados de notificación y bandeja interna.            |
| 6     | Flujos completos, permisos, PWA en dispositivos y regresión.                  |

Reglas críticas y ejemplos de casos:

- RN-03: a las 4 h se muestra advertencia y el estado no cambia.
- RN-05: una segunda activación concurrente falla por el índice único parcial.
- RN-06: la convocatoria incluye brigadistas `NO_DISPONIBLE` y desactualizados.
- RN-07: un brigadista desactivado no recibe nuevas convocatorias.
- RN-08/RN-09: solo `VOY`/`NO_PUEDO`; `VOY` no cambia disponibilidad a
  `EN_SERVICIO`.
- RN-10: el historial conserva cada cambio con fecha y hora.

## 5. Autenticación y autorización

Unitarias obligatorias antes de implementar el login:

- Normalización y validación de RUT con módulo 11.
- Hash y verificación de contraseña con Argon2id.
- `authorize`: usuario activo, inactivo, inexistente y contraseña incorrecta.
- Mensaje genérico y ausencia de datos sensibles en token y sesión.
- Helpers de autorización por rol y usuario inactivo.

Integración:

- Login contra una base de prueba con usuarios ficticios.
- Índice único de RUT canónico.
- Una desactivación o cambio de rol afecta operaciones sensibles sin esperar el
  vencimiento del token.
- Flags de la cookie de sesión.
- Matriz de permisos: cada rol y operación sensible con un caso permitido y uno
  denegado.
- Los errores de login no revelan si el RUT existe.

El diseño detallado está en `docs/authentication.md`.

## 6. Integración con MongoDB

Se ejecutará contra MongoDB local en Docker (`127.0.0.1:27018`), nunca contra
producción:

- Base de pruebas separada de la de desarrollo; recrearla con `npm run db:reset`
  antes de una suite que requiera estado limpio.
- Migraciones aplicadas sobre una base limpia.
- Pruebas de índices: RUT único, respuesta única y convocatoria activa única.
- Pruebas de validadores: roles, estados y respuestas inválidas.
- Pruebas de transacciones: activación de convocatoria y creación de
  notificaciones como una sola operación.
- Pruebas de destinatarios: excluir usuarios inactivos.
- Limpieza de datos entre pruebas o uso de una base descartable.

La autorización se prueba en los helpers de servidor y en las server actions. No
debe existir acceso directo del navegador a MongoDB.
Para cada operación sensible se verifica que el servidor rechace al rol incorrecto
aunque la interfaz oculte el botón.

Criterio de aceptación de seguridad: para cada rol y operación sensible debe
existir un caso permitido y uno denegado.

## 7. Cobertura y calidad

- Objetivo: 80% de líneas y funciones en reglas de negocio de `src/features` y
  utilidades críticas de `src/lib`.
- La cobertura es una señal, no un objetivo en sí mismo; no se agregan pruebas
  vacías para subir el porcentaje.
- No se exige cobertura alta en componentes puramente visuales.
- Configuración actual: `@vitest/coverage-v8`, reportes `text` y `html`.
- Los umbrales se activarán cuando existan módulos de dominio estables.

## 8. Comandos

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

## 9. Fuera de alcance en Etapa 0

- Pruebas de integración reales.
- Pruebas E2E.
- Pruebas de carga o estrés.
- Pruebas de notificaciones push.
