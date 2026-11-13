# Backend — documentación (backend-architect)

> **Estado (2026-11-13): PROPUESTA PARA APROBACIÓN.** Primera misión de
> backend-architect: diagnóstico y propuesta, **sin código de la API ni
> dependencias nuevas**. Lo implementado hasta hoy en `backend/` es solo el
> esquema Prisma, las migraciones y las pruebas de integración de la base (ver
> [`backend/README.md`](../../backend/README.md)).

## Documentos

| Documento | Contenido |
|---|---|
| [architecture.md](architecture.md) | Diagnóstico, framework HTTP, estructura de `backend/`, acceso a datos con Prisma (ADR-B1), contrato OpenAPI, errores, logs, configuración |
| [endpoints.md](endpoints.md) | Mapa de endpoints del MVP por rol, autorización y el endpoint liviano de polling del dashboard |
| [authentication.md](authentication.md) | RUT, Argon2id, tokens de acceso y renovación, cliente móvil y BFF web, contraseña provisoria, revocación, rate limiting |
| [push-delivery.md](push-delivery.md) | Envío de push desacoplado: cola en PostgreSQL, worker, recibos, re-aviso |
| [sync-contract.md](sync-contract.md) | Contrato preliminar de sincronización: envío de operaciones y descarga por cursores |
| [plan.md](plan.md) | Riesgos, plan por etapas, pruebas y decisiones que se piden al usuario |

## Resumen de la propuesta

| Tema | Propuesta |
|---|---|
| Framework HTTP | **Fastify 5** (validación por JSON Schema, serialización de respuestas, plugins oficiales de CORS, rate limit, OpenAPI) |
| Contrato | **Contrato primero**: `backend/openapi/openapi.yaml` (OpenAPI 3.1) se aprueba antes de implementar; el servidor valida entradas y salidas con esos esquemas; web y mobile generan tipos con `openapi-typescript` |
| Acceso a datos | Prisma 7 con `@prisma/adapter-pg`; SQL explícito (`$queryRaw`) solo donde el diseño lo exige: candado de versión, descarga `REPEATABLE READ READ ONLY`, cola con `SKIP LOCKED` |
| Autenticación | Token de acceso JWT de 10 min + token de renovación opaco y rotativo (hash en `auth_session`). El mismo mecanismo para móvil (`Authorization: Bearer`) y para el BFF web, que guarda los tokens en cookie `httpOnly` |
| Autorización | En cada petición se relee `app_user` (activo, `credential_version`, roles, perfil de brigadista). El token nunca es fuente de rol |
| Push | Cola = tabla `notification_delivery` (escrita en la transacción de activación). Un worker del mismo código, en proceso aparte, envía por Expo Push y procesa tickets y recibos. "Aceptado por el proveedor" nunca se muestra como "recibido" |
| Sincronización | `POST /v1/sync/push` (lote de operaciones, resultado por operación, idempotente por `operation_id`) y `POST /v1/sync/pull` (cursores por ámbito, una instantánea por descarga, `sync_epoch`) |
| Polling del dashboard | `GET /v1/emergencies/active/summary` con `ETag` derivado del máximo `row_version`: responde `304` sin cuerpo si nada cambió |

## Coordinación pendiente

| Con | Tema |
|---|---|
| mobile-architect | Contrato de sync (forma de las operaciones, reloj monotónico, tamaño de lote), registro del dispositivo y del token push, Expo Push vs. FCM/APNs directo |
| web-architect | Endpoints del dashboard, flujo del BFF (login, renovación, cierre), `ETag` del polling |
| database-architect | Revisión de las transacciones de [`sync-contract.md`](sync-contract.md) §4 , del orden de candados (incluido el login) y de la colisión de `device_seq` (§2.4) |
| devops-architect | Dos procesos (API y worker) desde una imagen, variables de entorno, healthchecks |
| ui-ux-designer | Mensajes de error visibles por código, tiempos del re-aviso (2, 5 y 10 min propuestos) |
