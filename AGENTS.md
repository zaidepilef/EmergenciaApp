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
| 2 | Desarrollador mobile | `.opencode/agents/mobile-developer.md` | Pendiente |
| 3 | Diseño UX/UI | `.opencode/agents/ux-ui-designer.md` | Pendiente |
| 4 | API / backend | `.opencode/agents/backend-developer.md` | Pendiente |
| 5 | Tester / QA | `.opencode/agents/tester.md` | Pendiente |
| 6 | CI/CD en VPS | `.opencode/agents/cicd-vps.md` | Pendiente |

Los nombres de archivo de los subagentes pendientes son tentativos y se fijan al
crearlos.

### 1. database-architect

Responsable exclusivo de la capa de datos: modelado conceptual, lógico y físico,
PostgreSQL y SQLite, sincronización offline, conflictos, seguridad y retención de
datos. Documenta en `docs/database/`. No escribe código de aplicación, endpoints
ni UI.

Primera misión: diagnóstico y modelo conceptual + lógico preliminar. **No** crea
tablas definitivas ni migraciones hasta que el agente principal lo apruebe.

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
