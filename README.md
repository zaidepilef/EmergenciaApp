# EmergenciaApp

Plataforma para convocar a una brigada ante emergencias: el coordinador activa
una convocatoria, **todos** los brigadistas activos la reciben en el teléfono y
responden `VOY` o `NO_PUEDO`, también sin conexión.

- **App móvil** (Android e iOS, offline-first) para brigadistas.
- **API** central con PostgreSQL; la app guarda sus datos en SQLite y sincroniza.
- **Dashboard web** para coordinadores y administradores.

Requisitos del producto: [`docs/product/requirements.md`](docs/product/requirements.md).
Arquitectura, decisiones y subagentes: [`AGENTS.md`](AGENTS.md).

## Estructura

| Carpeta | Contenido | Estado |
| --- | --- | --- |
| `backend/` | API REST (Fastify + Prisma + PostgreSQL), contrato OpenAPI, migraciones y pruebas | Esquema, migraciones y primer tramo de la API |
| `mobile/` | App Expo + React Native | Demo conectada a la API |
| `web/` | Dashboard Next.js (BFF con cookie `httpOnly`) | Demo conectada a la API |
| `packages/shared/` | Código común (validación de RUT) | Listo |
| `deploy/` | Despliegue por proveedor | Pendiente |
| `docs/` | Documentación por área: `product/`, `database/`, `backend/`, `devops/` | En curso |
| `docs/archive/` | Arquitectura anterior (PWA + MongoDB), solo histórico | — |
| `openspec/` | Cambios y especificaciones formales | — |
| `.opencode/agents/` | Definición de los subagentes | — |
| `compose.yaml` | PostgreSQL local para desarrollo | — |

## Probar la demo

```bash
cd backend && npm ci && cp .env.example .env
npm run db:up && npm run db:migrate && npm run db:seed && npm run dev

cd mobile && npm install && npx expo start   # escanear el QR con Expo Go

cd web && npm ci && cp .env.example .env.local && npm run dev   # http://localhost:3001
```

Usuario de prueba: RUT `16.200.587-1`, contraseña `Brigada2026!`. Detalle en
[`backend/README.md`](backend/README.md), [`mobile/README.md`](mobile/README.md) y
[`web/README.md`](web/README.md).
