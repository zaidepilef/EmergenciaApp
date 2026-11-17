# Modelo de datos y migraciones MongoDB

Diseño conceptual para MongoDB. El desarrollo local usa Docker (`compose.yaml`,
replica set `rs0`); producción usará MongoDB Atlas. La Etapa 0 no crea
colecciones, índices ni conexiones desde la aplicación. El modelo debe validarse
antes de escribir la primera migración.

## 1. Convenciones

- Base lógica por entorno: `MONGODB_DB` (por defecto `brigada_emergencias`).
- Colecciones en plural y `snake_case`: `users`, `emergency_responses`.
- Campos en `camelCase`: `passwordHash`, `createdAt`.
- Claves primarias `ObjectId`; las referencias guardan el `ObjectId` del documento
  relacionado.
- Fechas como `Date` de BSON, siempre en UTC. La presentación usa la zona horaria
  de la brigada (pendiente de definir).
- Estados y roles en mayúsculas, con validadores que rechacen valores fuera del
  conjunto permitido.
- `createdAt` y `updatedAt` en documentos mutables.
- Las colecciones de historial y auditoría son append-only.
- No se duplican datos de autenticación ni se guardan contraseñas en texto plano.

## 2. Colecciones

### `users`

Identidad de acceso y rol.

| Campo                | Tipo     | Reglas                                        |
| -------------------- | -------- | --------------------------------------------- |
| `_id`                | ObjectId | Clave primaria.                               |
| `rut`                | string   | Canónico `12345678-5`, único, obligatorio.    |
| `passwordHash`       | string   | Argon2id, obligatorio, nunca expuesto.        |
| `role`               | string   | `ADMINISTRADOR`, `COORDINADOR`, `BRIGADISTA`. |
| `active`             | boolean  | Obligatorio, por defecto `true`.              |
| `fullName`           | string   | Nombre visible, obligatorio.                  |
| `email`              | string   | Opcional; único si se usa.                    |
| `mustChangePassword` | boolean  | Para altas con contraseña provisoria.         |
| `lastLoginAt`        | Date     | Opcional.                                     |
| `passwordChangedAt`  | Date     | Opcional.                                     |
| `createdAt`          | Date     | Obligatorio.                                  |
| `updatedAt`          | Date     | Obligatorio.                                  |
| `schemaVersion`      | number   | Facilita migraciones de documentos.           |

Índices:

- `{ rut: 1 }` único.
- `{ role: 1, active: 1 }`.
- `{ email: 1 }` único parcial si se usa `email` (documentos sin email quedan
  fuera del índice).

### `brigadistas`

Perfil operativo del brigadista, separado de la identidad de acceso.

| Campo                   | Tipo     | Reglas                                        |
| ----------------------- | -------- | --------------------------------------------- |
| `_id`                   | ObjectId | Clave primaria.                               |
| `userId`                | ObjectId | Referencia única a `users`.                   |
| `phone`                 | string   | Opcional.                                     |
| `availabilityStatus`    | string   | `DISPONIBLE`, `NO_DISPONIBLE`, `EN_SERVICIO`. |
| `availabilityUpdatedAt` | Date     | Obligatorio.                                  |
| `createdAt`             | Date     | Obligatorio.                                  |
| `updatedAt`             | Date     | Obligatorio.                                  |

Índices:

- `{ userId: 1 }` único.
- `{ availabilityStatus: 1, availabilityUpdatedAt: 1 }`.

### `availability_history`

Historial de cambios de disponibilidad. Append-only.

| Campo       | Tipo     | Reglas                             |
| ----------- | -------- | ---------------------------------- |
| `_id`       | ObjectId | Clave primaria.                    |
| `userId`    | ObjectId | Referencia a `users`.              |
| `status`    | string   | Estados de disponibilidad válidos. |
| `changedAt` | Date     | Obligatorio.                       |
| `changedBy` | ObjectId | Usuario que originó el cambio.     |
| `source`    | string   | `USER`, `COORDINATOR` o `SYSTEM`.  |

Índices:

- `{ userId: 1, changedAt: -1 }`.

### `emergencies`

Convocatorias y su ciclo de vida.

| Campo         | Tipo     | Reglas                       |
| ------------- | -------- | ---------------------------- |
| `_id`         | ObjectId | Clave primaria.              |
| `type`        | string   | Tipo de emergencia.          |
| `location`    | string   | Lugar o referencia.          |
| `description` | string   | Detalle operativo.           |
| `status`      | string   | `DRAFT`, `ACTIVE`, `CLOSED`. |
| `createdBy`   | ObjectId | Referencia a `users`.        |
| `createdAt`   | Date     | Obligatorio.                 |
| `activatedAt` | Date     | Obligatorio al activar.      |
| `closedAt`    | Date     | Obligatorio al cerrar.       |
| `updatedAt`   | Date     | Obligatorio.                 |

