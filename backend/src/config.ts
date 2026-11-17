import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  host: process.env["HOST"] ?? "0.0.0.0",
  port: Number(process.env["PORT"] ?? 3000),
  /** Clave privada Ed25519 en PKCS#8 PEM. Si falta, se genera una al arrancar (solo desarrollo). */
  jwtPrivateKeyPem: process.env["JWT_PRIVATE_KEY"]?.replace(/\n/g, "\n"),
  accessTokenTtlSec: 10 * 60,
  refreshTtlMobileSec: 30 * 24 * 3600,
  refreshTtlWebSec: 12 * 3600,
  refreshRaceWindowMs: 10_000,
  ambiguityWindowMs: 60_000,
  /** Umbral de NOT_SYNCED_RECENTLY (propuesta del contrato: 72 h). */
  readinessStaleMs: Number(process.env["READINESS_STALE_HOURS"] ?? 72) * 3600_000,
  /** RN-03: pasado este plazo la disponibilidad se marca desactualizada (nunca cambia el estado). */
  availabilityStaleMs: Number(process.env["AVAILABILITY_STALE_HOURS"] ?? 4) * 3600_000,
};
