type ServerEnvKey = "MONGODB_URI" | "MONGODB_DB" | "AUTH_SECRET";

export type ServerEnv = Record<ServerEnvKey, string>;

export const DEFAULT_MONGODB_DB = "brigada_emergencias";
export const MIN_AUTH_SECRET_LENGTH = 32;

const MONGODB_URI_PATTERN = /^mongodb(?:\+srv)?:\/\/[^\s]+$/;

export function readServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const mongodbUri = source.MONGODB_URI?.trim();
  const mongodbDb = source.MONGODB_DB?.trim() || DEFAULT_MONGODB_DB;
  const authSecret = source.AUTH_SECRET?.trim();

  const missing: ServerEnvKey[] = [];
  if (!mongodbUri) missing.push("MONGODB_URI");
  if (!authSecret) missing.push("AUTH_SECRET");

  if (!mongodbUri || !authSecret) {
    throw new Error(
      `Faltan variables de entorno del servidor: ${missing.join(", ")}. Copiá .env.example a .env.local.`,
    );
  }

  if (!MONGODB_URI_PATTERN.test(mongodbUri)) {
    throw new Error(
      "MONGODB_URI debe comenzar con mongodb:// o mongodb+srv:// y no contener espacios.",
    );
  }

  if (authSecret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(
      `AUTH_SECRET debe tener al menos ${MIN_AUTH_SECRET_LENGTH} caracteres. Generá uno con "npx auth secret".`,
    );
  }

  return {
    MONGODB_URI: mongodbUri,
    MONGODB_DB: mongodbDb,
    AUTH_SECRET: authSecret,
  };
}
