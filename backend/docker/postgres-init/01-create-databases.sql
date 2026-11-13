-- Se ejecuta solo la primera vez que se inicializa el volumen (docker-entrypoint-initdb.d).
-- Bases adicionales de la instancia LOCAL:
--   emergencia_test   → pruebas de integración (se vacía y re-migra en cada corrida)
--   emergencia_shadow → base sombra de Prisma Migrate (migrate diff / migrate dev)
CREATE DATABASE emergencia_test;
CREATE DATABASE emergencia_shadow;
