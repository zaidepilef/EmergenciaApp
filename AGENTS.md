# EmergenciaApp — Guía para agentes

## Dirección del proyecto (vigente desde 2026-11-12)

El proyecto pasó de una PWA (Next.js + MongoDB, retirada el 2026-11-16) a una
arquitectura **móvil offline-first**:

- **PostgreSQL**: base de datos central en un VPS.
- **SQLite**: persistencia local en Android e iOS.
- **Offline-first**: la app debe operar sin conexión y sincronizar cuando haya conectividad.
- Estructura objetivo del repositorio:

```
EmergenciaApp/
├── .opencode/
│   └── agents/        # Definiciones de subagentes
├── docs/
│   ├── product/       # Requisitos del producto (dominio)
│   ├── database/      # Arquitectura de datos (dueño: database-architect)
│   ├── backend/ devops/ …  # Una carpeta por área
│   └── archive/       # Arquitectura anterior, solo histórico
├── openspec/          # Cambios y especificaciones formales
├── mobile/            # App móvil (demo conectada a la API)
├── backend/           # API (esquema, migraciones y primer tramo de la API)
├── web/               # Dashboard Next.js (demo conectada a la API)
├── packages/shared/   # Validación de RUT compartida
├── compose.yaml       # PostgreSQL local de desarrollo
├── deploy/            # Compose de producción, proxy y deploy/<proveedor>/ (pendiente)
├── .github/workflows/ # Pipelines de CI/CD (pendiente)
└── README.md
```

### Decisiones de infraestructura (2026-11-13)

| Tema | Decisión |
|---|---|
| Principio | Agnóstico del proveedor: contenedores + Docker Compose + variables de entorno; lo específico de cada proveedor en `deploy/<proveedor>/` |
| Destino de referencia | VPS de Hostinger para backend, web y PostgreSQL |
| GitHub Pages | Solo contenido estático (documentación o landing). No sirve para API, base de datos ni dashboard |
| CI | GitHub Actions por área; imágenes en GHCR |
| Producción | Solo con aprobación manual del usuario; backup antes de migrar; rollback por etiqueta de imagen |

### Decisiones del dashboard web (2026-11-13)

| Tema | Decisión |
|---|---|
| Ubicación | `web/`, proyecto Next.js nuevo (el esqueleto anterior en `src/` se eliminó el 2026-11-16) |
| Autenticación | BFF: Next.js llama a la API y guarda el token en cookie `httpOnly`; el navegador no ve el token. Sin `next-auth`, `mongodb` ni `@node-rs/argon2` en el proyecto web |
| Respuestas en vivo | Polling cada 10–15 s (sin SSE ni WebSockets en el MVP) |
| Tipos y RUT | Tipos generados desde OpenAPI (`openapi-typescript`); validación de RUT en `packages/shared/`, común a backend, web y mobile |
| Pruebas web | Las hace web-architect: Vitest + Testing Library + Playwright |
| Conectividad | El dashboard requiere conexión; offline-first es solo para la app móvil |
| Dependencia | web-architect trabaja sobre el contrato OpenAPI aprobado, sin mocks previos |

### Estado de la transición

- 2026-11-16, por decisión del usuario: se eliminó el código de la PWA anterior
  (`src/`, `public/`, `tests/` y su configuración en la raíz: Next.js, Auth.js,
  MongoDB, ESLint, Vitest, Prettier) y el servicio `mongo` de `compose.yaml`.
  Queda en el historial de git.
- Los documentos de la arquitectura anterior están en `docs/archive/pwa-mongodb/`
  (solo histórico). Los requisitos de dominio vigentes están en
  `docs/product/requirements.md`.
- Lo que falta para el MVP, por área y con su dueño, está en
  `docs/product/backlog.md` (corte 2026-11-17). Se actualiza al cerrar cada tramo.
- Cada área vive en su carpeta y tiene su propio `package.json`; la raíz no es
  un proyecto Node.
- La transformación sigue por etapas, documentando cada cambio (OpenSpec / ADR)
  antes de implementarlo.
- `backend/` tiene el esquema, las migraciones y un primer tramo de la API;
  `mobile/` y `web/` son demos conectadas a ella (2026-11-16). El dashboard
  aún no usa tipos generados desde OpenAPI ni tiene pruebas Vitest/Playwright. La arquitectura móvil
  definitiva sigue a cargo de mobile-architect.

## Subagentes

