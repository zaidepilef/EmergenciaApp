import { hash, verify } from "@node-rs/argon2";

// argon2id (Algorithm.Argon2id = 2) con parámetros OWASP.
const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// Hash de una contraseña que nadie conoce: igualar el tiempo cuando el RUT no existe.
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(`no-user-${Math.random()}`);
  return dummy;
}
