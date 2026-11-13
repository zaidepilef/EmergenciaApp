import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 no carga .env por sí solo. Si existe backend/.env (local, no
// versionado; ver .env.example) se carga con la función nativa de Node; las
// variables ya definidas en el entorno tienen prioridad.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const shadowDatabaseUrl = process.env["SHADOW_DATABASE_URL"];

// DATABASE_URL se lee del entorno; nunca se versiona.
// format, validate y migrate diff --from-empty no se conectan a ninguna base.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "",
    // Solo si la variable existe (desarrollo local: base emergencia_shadow).
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
