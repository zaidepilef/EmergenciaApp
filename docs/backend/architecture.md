# Arquitectura del backend

> **PROPUESTA PARA APROBACIÓN.** Nada de esto está implementado. Las versiones
> son las publicadas en npm el 2026-11-13; se fijan exactas al instalar.

## 1. Diagnóstico

| Área | Estado actual | Consecuencia |
|---|---|---|
| `backend/` | `schema.prisma`, 2 migraciones, 51 pruebas de integración de la base (propiedad P, invariantes, permisos del rol de la app) | El modelo físico está implementado y verificado; falta toda la API |
| Roles de PostgreSQL | `deploy/postgres/roles.sql`: migrador y aplicación separados | La API debe funcionar **sin** `DELETE` (salvo `user_role`) ni `UPDATE` en append-only: toda corrección es un evento nuevo |
| Código anterior (`src/`, eliminado el 2026-11-16) | Next.js 16 + Auth.js + MongoDB | Sirve de referencia de reglas (RUT, Argon2id, revalidación de sesión en `docs/archive/pwa-mongodb/authentication.md`), no de código: cambia el motor y el mecanismo de sesión |
| `packages/shared/` | No existe | Se crea en la etapa 1 con la validación de RUT (dueño: backend-architect) |
| Contrato OpenAPI | No existe | Bloquea a web-architect y mobile-architect: es lo primero que se entrega tras aprobar esta propuesta |
| Node.js | `engines >= 24`; el equipo local tiene 22.18 | Las pruebas de la base corren en 22.12+; para la API se exige 24 LTS (`.nvmrc`) |

Restricciones del modelo que condicionan la API:

1. Toda transacción que escribe en una tabla replicada toma **primero**
   `pg_advisory_xact_lock(7352001)` (`docs/database/postgresql/schema.md` §8).
   El trigger también lo toma, pero tomarlo al inicio fija el orden de candados y
   evita interbloqueos con `SELECT … FOR UPDATE`.
2. Las escrituras replicadas quedan en serie. Las transacciones deben ser cortas:
   nada de llamadas de red (push, proveedores) dentro de ellas.
3. Las tablas append-only no admiten `UPDATE`/`DELETE` ni por trigger ni por
   permisos. Resolver, corregir o cerrar se modela como inserciones.
4. El rol de un usuario se lee de `user_role` + `brigadista_profile.active`; un
   coordinador también puede ser brigadista (Q1).

## 2. Framework HTTP: Fastify 5

| Criterio | Fastify 5.12 | Express 5.3 | Hono 4.13 |
|---|---|---|---|
| Validación de entrada | JSON Schema nativo (Ajv), por ruta | Middleware externo | Validadores externos |
| Serialización de salida | Por esquema: un campo no declarado **no sale** (protege contra filtrar `password_hash`) | Manual | Manual |
| OpenAPI | `@fastify/swagger` 9.9 | Externo | Externo |
| Rate limit, CORS, cabeceras | Plugins oficiales (`@fastify/rate-limit` 11.2, `@fastify/cors` 11.4, `@fastify/helmet` 13.2) | Terceros | Middlewares propios |
| Logs | pino integrado, con `redact` | Externo | Externo |
| Pruebas | `app.inject()` sin abrir puertos | supertest | `app.request()` |
| Madurez en Node | Alta | Alta | Pensado sobre todo para runtimes edge |

**Recomendación: Fastify.** El motivo decisivo es que el mismo JSON Schema del
contrato valida la entrada **y** filtra la salida, así que el contrato y el
comportamiento no pueden separarse sin que fallen las pruebas. Express exigiría
armar a mano lo que Fastify trae; Hono no aporta nada en un servidor Node
tradicional en un VPS.

## 3. Contrato primero (OpenAPI 3.1)

- Fuente de verdad: `backend/openapi/openapi.yaml`, escrito y **aprobado antes**
  de implementar cada módulo (web-architect trabaja sobre el contrato aprobado,
  sin mocks previos).
- El servidor carga los esquemas de `components/schemas` del YAML y los usa
  como `schema` de cada ruta (Ajv en modo JSON Schema 2020-12, el de OpenAPI 3.1).
  No hay un segundo juego de esquemas escritos en código.
- Tipos TypeScript del backend, de web y de mobile generados con
  `openapi-typescript` (7.13) desde el mismo archivo.
- **Pruebas de contrato:** una prueba recorre el YAML y exige que cada operación
  tenga una ruta registrada y viceversa; las pruebas de integración validan cada
  respuesta (incluidos los errores) contra su esquema.
- Versionado: prefijo `/v1`. Un cambio incompatible exige `/v2` o un periodo de
  convivencia, acordado con mobile-architect: una app instalada puede quedar
  semanas sin actualizarse.

Alternativa descartada: definir esquemas en código (Zod) y **generar** el YAML.
Es cómodo, pero el contrato aparecería después del código, al revés de lo
acordado en `AGENTS.md`.

## 4. Estructura de `backend/`

