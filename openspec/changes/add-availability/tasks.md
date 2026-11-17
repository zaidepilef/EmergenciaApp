# Tareas: disponibilidad declarada

> Aprobadas el 2026-11-17, con Q1–Q3 resueltas (`design.md` §7).

## 1. Datos y sincronización (database-architect)

- [ ] 1.1 Confirmar la regla de orden de `design.md` §3 y la respuesta a Q1.
- [ ] 1.2 Alinear `docs/database/synchronization/strategy.md` §4 con
      `conflict-resolution.md`, tanto para disponibilidad como para respuestas.
- [ ] 1.3 Revisión 5 del esquema SQLite: `brigadista_profile`,
      `availability_change`, `DECLARE_AVAILABILITY` en `outbox` y la limpieza a 30 días.
- [ ] 1.4 Quitar la marca "fuera del MVP" en `docs/database/`. (Hecho en
      `docs/backend/openapi-v1.md` §1.)

## 2. Contrato y API (backend-architect)

- [x] 2.1 OpenAPI: los cambios de `design.md` §4; subir la versión menor del contrato.
- [x] 2.2 `DECLARE_AVAILABILITY` en `/v1/sync/push`: validación, `estimatedAt`,
      orden, idempotencia, `ACCOUNT_INACTIVE` y escritura atómica.
- [x] 2.3 `availability` en `/v1/me` y en `/v1/brigadistas`; filtro `availability`.
- [x] 2.4 `DashboardSummary.availability`.
- [x] 2.5 `GET /v1/brigadistas/{id}/availability-history`.
- [ ] 2.6 Pruebas: idempotencia, orden por `deviceSeq`, ventana de 60 s,
      `stale`, `UNDECLARED`, y que la activación siga convocando a todos.
      (Verificado con un script e2e contra la API y validando las respuestas
      contra el contrato; falta dejarlo como suite versionada en `backend/`.)
- [x] 2.7 Seed de demo con estados variados, incluidos desactualizados y sin declarar.

## 3. Diseño (ui-ux-designer)

- [ ] 3.1 (Borrador implementado en la demo; falta la revisión de diseño.) Selector de la app: estados, "pendiente de enviar", aviso de
      desactualizado y convivencia con la convocatoria activa.
- [ ] 3.2 Panel: chips de conteo y filtro, columna e historial.
- [ ] 3.3 Criterios de aceptación para mobile-tester.

## 4. App móvil (mobile-architect)

- [x] 4.1 Selector y estado vigente desde `/v1/me` (demo, sobre SecureStore).
- [x] 4.2 Cola sin conexión, reconciliación con `SUPERSEDED` y `CONFLICT`, y
      el aviso de 4 h.
- [ ] 4.3 Pruebas unitarias de la cola y de la estimación de hora.

## 5. Panel web (web-architect)

- [x] 5.1 Conteos, columna y filtro de disponibilidad.
- [x] 5.2 Historial por brigadista.

## 6. Verificación (mobile-tester)

- [ ] 6.1 Declarar con y sin conexión, reconfirmar, dos teléfonos y el aviso de
      4 h, y comprobar que la convocatoria llega igual a quien está `NO_DISPONIBLE`.
