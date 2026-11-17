# Requisitos del producto

> Extraído del README original (2026-11-16). Contiene solo el **dominio**: qué
> debe hacer la plataforma. La arquitectura vigente está en `AGENTS.md`
> (PostgreSQL + SQLite, app móvil offline-first, API REST, dashboard web).
>
> **Cambios de alcance posteriores:** la recuperación de contraseña por correo
> quedó **fuera del MVP** (2026-11-13; ver `docs/backend/openapi-v1.md` §1). La
> disponibilidad declarada (§3.2, RN-02, RN-03) también había quedado fuera, pero
> el 2026-11-16 el usuario la **sumó al MVP** (propuesta en
> `openspec/changes/add-availability/`).

## 1. Objetivo

Entregar a los brigadistas una forma sencilla de informar si pueden acudir a
una emergencia y permitir al coordinador conocer las respuestas de la brigada
cuando se active una convocatoria.

La disponibilidad declarada por un brigadista es informativa: no reemplaza la
confirmación de asistencia a una emergencia concreta.

## 2. Usuarios y roles

| Rol | Responsabilidades |
| --- | --- |
| Administrador | Gestionar usuarios, roles y configuración general |
| Coordinador | Administrar brigadistas, crear y activar convocatorias, consultar respuestas y cerrar emergencias |
| Brigadista | Actualizar su disponibilidad, recibir convocatorias y responder si puede asistir |

Los permisos se validan en el servidor. Ocultar botones en la interfaz no
constituye una medida de seguridad.

## 3. Funcionalidades del MVP

### 3.1 Autenticación y usuarios

- Inicio de sesión con RUT y contraseña; cierre de sesión.
- Recuperación de contraseña.
- Administración de brigadistas: alta, activación y desactivación.
- Asignación de roles.
- Primer acceso con cambio obligatorio de contraseña provisoria.

### 3.2 Disponibilidad

Cada brigadista activo puede actualizar su estado en cualquier momento:
**DISPONIBLE**, **NO_DISPONIBLE** o **EN_SERVICIO**.

1. Registrar fecha y hora de cada actualización.
2. Mostrar cuándo se actualizó por última vez.
3. Pasadas cuatro horas sin actualización, advertir que el dato está desactualizado.
4. La antigüedad no cambia automáticamente el estado.
5. Confirmar asistencia a una convocatoria no cambia el estado a `EN_SERVICIO`.
6. La disponibilidad general y la respuesta a una convocatoria son datos distintos.

### 3.3 Convocatorias de emergencia

El coordinador crea y activa una convocatoria con motivo o tipo, lugar o punto
de encuentro (texto), fecha y hora, e instrucciones adicionales.

1. Solo puede existir una convocatoria activa a la vez.
2. Al activarla se notifica a **todos los brigadistas activos**, sin filtrar por disponibilidad.
3. Reciben la notificación los brigadistas `DISPONIBLE`, `NO_DISPONIBLE`, `EN_SERVICIO` y los de disponibilidad desactualizada.
4. Los usuarios desactivados no reciben nuevas convocatorias.
5. Cada brigadista puede responder `VOY` o `NO_PUEDO`.
6. Se registra la respuesta con su fecha y hora.
7. `VOY` no equivale a registrar el inicio efectivo del servicio.
8. El coordinador consulta las respuestas y cierra la convocatoria.

Una notificación enviada no garantiza que haya sido recibida, vista o leída. La
plataforma distingue, cuando el proveedor lo permite, entre intento de envío,
aceptación por el proveedor, entrega y respuesta del usuario. La bandeja
interna de convocatorias sigue disponible aunque falle el push.

### 3.4 Panel del coordinador

- Total de brigadistas activos y conteo por disponibilidad.
- Identificación de información desactualizada.
- Detalle de la convocatoria activa.
- Conteo de respuestas `VOY`, `NO_PUEDO` y pendientes.
- Listado de brigadistas y administración de su estado activo.
- Historial de disponibilidad y convocatorias.

### 3.5 Historial

Conservar al menos: cambios de disponibilidad con su fecha y hora;
convocatorias creadas, activadas y cerradas; respuestas de los brigadistas; e
intentos y resultados de notificación.

## 4. Reglas de negocio

| Código | Regla |
| --- | --- |
| RN-01 | El MVP opera con una sola brigada |
| RN-02 | El brigadista actualiza su disponibilidad cuando lo necesite |
| RN-03 | Después de cuatro horas se advierte que el dato está desactualizado; no se cambia el estado |
| RN-04 | La disponibilidad no sustituye la respuesta a una convocatoria |
| RN-05 | Solo puede existir una convocatoria activa |
| RN-06 | La activación notifica a todos los brigadistas activos, sin importar su disponibilidad |
| RN-07 | Los brigadistas desactivados no reciben nuevas convocatorias |
| RN-08 | Las respuestas posibles son `VOY` y `NO_PUEDO` |
| RN-09 | Responder `VOY` no cambia automáticamente el estado a `EN_SERVICIO` |
| RN-10 | El sistema mantiene historial y trazabilidad de las operaciones relevantes |

## 5. Fuera del alcance del MVP

GPS y geolocalización, mapas y seguimiento de vehículos, chat interno,
integraciones con organismos externos, múltiples brigadas, estadísticas
avanzadas y automatizaciones no definidas aquí.

## 6. Experiencia de usuario

Interfaz clara y accesible, con botones de acción grandes y estados que no
dependen solo del color. Pantallas iniciales: inicio de sesión; inicio del
brigadista; bandeja de convocatorias; detalle de convocatoria y respuesta;
perfil; panel del coordinador; administración de brigadistas; creación y
gestión de convocatorias; historial.

## 7. Criterios de aceptación del MVP

- Un brigadista inicia sesión y responde convocatorias.
- El coordinador administra integrantes.
- El sistema impide activar una segunda convocatoria mientras exista otra activa.
- La activación notifica a todos los brigadistas activos, incluso a los no disponibles o desactualizados.
- Los brigadistas responden `VOY` o `NO_PUEDO`, también sin conexión.
- El coordinador consulta las respuestas y cierra la convocatoria.
- Las reglas de acceso están probadas para los tres roles.
- Existe una bandeja interna para consultar convocatorias aunque falle el push.