Índices:

- `{ status: 1 }` único parcial con
  `partialFilterExpression: { status: "ACTIVE" }`. Impide dos convocatorias
  activas (RN-05).
- `{ createdAt: -1 }`.

La activación se ejecuta dentro de una transacción: crear o cambiar el estado de
la convocatoria y registrar las notificaciones pendientes. Si el índice único
falla, la transacción se aborta y no se notifica a nadie. El replica set local
`rs0` permite probar este comportamiento sin depender de Atlas.

### `emergency_responses`

Respuesta de cada brigadista a una convocatoria.

| Campo         | Tipo     | Reglas                      |
| ------------- | -------- | --------------------------- |
| `_id`         | ObjectId | Clave primaria.             |
| `emergencyId` | ObjectId | Referencia a `emergencies`. |
| `userId`      | ObjectId | Referencia a `users`.       |
| `response`    | string   | `VOY` o `NO_PUEDO`.         |
| `respondedAt` | Date     | Obligatorio.                |
| `updatedAt`   | Date     | Obligatorio.                |

Índices:

- `{ emergencyId: 1, userId: 1 }` único.
- `{ emergencyId: 1, response: 1 }`.

Las respuestas nuevas se rechazan si la convocatoria está cerrada. La regla exacta
de modificación posterior se definirá antes de la Etapa 4.

### `notifications`

Intentos y resultados de notificación por convocatoria y destinatario.

| Campo               | Tipo     | Reglas                                                |
| ------------------- | -------- | ----------------------------------------------------- |
| `_id`               | ObjectId | Clave primaria.                                       |
| `emergencyId`       | ObjectId | Referencia a `emergencies`.                           |
| `userId`            | ObjectId | Referencia a `users`.                                 |
| `channel`           | string   | `PUSH` u otro canal aprobado.                         |
| `status`            | string   | `PENDING`, `SENT`, `DELIVERED`, `FAILED`, `ACCEPTED`. |
| `attempts`          | number   | Cantidad de intentos.                                 |
| `providerMessageId` | string   | Opcional.                                             |
| `errorCode`         | string   | Opcional, sin datos sensibles.                        |
| `createdAt`         | Date     | Obligatorio.                                          |
| `updatedAt`         | Date     | Obligatorio.                                          |

Índices:

- `{ emergencyId: 1, userId: 1, channel: 1 }` único.
- `{ status: 1, createdAt: 1 }`.
- `{ userId: 1, createdAt: -1 }`.

### `audit_logs`

Registro de operaciones administrativas y de seguridad. Append-only.

| Campo        | Tipo     | Reglas                                       |
| ------------ | -------- | -------------------------------------------- |
| `_id`        | ObjectId | Clave primaria.                              |
| `actorId`    | ObjectId | Usuario que ejecutó la acción, si existe.    |
| `action`     | string   | Identificador de la acción.                  |
| `entityType` | string   | Tipo de entidad afectada.                    |
| `entityId`   | ObjectId | Opcional.                                    |
| `metadata`   | object   | Datos mínimos, sin secretos ni RUT completo. |
| `createdAt`  | Date     | Obligatorio.                                 |

Índices:

- `{ createdAt: -1 }`.
- `{ actorId: 1, createdAt: -1 }`.

### `schema_migrations`

Control de migraciones aplicadas.

| Campo       | Tipo     | Reglas                    |
| ----------- | -------- | ------------------------- |
| `_id`       | ObjectId | Clave primaria.           |
| `name`      | string   | Nombre del script, único. |
| `appliedAt` | Date     | Obligatorio.              |

Índice:

- `{ name: 1 }` único.

## 3. Invariantes reforzadas en la base

- **RN-05 — una sola convocatoria activa:** índice único parcial sobre
  `status: "ACTIVE"` y transacción de activación. Probar activaciones
  concurrentes.
- **Respuesta única:** índice único `(emergencyId, userId)`.
- **RUT único:** índice único sobre la forma canónica.
- **Estados válidos:** validadores JSON Schema para roles, disponibilidad,
  respuestas y estados de convocatoria y notificación.
- **Usuarios desactivados:** la consulta de destinatarios excluye `active: false`
  (RN-07). La condición se aplica en la consulta, no solo en la interfaz.
