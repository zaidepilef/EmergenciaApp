# Trabajo pendiente

> **Corte: 2026-11-17.** Inventario de lo que falta para el MVP, por área,
> con su dueño según `AGENTS.md`. Nada de esta lista está implementado. Las
> filas marcadas como **parcial** tienen una parte hecha, que se detalla.
> Cada tramo nuevo necesita la aprobación del usuario antes de implementarse.

Contrato de referencia: `backend/openapi/openapi.yaml` (v1, versión 1.1.0).
Cobertura actual: **29 de 42 operaciones** implementadas; las 13 restantes están en §2.

## 1. Lo que ya funciona (para ubicar lo pendiente)

| Área | Hecho |
|---|---|
| Backend | Login, renovación, logout y cambio de contraseña; `/v1/me` y convocatoria activa; `/v1/sync/push` (responder, acuse, token push, disponibilidad); panel del coordinador (resumen, brigadistas, historial de disponibilidad); crear, activar y cerrar convocatoria; administración completa de cuentas, roles y condición de brigadista |
| Web | Demo con BFF: login, convocatoria activa, crear y activar, cerrar, brigadistas con disponibilidad, usuarios y roles, cambio de contraseña obligatorio |
| Mobile | Demo Expo: login, convocatoria, VOY / NO PUEDO sin conexión, acuses, disponibilidad, primer ingreso con contraseña provisoria |

## 2. Backend — operaciones del contrato sin implementar

Dueño: **backend-architect**. Lo que consume cada operación, entre paréntesis.

### 2.1 Convocatorias

| Operación | Qué falta | Prioridad |
|---|---|---|
| `POST /v1/emergencies/{id}/notices` | Avisos de actualización durante la convocatoria (encolar push por convocado, `ACK_NOTICE`) (web, mobile) | Alta |
| `POST /v1/emergencies/{id}/recipients` | Que el coordinador agregue a mano a un convocado tarde. Hoy `LATE_ADDITION` solo ocurre sola, al crear o reactivar una cuenta o la condición de brigadista (web) | Media |
| `GET /v1/emergencies` | Historial de convocatorias cerradas (web) | Media |
| `PATCH /v1/emergencies/{id}`, `DELETE /v1/emergencies/{id}` | Editar o descartar un borrador. Hoy el panel crea y activa de una vez, sin pasar por el borrador (web) | Baja |
| `GET /v1/recipients/{id}/history` | Historial de respuestas de un convocado (web) | Media |

### 2.2 Sincronización y conflictos

| Operación | Qué falta | Prioridad |
|---|---|---|
| `POST /v1/sync/pull` | Descarga incremental por ámbitos (`emergencies`, `lateAdditions`, avisos y convocado propio). Sin esto la app solo ve la convocatoria activa (mobile) | **Alta**: requisito offline-first |
| `GET /v1/sync-reviews`, `POST /v1/sync-reviews/{operationId}/resolutions` | Revisión por el coordinador de respuestas en conflicto (`PENDING_REVIEW`). El panel ya cuenta las pendientes, pero no puede resolverlas (web) | Alta |

### 2.3 Dispositivos y auditoría

| Operación | Qué falta | Prioridad |
|---|---|---|
| `GET /v1/me/devices`, `POST /v1/me/devices/{id}/revoke` | Que el brigadista vea y revoque sus teléfonos (mobile) | Media |
| `POST /v1/devices/{id}/revoke` | Que el administrador revoque un teléfono perdido (web). `GET /v1/users/{id}` ya devuelve `devices` | Media |
| `GET /v1/audit-log` | Consulta del registro de auditoría. Hoy se escribe, pero no se puede leer desde el panel (web) | Baja |

### 2.4 Transversal

| Tema | Qué falta | Prioridad |
|---|---|---|
| **Envío real de push** | Worker que tome `notification_delivery` en `QUEUED`, con proveedor falso para pruebas y después Expo Push (D-B3); reintentos, re-aviso y marca de token inválido (`docs/backend/push-delivery.md`). Hoy los envíos quedan en `QUEUED` y ningún teléfono suena | **Crítica**: requisito 1 del MVP |
| Límites de peticiones | `docs/backend/authentication.md` §5: login (10/15 min por IP y 5/15 min por RUT), refresh y límite general con `@fastify/rate-limit`. **Parcial**: solo `/v1/auth/password` tiene límite, y es propio y en memoria | Alta antes de producción |
| Desviación `ACCOUNT_INACTIVE` | Una cuenta desactivada recibe `401` en `/v1/sync/push` en vez de `200` con la operación `REJECTED ACCOUNT_INACTIVE`, porque el guard la rechaza antes. Definir si el contrato o el código cambia | Media |
| Pruebas versionadas de la API | Integración y contrato con Vitest + `app.inject()` (`docs/backend/plan.md` §4). Hoy las pruebas e2e de disponibilidad y administración son scripts locales no versionados; las 51 versionadas son de la base | Alta |
| Concurrencia y carga | Activación contra sync, renovación contra restablecimiento; activación con 200 brigadistas sintéticos (`plan.md` §2) | Media |
| `Dockerfile` de la API | Imagen y servicio en `compose.yaml` (etapa 5 del plan) | Media |
| Búsqueda de usuarios | `GET /v1/users` filtra y ordena en memoria. Sirve para una brigada; pasar a SQL si crece a miles | Baja |

## 3. Web (dashboard)

