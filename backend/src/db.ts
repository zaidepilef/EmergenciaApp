import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { config } from "./config.js";

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.databaseUrl }),
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Escritura replicada (docs/database/synchronization/versioning.md): siempre
 * READ COMMITTED y tomando primero el candado de versión, así toda lectura
 * posterior ve lo confirmado por quien tenía el candado.
 */
export function replicatedWrite<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(7352001)::text AS locked`;
      return fn(tx);
    },
    { isolationLevel: "ReadCommitted", timeout: 15_000 },
  );
}

export const toNum = (v: bigint | number): number => Number(v);