- **Historial y auditoría:** sin actualización libre; idealmente append-only.
- **Fechas:** BSON `Date` en UTC; la zona de presentación se define antes de la
  Etapa 3.

## 4. Índices mínimos

| Colección              | Índice                                                | Propósito                     |
| ---------------------- | ----------------------------------------------------- | ----------------------------- |
| `users`                | `{ rut: 1 }` único                                    | Login y unicidad.             |
| `users`                | `{ role: 1, active: 1 }`                              | Listados y filtros.           |
| `brigadistas`          | `{ userId: 1 }` único                                 | Perfil por usuario.           |
| `brigadistas`          | `{ availabilityStatus: 1, availabilityUpdatedAt: 1 }` | Estado de la brigada.         |
| `availability_history` | `{ userId: 1, changedAt: -1 }`                        | Historial propio.             |
| `emergencies`          | `{ status: 1 }` único parcial (`ACTIVE`)              | Una sola activa.              |
| `emergencies`          | `{ createdAt: -1 }`                                   | Listado reciente.             |
| `emergency_responses`  | `{ emergencyId: 1, userId: 1 }` único                 | Respuesta única.              |
| `emergency_responses`  | `{ emergencyId: 1, response: 1 }`                     | Conteos por respuesta.        |
| `notifications`        | `{ emergencyId: 1, userId: 1, channel: 1 }` único     | Un registro por destinatario. |
| `notifications`        | `{ status: 1, createdAt: 1 }`                         | Reintentos pendientes.        |
| `audit_logs`           | `{ createdAt: -1 }`                                   | Consulta cronológica.         |

Los índices se crean en migraciones, no manualmente desde el dashboard. La
creación de índices es idempotente con `createIndexes`.

## 5. Validadores JSON Schema

Cada colección tendrá un validador con `validationLevel: "strict"` y
`validationAction: "error"` para los campos críticos. Ejemplo de referencia para
`emergencies`:

```javascript
{
  $jsonSchema: {
    bsonType: "object",
    required: ["type", "status", "createdBy", "createdAt", "updatedAt"],
    properties: {
      status: { enum: ["DRAFT", "ACTIVE", "CLOSED"] },
      createdBy: { bsonType: "objectId" },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" }
    }
  }
}
```

Los validadores se aplican o actualizan con `collMod` en una migración. No
reemplazan la autorización del servidor ni la validación de dominio: son la
última barrera de integridad.

## 6. Estrategia de migraciones

- Ubicación prevista: `db/migrations/`.
- Nombre: `YYYYMMDDHHMMSS_descripcion.mjs`, ordenado cronológicamente.
- Cada script es idempotente: puede ejecutarse dos veces sin duplicar índices,
  validadores ni documentos de control.
- Registro en `schema_migrations`; si el nombre ya existe, el script no se vuelve
  a aplicar.
- Los scripts usan el driver oficial y leen la configuración del entorno del
  servidor. No incluyen credenciales ni datos reales.
- No se editan migraciones ya aplicadas en entornos compartidos; se agrega una
  nueva.
- Los cambios destructivos requieren respaldo previo y autorización explícita.
- No se ejecutan migraciones contra producción sin autorización.
- No se crean colecciones ni índices desde el dashboard para luego "copiar" el
  cambio sin revisión.

Flujo previsto:

1. Validar el modelo y las reglas.
2. Escribir la migración y sus pruebas.
3. Aplicarla en una base de desarrollo limpia.
4. Verificar índices, validadores e invariantes con pruebas de integración.
5. Versionar el script junto con el código que lo usa.
6. Repetir en un entorno limpio para comprobar que es reproducible.

En la Etapa 0 no existe `db/migrations/`, ningún script ni conexión desde la
aplicación. MongoDB local está disponible en Docker.

## 7. Datos de prueba y entornos

- Usar MongoDB local en Docker para desarrollo e integración.
- Usar una base de desarrollo o pruebas separada de producción.
- Nunca cargar datos personales reales.
- Los RUT de prueba deben ser ficticios y válidos según módulo 11.
- No versionar contraseñas reales; los usuarios de prueba usan hashes generados
  para el entorno de pruebas.
- En producción, el usuario de base de datos de Atlas solo tiene permisos sobre la
  base lógica de la aplicación, nunca permisos de administración del clúster.
- Restringir el acceso de red en Atlas y usar TLS mediante `mongodb+srv`.
- Mantener respaldos y monitoreo antes de operar con datos reales.
- El navegador nunca recibe la cadena de conexión ni credenciales de MongoDB.