```
backend/
├── openapi/openapi.yaml        # contrato (fuente de verdad)
├── prisma/                     # ya existe: schema y migraciones
├── src/
│   ├── server.ts               # arranque HTTP (proceso "api")
│   ├── worker.ts               # arranque del envío de push (proceso "worker")
│   ├── app.ts                  # construye la instancia Fastify (la usan server y pruebas)
│   ├── config.ts               # variables de entorno validadas al arrancar
│   ├── db/                     # cliente Prisma, helpers de transacción (§5)
│   ├── http/                   # errores problem+json, autenticación, autorización, rate limit
│   ├── modules/
│   │   ├── auth/  users/  brigadistas/  availability/
│   │   ├── emergencies/  responses/  notifications/
│   │   ├── sync/  reviews/  audit/  health/
│   │   └── <módulo>/{routes.ts, service.ts, *.test.ts}
│   └── lib/                    # reloj estimado, enmascarado de RUT, tokens
├── test/
│   ├── integration/            # ya existe (base); se suman API + PostgreSQL
│   └── contract/
└── Dockerfile                  # etapa 5
```

Sin capas de "repositorio", hexagonal ni CQRS: cada módulo tiene rutas
(HTTP, validación, autorización) y un servicio (reglas y transacción con
Prisma). Se agrega una capa solo si aparece un problema que la justifique.

## 5. ADR-B1: acceso a datos

**Contexto.** Prisma está decidido (2026-11-13). El diseño exige candados,
niveles de aislamiento y consultas que el cliente de Prisma no expresa.

**Decisión.**

| Caso | Cómo |
|---|---|
| CRUD y lecturas simples | Prisma Client 7.10 con `@prisma/adapter-pg` 7.10 (Prisma 7 exige adaptador de driver) |
| Escritura en tablas replicadas | Helper `replicatedWrite(fn)`: `$transaction` interactiva que ejecuta `SELECT pg_advisory_xact_lock(7352001)` como **primera** sentencia y después `fn(tx)` |
| Descarga de sync | `$transaction(…, { isolationLevel: RepeatableRead })` con `SET TRANSACTION READ ONLY` al inicio; consultas por ámbito con `$queryRaw` tipado |
| Cola de push | `$queryRaw` con `FOR UPDATE SKIP LOCKED` |
| Interbloqueo o serialización (`40P01`, `40001`) | Reintento automático de la transacción completa, máximo 3, con espera aleatoria corta |
| `updated_at`, `row_version` | Nunca se escriben desde la aplicación: los ponen los triggers |

**Consecuencias.** El SQL crudo queda acotado a `src/db/` y a los servicios de
sync y push, siempre parametrizado (`Prisma.sql`). Las pruebas de integración de
la API corren contra PostgreSQL real con el rol de la aplicación, no con el
superusuario, para que un permiso faltante falle en las pruebas y no en
producción.

Dos URLs (ya implementado, P-1): la API usa `DATABASE_URL` (rol de la
aplicación); Prisma CLI usa `MIGRATION_DATABASE_URL` (rol migrador).

## 6. Errores

Formato `application/problem+json` (RFC 9457) con un `code` estable:

```json
{ "type": "about:blank", "title": "Convocatoria cerrada", "status": 409,
  "code": "EMERGENCY_CLOSED", "requestId": "…" }
```

| HTTP | Uso |
|---|---|
| 400 | Entrada inválida (`VALIDATION_ERROR`, con la lista de campos) |
| 401 | Sin token, vencido o revocado (`UNAUTHENTICATED`) |
| 403 | Autenticado sin permiso (`FORBIDDEN`) o sesión restringida (`PASSWORD_CHANGE_REQUIRED`) |
| 404 | No existe **o** no tiene permiso para saber que existe |
| 409 | Regla de negocio (`EMERGENCY_ALREADY_ACTIVE`, `EMERGENCY_CLOSED`, …) |
| 429 | Rate limit, con `Retry-After` |
| 500 | Error interno, sin detalle; el detalle queda en el log con `requestId` |

Los códigos y textos visibles los revisa ui-ux-designer. En sync, los rechazos
por operación **no** son errores HTTP (ver `sync-contract.md`).

## 7. Logs, configuración y salud

- pino a stdout en JSON. `redact` de `authorization`, `cookie`, `password`,
  `*.token`, `refresh_token` y `push_token`. El RUT se registra enmascarado
  (`12.***.***-5`). Cada petición lleva `requestId` (cabecera `X-Request-Id`).
- `config.ts` valida las variables al arrancar y aborta si falta una
  obligatoria. Nombres previstos: `DATABASE_URL`, `JWT_SIGNING_KEY`,
  `CORS_ORIGINS`, `EXPO_ACCESS_TOKEN`, `PUBLIC_BASE_URL`, `LOG_LEVEL`.
  Valores solo en `.env` (local) o secretos del entorno (devops-architect).
- `GET /health/live` (proceso vivo) y `GET /health/ready` (consulta a la base).
  El worker expone su latido en una tabla o archivo para el healthcheck del
  contenedor (a acordar con devops-architect).
- Hora: todo en UTC; `America/Santiago` solo al presentar (Q7).
