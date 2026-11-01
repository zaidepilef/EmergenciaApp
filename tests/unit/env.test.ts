import { describe, expect, it } from "vitest";
import { DEFAULT_MONGODB_DB, readServerEnv } from "@/lib/env";

const validSecret = "a".repeat(32);
const validUri = "mongodb+srv://app:secret@cluster.example.mongodb.net/?retryWrites=true";

describe("readServerEnv", () => {
  it("devuelve las variables del servidor y usa la base por defecto", () => {
    expect(
      readServerEnv({
        MONGODB_URI: validUri,
        AUTH_SECRET: validSecret,
      }),
    ).toEqual({
      MONGODB_URI: validUri,
      MONGODB_DB: DEFAULT_MONGODB_DB,
      AUTH_SECRET: validSecret,
    });
  });

  it("recorta espacios y respeta una base configurada", () => {
    expect(
      readServerEnv({
        MONGODB_URI: `  ${validUri}  `,
        MONGODB_DB: "  brigada_dev  ",
        AUTH_SECRET: `  ${validSecret}  `,
      }),
    ).toEqual({
      MONGODB_URI: validUri,
      MONGODB_DB: "brigada_dev",
      AUTH_SECRET: validSecret,
    });
  });

  it("lanza un error que indica las variables faltantes", () => {
    expect(() => readServerEnv({})).toThrowError(/MONGODB_URI/);
    expect(() => readServerEnv({})).toThrowError(/AUTH_SECRET/);
  });

  it("considera inválido un valor vacío", () => {
    expect(() =>
      readServerEnv({
        MONGODB_URI: "   ",
        AUTH_SECRET: "   ",
      }),
    ).toThrowError(/MONGODB_URI, AUTH_SECRET/);
  });

  it("rechaza una URI que no es de MongoDB", () => {
    expect(() =>
      readServerEnv({
        MONGODB_URI: "postgresql://localhost:5432/brigada",
        AUTH_SECRET: validSecret,
      }),
    ).toThrowError(/mongodb:\/\//);
  });

  it("rechaza una URI con espacios", () => {
    expect(() =>
      readServerEnv({
        MONGODB_URI: "mongodb://localhost:27017 brigada",
        AUTH_SECRET: validSecret,
      }),
    ).toThrowError(/espacios/);
  });

  it("rechaza un secreto demasiado corto", () => {
    expect(() =>
      readServerEnv({
        MONGODB_URI: validUri,
        AUTH_SECRET: "corto",
      }),
    ).toThrowError(/al menos 32 caracteres/);
  });

  it("acepta una URI local de MongoDB", () => {
    expect(
      readServerEnv({
        MONGODB_URI: "mongodb://127.0.0.1:27017",
        AUTH_SECRET: validSecret,
      }).MONGODB_URI,
    ).toBe("mongodb://127.0.0.1:27017");
  });
});
