# EmergenciaApp — Guía para agentes

## Dirección del proyecto (vigente desde 2026-11-12)

El proyecto está en **transición gradual** desde la PWA actual (Next.js + MongoDB)
hacia una arquitectura **móvil offline-first**:

- **PostgreSQL**: base de datos central en un VPS.
- **SQLite**: persistencia local en Android e iOS.
- **Offline-first**: la app debe operar sin conexión y sincronizar cuando haya conectividad.
- Estructura objetivo del repositorio:

```
EmergenciaApp/
├── .opencode/
│   └── agents/        # Definiciones de subagentes
├── docs/
│   └── database/      # Arquitectura de datos (dueño: database-architect)
├── openspec/          # Cambios y especificaciones formales
├── mobile/            # App móvil (pendiente)
├── backend/           # API / backend (pendiente)
└── README.md
```

### Estado de la transición

- El código actual (`src/`, Next.js 16, MongoDB, Auth.js) y los documentos en
  `docs/` (`architecture.md`, `mongodb-data-model.md`, `authentication.md`,
  `technical-decisions.md`, etc.) reflejan la **arquitectura anterior**. Siguen
  siendo referencia de requisitos y dominio, pero sus decisiones de
  infraestructura (MongoDB, Atlas, PWA sin app nativa) quedan **en revisión** y
  serán reemplazadas a medida que cada subagente formalice su área.
- No borrar ni reescribir masivamente lo existente: la transformación se hace por
  etapas, documentando cada cambio (OpenSpec / ADR) antes de implementarlo.
- `mobile/` y `backend/` aún no existen; se crean cuando su subagente lo proponga
  y se apruebe.

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
| 6 | CI/CD en VPS | `.opencode/agents/cicd-vps.md` | Pendiente |
| 7 | Arquitecto web (dashboard) | `.opencode/agents/web-architect.md` | Pendiente |

Los nombres de archivo de los subagentes pendientes son tentativos y se fijan al
crearlos.

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
confirmaciones), offline-first, ubicación, Bluetooth y evaluación de Baofeng y
LoRa/Meshtastic. Documenta en `docs/mobile/`.

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

### 7. web-architect (pendiente)

Implementará el dashboard web del `COORDINADOR` y el `ADMINISTRADOR` según el
diseño de ui-ux-designer, consumiendo la API de backend-architect. Candidato:
reutilizar la app Next.js actual (`src/`) como dashboard, sin acceso directo a la
base de datos.

### Reparto de responsabilidades compartidas

| Tema | Define | Implementa |
|------|--------|------------|
| Esquema SQLite, sincronización y conflictos | database-architect | mobile-architect |
| Estados de entrega de mensajes y convocatorias | database-architect | mobile-architect y backend-architect |
| Notificaciones push | mobile-architect (dispositivo), backend-architect (envío) | ambos |
| Contrato API (OpenAPI) | backend-architect, acordado con mobile-architect | ambos |
| Contrato de sincronización | database-architect (estrategia), backend + mobile (contrato) | backend-architect y mobile-architect |
| Acceso a datos / ORM (ADR) | database-architect y backend-architect | backend-architect |
| Sistema visual y flujos | ui-ux-designer | mobile-architect (app) y web-architect (dashboard) |
| Tipos de notificación, sonidos y vibración | ui-ux-designer (validado con mobile-architect) | mobile-architect; verifica mobile-tester |
| Criterios de aceptación UX/UI | ui-ux-designer | verifica mobile-tester |
| Autenticación con RUT | backend-architect | mobile-architect (sesión en el dispositivo) |
| Pruebas unitarias móviles | mobile-architect | mobile-architect |
| Pruebas del backend (unitarias, integración, contrato) | backend-architect | backend-architect |
| Pruebas visuales y funcionales en dispositivo | mobile-tester | mobile-tester |
| Docker local del backend | backend-architect | backend-architect |
| Build, firma y distribución de la app | mobile-architect (requisitos) | CI/CD en VPS |
| Despliegue, TLS, backups y secretos de producción | CI/CD en VPS | CI/CD en VPS |

### Inconsistencias abiertas

Decisiones que el usuario debe tomar antes de que los subagentes avancen:

1. **Dashboard web:** asignado a `web-architect` (pendiente de definir). Falta
   confirmar si se reutiliza la app Next.js actual.
2. **Geolocalización:** el README dice "No incluye GPS ni geolocalización", pero
   mobile-architect y database-architect contemplan ubicación y coordenadas.
3. **ORM:** la decisión previa D-13 era "sin ORM"; backend-architect propone
   Prisma como candidato. Se resuelve con un ADR conjunto.

## Convenciones generales

- Documentación en español; código e identificadores en inglés.
- Versiones de dependencias exactas.
- No versionar secretos reales.
- No afirmar que algo está implementado si solo está propuesto.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