Dueño: **web-architect**. La misión inicial (estructura, rutas por rol, plan de
pruebas) no está documentada: no existe `docs/web/`.

| Tema | Qué falta |
|---|---|
| Tipos desde OpenAPI | `openapi-typescript`; hoy `web/src/lib/types.ts` se escribe a mano |
| Pruebas | Vitest + Testing Library + Playwright. No hay ninguna |
| RUT compartido | Validar el RUT en los formularios con `packages/shared/` antes de enviarlo |
| Pantallas que esperan al backend | Avisos de actualización, revisiones de conflictos, convocado tarde manual, historial de convocatorias y de respuestas, dispositivos, auditoría (§2) |
| Cambio voluntario de contraseña | La página `/cambiar-clave` existe, pero no hay enlace a ella desde el panel |
| Sondeo | Usar `ETag` / `304` del resumen activo; paginar brigadistas y usuarios |
| Documentación | `docs/web/` (BFF, rutas por rol, decisiones) |

## 4. Mobile (app)

Dueño: **mobile-architect**. La app actual es una **demo**. La misión inicial
(arquitectura móvil) no está documentada: no existe `docs/mobile/`.

| Tema | Qué falta |
|---|---|
| Arquitectura definitiva | Documento en `docs/mobile/`, aprobado antes de reemplazar la demo |
| SQLite | Persistencia local con `expo-sqlite` según `docs/database/sqlite/` (hoy SecureStore). Incluye la revisión 5 del esquema (disponibilidad) |
| Notificaciones push | Permisos, canales, token (`REGISTER_PUSH_TOKEN`), recepción y acuse desde la notificación. Depende del worker de push (§2.4) y del diseño de sonidos y vibración (§5) |
| `sync/pull` | Descarga incremental (depende de §2.2) |
| Cambio voluntario de contraseña | Solo existe el obligatorio del primer ingreso |
| Reloj monotónico | Hoy `performance.now()` del proceso; definir la fuente real tras un reinicio del teléfono |
| Pruebas unitarias | Cola de operaciones y estimación de hora (`add-availability` 4.3) |
| Evaluación Baofeng y LoRa/Meshtastic | Fuera del MVP; solo evaluación documentada |

## 5. UX/UI

Dueño: **ui-ux-designer**. No existe `docs/ux/`: las pantallas actuales de web y
mobile son borradores sin revisión de diseño.

| Tema | Qué falta |
|---|---|
| Misión inicial | Inventario de pantallas por rol y flujo "recibir convocatoria → entenderla → responder" |
| Notificaciones | Tipos, sonidos y patrones de vibración (validado con mobile-architect) |
| Revisión de lo construido | Disponibilidad (`add-availability` 3.1–3.3), administración de usuarios y cambio de contraseña |
| Criterios de aceptación | Para que mobile-tester los verifique |

## 6. Base de datos

Dueño: **database-architect**.

| Tema | Qué falta |
|---|---|
| Inconsistencia abierta | `docs/database/synchronization/strategy.md` §4 ordena por la hora del teléfono; la regla vigente es `estimated_at` + 60 s (`add-availability` 1.1 y 1.2) |
| SQLite revisión 5 | `brigadista_profile` con disponibilidad, para mobile (`add-availability` 1.3) |
| Marca "fuera del MVP" | Quitarla donde aún aparezca para la disponibilidad (`add-availability` 1.4) |
| Retención | Política de purga de `auth_session`, `notification_delivery` y `audit_log`; define el rol de purga (P-3 de `docs/devops/local-environment.md`) |

## 7. DevOps

Dueño: **devops-architect**. Nada de esto se crea sin aprobación ni costos sin
autorización.

| Tema | Qué falta |
|---|---|
| Misión inicial | Arquitectura de despliegue, CI/CD, backups, secretos y costos |
| `deploy/` | Compose de producción, proxy con TLS, `deploy/hostinger/` (P-5, P-6) |
| CI | `.github/workflows/` por área; imágenes en GHCR |
| Migraciones en producción | Backup → `roles.sql` → migrate, con aprobación manual (P-7) |
| Roles | Solo lectura para backups y monitoreo (P-4) |
| Builds móviles | EAS: firma y distribución |

## 8. Verificación en dispositivo

Dueño: **mobile-tester**. No se ha hecho ninguna prueba en un dispositivo real
con informe.

| Tema | Qué falta |
|---|---|
| Disponibilidad | Con y sin conexión, reconfirmar y dos teléfonos (`add-availability` 6.1) |
| Primer ingreso | Contraseña provisoria y cambio en el teléfono |
| Flujo crítico | Convocatoria → respuesta sin conexión → sincronización, con push real cuando exista |

## 9. Orden sugerido

1. **Envío real de push** (§2.4) y **push en el teléfono** (§4): sin esto no se
   cumple el requisito 1 del MVP (avisar a todos los brigadistas activos).
2. **`sync/pull`** y **revisiones de conflictos** (§2.2), con su pantalla en web.
3. **Avisos de actualización** (§2.1).
4. **Pruebas versionadas de la API** y **límites de peticiones** (§2.4), antes de
   cualquier despliegue.
5. Misiones iniciales pendientes de web, mobile, UX y DevOps (§3–§7).

## 10. Fuera del MVP (no es pendiente)

Geolocalización, reapertura de convocatorias, respuestas en nombre de otro,
recuperación de contraseña por correo (D-B6), configuración editable desde el
panel (D-B4) y Baofeng / LoRa más allá de la evaluación.
