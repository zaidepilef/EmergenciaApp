# Propuesta: disponibilidad declarada en el MVP

> **Estado:** aprobada por el usuario el 2026-11-17, con Q1–Q3 resueltas según
> la recomendación (`design.md` §7). En implementación.

## Por qué

El 2026-11-16 el usuario decidió **sumar la disponibilidad declarada al MVP**.
Esto revierte la decisión del 2026-11-13, que la había dejado fuera
(`docs/backend/openapi-v1.md` §1).

Hoy un brigadista no tiene forma de avisar desde la app que no está disponible
cuando no hay emergencia. El coordinador tampoco puede anticipar con cuántas
personas cuenta antes de activar una convocatoria.

## Qué cambia

- El brigadista declara su estado desde la app: **DISPONIBLE**,
  **NO_DISPONIBLE** o **EN_SERVICIO**. Lo puede hacer en cualquier momento y
  también sin conexión. La declaración se sincroniza como la respuesta a una
  convocatoria, con la operación `DECLARE_AVAILABILITY` de `/v1/sync/push`.
- La app muestra el estado vigente y cuándo se declaró. Pasadas **4 horas**
  advierte que el dato está desactualizado y ofrece reconfirmarlo (RN-03).
- El panel muestra:
  - el conteo por disponibilidad, separando "desactualizada" y "sin declarar";
  - una columna y un filtro en la lista de brigadistas;
  - el historial de cambios de cada brigadista.
- **No cambia a quién se convoca.** La activación sigue avisando a todos los
  brigadistas activos (RN-06). Responder `VOY` tampoco cambia la
  disponibilidad (RN-09).

## Qué no cambia

- El contrato crece solo con campos y valores nuevos. No se quita ni se
  renombra nada de la v1, así que las apps v1 siguen funcionando.
- El modelo de PostgreSQL ya tiene `availability_change` y las columnas de
  `brigadista_profile`, por lo que **no hace falta una migración nueva** para
  los datos (ver `design.md` §2).

## Fuera de alcance

- Que el coordinador declare la disponibilidad en nombre de un brigadista
  (`COORDINATOR_PROXY`).
- Que el brigadista declare su estado desde la web.
- Recordatorios push cuando el dato se desactualiza.
- Que la disponibilidad filtre o priorice la convocatoria. Esto queda excluido
  de forma permanente por RN-06.

## Áreas afectadas

| Área | Responsable | Qué hace |
| --- | --- | --- |
| Datos y sincronización | database-architect | Confirma la regla de orden y conflictos; vuelve a agregar las tablas al SQLite; corrige `strategy.md` |
| Contrato y API | backend-architect | `DECLARE_AVAILABILITY`, campos nuevos, filtro, historial y pruebas |
| Diseño | ui-ux-designer | Selector en la app; columna, conteos e historial en el panel |
| App móvil | mobile-architect | Selector, cola sin conexión y aviso de dato desactualizado |
| Panel web | web-architect | Conteos, columna, filtro e historial |
| Verificación | mobile-tester | Casos en dispositivo, incluido el modo sin conexión |