Cada subagente se define en `.opencode/agents/<nombre>.md`, tiene un alcance
exclusivo y no modifica áreas de otros. El agente principal coordina, aprueba
avances entre fases y deriva necesidades cruzadas al subagente correspondiente.

Orden de incorporación:

| # | Subagente | Archivo | Estado |
|---|-----------|---------|--------|
| 1 | Arquitecto de base de datos | `.opencode/agents/database-architect.md` | Definido |
| 2 | Arquitecto / desarrollador mobile | `.opencode/agents/mobile-architect.md` | Definido |
| 3 | Diseño UX/UI | `.opencode/agents/ui-ux-designer.md` | Definido |
| 4 | Arquitecto / desarrollador backend | `.opencode/agents/backend-architect.md` | Definido |
| 5 | Tester móvil WYSIWYG | `.opencode/agents/mobile-tester.md` | Definido |
| 6 | DevOps / CI-CD (agnóstico; VPS Hostinger de referencia) | `.opencode/agents/devops-architect.md` | Definido |
| 7 | Arquitecto web (dashboard) | `.opencode/agents/web-architect.md` | Definido |

Todos los subagentes previstos están definidos. Cualquier subagente nuevo se
agrega a esta tabla y al reparto de responsabilidades.

### 1. database-architect

Responsable exclusivo de la capa de datos: modelado conceptual, lógico y físico,
PostgreSQL y SQLite, sincronización offline, conflictos, seguridad y retención de
datos. Documenta en `docs/database/`. No escribe código de aplicación, endpoints
ni UI.

Primera misión: diagnóstico y modelo conceptual + lógico preliminar. **No** crea
tablas definitivas ni migraciones hasta que el agente principal lo apruebe.

### 2. mobile-architect

Experto en la app móvil Android/iOS (Expo + React Native) en `mobile/`:
notificaciones push del lado del dispositivo (permisos, token, canales, recepción,
confirmaciones), offline-first, Bluetooth y evaluación de Baofeng y
LoRa/Meshtastic. Documenta en `docs/mobile/`. La geolocalización queda fuera del MVP.

Implementa el esquema SQLite y la sincronización **que define database-architect**;
consume la API que define backend-architect; implementa el diseño que define ui-ux-designer.
No diseña esquemas, endpoints, envío de push desde servidor ni pipelines.

Primera misión: diagnóstico y arquitectura móvil propuesta, sin código ni
dependencias, hasta aprobación.

### 3. ui-ux-designer

Diseña flujos, pantallas, sistema visual y accesibilidad de la app móvil
(`BRIGADISTA`) y del dashboard web (`COORDINADOR`, `ADMINISTRADOR`), además de los
tipos de notificación, sonidos y patrones de vibración. Diseña para guantes, sol,
ruido y sin conexión (contraste ≥ 4.5:1, objetivos táctiles ≥ 48 dp, estados
nunca solo por color). Documenta en `docs/ux/`. No escribe código de producción.

Primera misión: inventario de pantallas por rol, flujo crítico "recibir
convocatoria → entenderla → responder" y propuesta de notificaciones, sin diseño
visual detallado hasta aprobación.

### 4. backend-architect

API REST en `backend/` (Node.js + TypeScript + PostgreSQL): autenticación con RUT,
roles, brigadistas, disponibilidad, convocatorias, respuestas, **envío** de push
y endpoint de sincronización idempotente. Contrato en OpenAPI; documenta en
`docs/backend/`. Dueño de las pruebas unitarias, de integración y de contrato del
backend. Implementa el modelo que define database-architect; no despliega.

Primera misión: diagnóstico y propuesta (framework, endpoints, auth móvil, push,
contrato de sync, ADR de acceso a datos), sin código hasta aprobación.

### 5. mobile-tester

Tester WYSIWYG: ejecuta la app en emuladores y dispositivos reales (Windows,
Linux y macOS) y verifica lo que el usuario ve y hace: pantallas, convocatorias,
push, modo sin conexión. Entrega informes con evidencia y veredicto. No modifica
código de producción; reporta los hallazgos al área responsable.

### 6. devops-architect

CI/CD, despliegue y operación, **agnóstico de la infraestructura**: imágenes de
contenedor, Docker Compose y variables de entorno, con lo específico de cada
proveedor aislado en `deploy/<proveedor>/`. Destino actual: VPS de Hostinger;
GitHub Pages solo para contenido estático. Se encarga de pipelines (GitHub
Actions), proxy con TLS, hardening del servidor, backups probados, secretos (solo
nombres en docs), monitoreo y builds móviles con EAS. Documenta en
`docs/devops/`. Nunca despliega a producción ni genera costos sin aprobación.

