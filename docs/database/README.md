# Arquitectura de datos — EmergenciaApp

> **Estado: PROPUESTA PRELIMINAR — pendiente de aprobación.**
> No existen tablas, migraciones ni `schema.prisma`. Nada de lo descrito aquí está
> implementado. Responsable: `database-architect`.

## Documentos

| Documento | Contenido | Estado |
|---|---|---|
| [conceptual-model.md](conceptual-model.md) | Entidades, relaciones, propiedad de los datos | Propuesta |
| [logical-model.md](logical-model.md) | Atributos, claves, restricciones, tipos portables PostgreSQL/SQLite | Propuesta |
| [synchronization/strategy.md](synchronization/strategy.md) | Réplica local, cola de operaciones, idempotencia, conflictos | Propuesta |
| [failure-scenarios.md](failure-scenarios.md) | Peores casos (incendio, push perdido, sin Internet, aviso externo, servidor caído) y cambios al modelo | Propuesta |
| `physical-model.md`, `postgresql/`, `sqlite/` | DDL, índices, migraciones | **No iniciado** (requiere aprobación) |

## Decisiones vigentes que condicionan el modelo

| Decisión | Fuente |
|---|---|
| PostgreSQL central en VPS; SQLite en Android/iOS; offline-first | `AGENTS.md` |
| Prisma solo en backend/PostgreSQL; `expo-sqlite` en el móvil | `AGENTS.md` (2026-11-13) |
| Geolocalización fuera del MVP | `AGENTS.md` (2026-11-13) |
| Una sola brigada (RN-01) | `README.md` |
| Dashboard web en línea, sin réplica local | `AGENTS.md` |

## 1. Diagnóstico del modelo actual

El único modelo existente es `docs/mongodb-data-model.md` (arquitectura anterior,
sin implementar). Sus entidades y reglas siguen siendo válidas como base de
dominio, pero tiene vacíos para la nueva arquitectura:

| # | Problema | Impacto |
|---|---|---|
| D1 | Identificadores `ObjectId` generados por el servidor | El móvil no puede crear registros sin conexión |
| D2 | La respuesta a una convocatoria se sobrescribe (`unique emergencyId+userId`) | Se pierde el historial de cambios de respuesta (RN-10) |
| D3 | No hay registro de **quiénes fueron convocados** | "Pendientes" se calcula contra los usuarios activos *de hoy*, no los de la activación: el historial queda incorrecto |
| D4 | Estados de notificación ambiguos (`SENT`, `ACCEPTED`, `DELIVERED`) y sin confirmación del dispositivo | No distingue envío / aceptación del proveedor / entrega / apertura, como exige el README |
| D5 | No hay entidad de dispositivo ni token push | El backend no tiene a quién enviar |
| D6 | Sesión JWT sin estado | La app móvil necesita tokens de renovación revocables |
| D7 | Sin soporte de sincronización (versiones, borrados lógicos, idempotencia) | Duplicados y pérdida de datos al reconectar |
| D8 | `availability_history.source = COORDINATOR` | Contradice la matriz de permisos: el coordinador no modifica disponibilidad |
| D9 | Faltan "fecha y hora" e "instrucciones" en la convocatoria | El README las exige como campos separados |

Contradicción documental: `README.md` aún describe PWA + MongoDB + Capacitor.
Se mantiene como fuente de **reglas de negocio**; su sección de tecnología está
superada por `AGENTS.md`.

## 2. Recomendaciones principales

1. **UUID v7** como clave de toda entidad sincronizable (generable en el
   dispositivo, ordenable en el tiempo, eficiente en índices de PostgreSQL).
2. Patrón **evento append-only + estado actual** para disponibilidad y
   respuestas: el historial nunca se pierde y la lectura del panel es rápida.
3. **Snapshot de convocados** al activar una convocatoria (`emergency_recipient`).
4. **Entrega separada de respuesta**, con un timestamp por estado de entrega.
5. **El servidor es la fuente de verdad**; el dispositivo guarda una réplica
   parcial y una cola de operaciones idempotentes.
6. **Mínimos datos personales en el dispositivo**: solo los del propio
   brigadista; nunca RUT completo de terceros, hashes ni tokens fuera de
   SecureStore.

## 3. Dudas y supuestos a validar

| # | Pregunta | Supuesto actual |
|---|---|---|
| Q1 | ¿Un coordinador también puede ser brigadista (recibir convocatorias)? | No: un rol por usuario. El modelo permite cambiarlo (perfil de brigadista separado) |
| Q2 | ¿Reconfirmar el mismo estado de disponibilidad cuenta como "actualización" para la regla de 4 horas? | Sí: se registra como evento aunque el estado no cambie |
| Q3 | ¿Se acepta una respuesta hecha sin conexión **antes** del cierre que llega **después**? | Sí, marcada como "recibida después del cierre". Nunca se descarta en silencio |
| Q4 | ¿Se puede cambiar la respuesta (`VOY` ↔ `NO_PUEDO`) mientras la convocatoria está activa? | Sí; queda historial |
| Q5 | ¿El tipo de emergencia es texto libre o un catálogo administrable? | Texto libre en el MVP |
| Q6 | ¿Canal de recuperación de contraseña: correo o reinicio por un administrador? | Reinicio por administrador; correo opcional |
| Q7 | Zona horaria de presentación | `America/Santiago`; se almacena siempre en UTC |
| Q8 | Retención de historial, auditoría y datos de usuarios desactivados | Sin purga en el MVP; definir antes de producción |
| Q9 | ¿Cuántas convocatorias cerradas debe conservar el teléfono sin conexión? | Las últimas 20 o 30 días |

## 4. Archivos que requerirán modificación al aprobarse

- `docs/database/physical-model.md`, `postgresql/schema.md`, `sqlite/schema.md` (nuevos).
- `backend/prisma/schema.prisma` (backend-architect, revisado por database-architect).
- `docs/mongodb-data-model.md`: marcar como histórico.

## 5. Necesidades que afectan a otros subagentes

| Para | Necesidad |
|---|---|
| backend-architect | Endpoint de sincronización por lotes con resultado por operación; asignar `row_version`; registrar `processed_operation` |
| mobile-architect | Generar UUID v7 en el dispositivo; outbox persistente; enviar acuse de recepción de la convocatoria |
| ui-ux-designer | Estados visibles: pendiente de envío, enviado, confirmado por el servidor, recibido después del cierre |
| devops-architect | Backups de PostgreSQL; la réplica SQLite **no** es respaldo |
