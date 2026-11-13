import { defineConfig } from "prisma/config";

// DATABASE_URL se lee del entorno; nunca se versiona (ver .env.example).
// Los comandos de esta etapa (format, validate, migrate diff --from-empty) no se
// conectan a ninguna base.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "",
  },
});