Primera misión: arquitectura de despliegue, matriz de plataformas, CI/CD,
backups, distribución móvil, secretos y costos, sin crear infraestructura.

### 7. web-architect

Dashboard Next.js en `web/` para `COORDINADOR` (brigadistas, convocatorias,
panel) y `ADMINISTRADOR` (usuarios, roles, configuración). Consume solo la API
mediante un BFF con cookie `httpOnly`; sin base de datos ni ORM. Muestra
respuestas `VOY` / `NO_PUEDO` / pendiente y distingue entrega de respuesta.
Dueño de sus pruebas (Vitest + Playwright). Documenta en `docs/web/`.

Primera misión: estructura del proyecto `web/` (desde cero), rutas por rol, diseño del BFF,
tipos OpenAPI, polling y plan de pruebas, sin código hasta aprobación.

### Reparto de responsabilidades compartidas

| Tema | Define | Implementa |
|------|--------|------------|
| Esquema SQLite, sincronización y conflictos | database-architect | mobile-architect |
| Estados de entrega de mensajes y convocatorias | database-architect | mobile-architect y backend-architect |
| Notificaciones push | mobile-architect (dispositivo), backend-architect (envío) | ambos |
| Contrato API (OpenAPI) | backend-architect, acordado con mobile-architect y web-architect | los tres |
| Tipos generados desde OpenAPI | backend-architect (contrato) | web-architect y mobile-architect |
| Paquete compartido de RUT (`packages/shared/`) | backend-architect | backend, web y mobile lo consumen |
| Sesión web (BFF, cookie `httpOnly`) | web-architect | web-architect |
| Pruebas del dashboard (Vitest, Playwright) | web-architect | web-architect |
| Contrato de sincronización | database-architect (estrategia), backend + mobile (contrato) | backend-architect y mobile-architect |
| Modelo físico PostgreSQL y `schema.prisma` | database-architect (diseña y revisa) | backend-architect (Prisma) |
| Sistema visual y flujos | ui-ux-designer | mobile-architect (app) y web-architect (dashboard) |
| Tipos de notificación, sonidos y vibración | ui-ux-designer (validado con mobile-architect) | mobile-architect; verifica mobile-tester |
| Criterios de aceptación UX/UI | ui-ux-designer | verifica mobile-tester |
| Autenticación con RUT | backend-architect | mobile-architect (sesión en el dispositivo) |
| Pruebas unitarias móviles | mobile-architect | mobile-architect |
| Pruebas del backend (unitarias, integración, contrato) | backend-architect | backend-architect |
| Pruebas visuales y funcionales en dispositivo | mobile-tester | mobile-tester |
| Docker local del backend | backend-architect | backend-architect |
| Build, firma y distribución de la app | mobile-architect (requisitos) | devops-architect |
| Despliegue, TLS, backups y secretos de producción | devops-architect | devops-architect |

### Decisiones de alcance (2026-11-13)

| Tema | Decisión |
|---|---|
| Geolocalización | **Fuera del MVP** (coincide con el README). Sin permisos, librerías ni tablas de ubicación; la arquitectura no debe impedir agregarla después |
| ORM | **Prisma** en el backend, solo para PostgreSQL. Reemplaza la decisión previa D-13 ("sin ORM"). database-architect diseña y revisa; backend-architect escribe `schema.prisma` y migraciones con Prisma Migrate. SQLite móvil usa `expo-sqlite`, sin Prisma |
| Disponibilidad declarada (2026-11-16) | **Entra al MVP** por decisión del usuario; revierte la exclusión del 2026-11-13. Sigue siendo informativa: no filtra la convocatoria (RN-06). Propuesta en `openspec/changes/add-availability/`, aprobada el 2026-11-17: conflictos de 60 s o menos se resuelven solos, sin declaración por el coordinador y sin push de recordatorio |

### Inconsistencias abiertas

- `docs/database/synchronization/strategy.md` §4 ordena la disponibilidad por
  `declared_at` (reloj del teléfono) y las respuestas por `responded_at`; la regla
  vigente es la de `conflict-resolution.md` (`estimated_at` + ventana de 60 s).
  Corrige database-architect (tarea 1.2 de `add-availability`).

## Convenciones generales

- Documentación en español; código e identificadores en inglés.
- Versiones de dependencias exactas.
- No versionar secretos reales.
- No afirmar que algo está implementado si solo está propuesto.
