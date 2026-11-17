# Disponibilidad declarada

## ADDED Requirements

### Requirement: Declarar disponibilidad

El brigadista activo SHALL poder declarar `DISPONIBLE`, `NO_DISPONIBLE` o
`EN_SERVICIO` en cualquier momento, con o sin convocatoria activa y con o sin
conexión.

#### Scenario: Declarar con conexión

- **WHEN** el brigadista elige `NO_DISPONIBLE` en la app con conexión
- **THEN** la app envía `DECLARE_AVAILABILITY` en `/v1/sync/push`
- **AND** el servidor responde `APPLIED`
- **AND** `/v1/me` devuelve `availability.status = NO_DISPONIBLE` con su `declaredAt`

#### Scenario: Declarar sin conexión

- **WHEN** el brigadista declara `DISPONIBLE` sin conexión
- **THEN** la app muestra el estado nuevo marcado "pendiente de enviar"
- **AND** lo envía automáticamente al recuperar la conexión
- **AND** `estimatedAt` corresponde al momento en que tocó el botón y no al del envío

#### Scenario: Reenvío del mismo cambio

- **WHEN** la app reenvía una operación con un `operationId` ya procesado
- **THEN** el servidor devuelve el resultado guardado con `duplicate: true` y no crea otro cambio

#### Scenario: Cuenta inactiva

- **WHEN** una cuenta o un perfil de brigadista inactivo envía `DECLARE_AVAILABILITY`
- **THEN** el resultado es `REJECTED ACCOUNT_INACTIVE`

### Requirement: Orden de las declaraciones

El servidor SHALL determinar el estado vigente sin depender solo del reloj del
teléfono y SHALL conservar todas las declaraciones en el historial.

#### Scenario: Llega tarde una declaración más antigua del mismo teléfono

- **WHEN** llega un cambio con `deviceSeq` menor que el del cambio vigente del mismo dispositivo
- **THEN** el resultado es `SUPERSEDED` y el estado vigente no cambia

#### Scenario: Dos teléfonos con más de 60 s de diferencia

- **WHEN** dos dispositivos del mismo brigadista declaran con más de 60 s de diferencia estimada
- **THEN** queda vigente la declaración posterior y la otra queda en el historial

### Requirement: Dato desactualizado

El sistema SHALL marcar la disponibilidad como desactualizada cuando pasan más
de 4 horas desde la última declaración, sin cambiar el estado.

#### Scenario: Pasan cuatro horas

- **WHEN** pasaron más de 4 h desde `declaredAt`
- **THEN** la API devuelve `stale: true` y conserva el mismo `status`
- **AND** la app muestra "¿Sigue vigente?" con un botón para reconfirmar

#### Scenario: Reconfirmar

- **WHEN** el brigadista reconfirma el mismo estado
- **THEN** se crea un cambio nuevo en el historial, `declaredAt` se renueva y `stale` vuelve a `false`

### Requirement: Independencia de la convocatoria

La disponibilidad SHALL NOT afectar a quién se convoca ni a la respuesta.

#### Scenario: Activar con brigadistas no disponibles

- **WHEN** el coordinador activa una convocatoria y hay brigadistas `NO_DISPONIBLE`, desactualizados o sin declarar
- **THEN** todos los brigadistas activos quedan convocados (RN-06)

#### Scenario: Responder VOY

- **WHEN** un brigadista `DISPONIBLE` responde `VOY`
- **THEN** su disponibilidad sigue siendo `DISPONIBLE` (RN-09)

### Requirement: Vista del coordinador

El panel SHALL mostrar el conteo por disponibilidad, la disponibilidad de cada
brigadista con su antigüedad y el historial de cambios.

#### Scenario: Conteo en el panel

- **WHEN** el coordinador abre el panel
- **THEN** ve cuántos brigadistas activos están `DISPONIBLE`, `NO_DISPONIBLE`, `EN_SERVICIO`, desactualizados y sin declarar

#### Scenario: Filtrar brigadistas

- **WHEN** el coordinador filtra por "Desactualizada"
- **THEN** la lista muestra solo a quienes declararon hace más de 4 h

#### Scenario: Historial

- **WHEN** el coordinador abre a un brigadista
- **THEN** ve sus cambios de disponibilidad con la hora estimada, si se hicieron sin conexión y si se aplicaron o quedaron reemplazados
