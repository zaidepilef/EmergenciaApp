import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 no carga .env por sí solo. Si existe backend/.env (local, no
// versionado; ver .env.example) se carga con la función nativa de Node; las
// variables ya definidas en el entorno tienen prioridad.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const shadowDatabaseUrl = process.env["SHADOW_DATABASE_URL"];

// Prisma CLI (migrate deploy/status/reset/diff) usa MIGRATION_DATABASE_URL si
// existe (rol migrador, dueño del esquema) y si no DATABASE_URL. La API en
// ejecución usa solo DATABASE_URL (rol de la aplicación). En local ambas son el
// superusuario de desarrollo. Ver docs/devops/local-environment.md (P-1).
// Ninguna URL se versiona. format, validate y migrate diff --from-empty no se
// conectan a ninguna base.
const migrationDatabaseUrl =
  process.env["MIGRATION_DATABASE_URL"] || process.env["DATABASE_URL"] || "";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationDatabaseUrl,
    // Solo si la variable existe (desarrollo local: base emergencia_shadow).
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
