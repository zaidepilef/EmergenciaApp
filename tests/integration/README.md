# Pruebas de integración

Esta carpeta se usará para pruebas que dependan de MongoDB local en Docker,
validadores, índices, transacciones o flujos completos de servidor. La estrategia
está definida en `docs/testing-strategy.md`.

En la Etapa 0 no hay pruebas de integración porque todavía no existen colecciones
de negocio ni conexión desde la aplicación, aunque el contenedor local está
disponible con `npm run db:up`.
