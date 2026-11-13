import { spawnSync } from "node:child_process";
import pg from "pg";
import { testDatabaseUrl } from "./db";

// Vacía la base *_test local y le aplica las migraciones con Prisma, igual que
// en cualquier otro entorno (prisma migrate deploy).
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }

  const result = spawnSync("npx prisma migrate deploy", {
    shell: true,
    stdio: "pipe",
    encoding: "utf8",
    // Ambas: prisma.config.ts prefiere MIGRATION_DATABASE_URL, que en un .env
    // local podría apuntar a la base de desarrollo.
    env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url },
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy falló:\n${result.stdout}\n${result.stderr}`);
  }
}
