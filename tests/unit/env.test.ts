import { describe, expect, it } from "vitest";
import { readPublicEnv } from "@/lib/env";

describe("readPublicEnv", () => {
  it("devuelve las variables públicas requeridas", () => {
    expect(
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
  });

  it("recorta espacios en los valores", () => {
    expect(
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "  http://127.0.0.1:54321  ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "  anon-key  ",
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
  });

  it("lanza un error que indica las variables faltantes", () => {
    expect(() => readPublicEnv({})).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => readPublicEnv({})).toThrowError(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("considera inválido un valor vacío", () => {
    expect(() =>
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "   ",
      }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
