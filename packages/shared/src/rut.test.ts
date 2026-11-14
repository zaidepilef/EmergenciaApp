import { describe, expect, it } from "vitest";
import {
  CANONICAL_RUT_PATTERN,
  computeRutVerifier,
  formatRut,
  isCanonicalRut,
  isValidRut,
  maskRut,
  normalizeRut,
  parseRut,
} from "./rut.js";

// RUT sintéticos: se eligieron por su dígito verificador, no corresponden a
// personas conocidas. Nunca usar RUT reales en pruebas.

describe("computeRutVerifier", () => {
  it.each([
    ["12345678", "5"],
    ["11111111", "1"],
    ["22222222", "2"],
    ["10000013", "K"],
    ["1", "9"],
    ["99999999", "9"],
  ])("cuerpo %s → %s", (body, verifier) => {
    expect(computeRutVerifier(body)).toBe(verifier);
  });

  it("produce 0 cuando el resto es 11", () => {
    const body = findBodyWithVerifier("0");
    expect(computeRutVerifier(body)).toBe("0");
  });

  it("acepta un número", () => {
    expect(computeRutVerifier(12345678)).toBe("5");
  });

  it("ignora ceros a la izquierda", () => {
    expect(computeRutVerifier("0012345678")).toBe("5");
  });

  it.each(["", "0", "000", "123456789", "12.345", "12a", "-1"])("rechaza %j", (body) => {
    expect(() => computeRutVerifier(body)).toThrow(RangeError);
  });
});

describe("parseRut / normalizeRut", () => {
  it.each([
    ["12.345.678-5", "12345678-5"],
    ["12345678-5", "12345678-5"],
    ["123456785", "12345678-5"],
    ["  12.345.678-5  ", "12345678-5"],
    ["10.000.013-k", "10000013-K"],
    ["10000013K", "10000013-K"],
    ["0012345678-5", "12345678-5"],
    ["1-9", "1-9"],
    ["19", "1-9"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeRut(input)).toBe(expected);
  });

  it("devuelve cuerpo y verificador por separado", () => {
    expect(parseRut("12.345.678-5")).toEqual({
      ok: true,
      rut: "12345678-5",
      body: 12345678,
      verifier: "5",
    });
  });

  it.each(["", "   ", "\t"])("vacío %j → RUT_EMPTY", (input) => {
    expect(parseRut(input)).toEqual({ ok: false, error: "RUT_EMPTY" });
  });

  it.each([
    "12.345.678-",
    "-5",
    "5",
    "1.2345.678-5", // puntos mal agrupados
    "12.345678-5", // agrupación mixta
    "12 345 678-5", // espacios internos
    "12345678--5",
    "12345678-55",
    "12345678-X",
    "123456789-0", // 9 dígitos
    "0-0",
    "00-0",
    "12,345,678-5",
    "abc",
  ])("formato inválido %j → RUT_INVALID_FORMAT", (input) => {
    expect(parseRut(input)).toEqual({ ok: false, error: "RUT_INVALID_FORMAT" });
  });

  it.each(["12.345.678-4", "12345678-K", "10000013-0", "1-0"])(
    "verificador incorrecto %j → RUT_INVALID_VERIFIER",
    (input) => {
      expect(parseRut(input)).toEqual({ ok: false, error: "RUT_INVALID_VERIFIER" });
    },
  );

  it("isValidRut coincide con parseRut", () => {
    expect(isValidRut("12.345.678-5")).toBe(true);
    expect(isValidRut("12.345.678-4")).toBe(false);
  });
});

describe("forma canónica y restricción de la base", () => {
  it("toda salida de normalizeRut cumple app_user_rut_format_chk", () => {
    for (let body = 1; body <= 99_999_999; body += 104_729) {
      const rut = normalizeRut(`${body}${computeRutVerifier(body)}`);
      expect(rut).not.toBeNull();
      expect(CANONICAL_RUT_PATTERN.test(rut!)).toBe(true);
    }
  });

  it("isCanonicalRut exige la forma exacta", () => {
    expect(isCanonicalRut("12345678-5")).toBe(true);
    expect(isCanonicalRut("10000013-K")).toBe(true);
    expect(isCanonicalRut("10000013-k")).toBe(false);
    expect(isCanonicalRut("12.345.678-5")).toBe(false);
    expect(isCanonicalRut("012345678-5")).toBe(false);
    expect(isCanonicalRut("12345678-4")).toBe(false);
  });

  it("normalizar dos veces da lo mismo", () => {
    const once = normalizeRut("10.000.013-k")!;
    expect(normalizeRut(once)).toBe(once);
  });
});

describe("formatRut", () => {
  it.each([
    ["12345678-5", "12.345.678-5"],
    ["10000013k", "10.000.013-K"],
    ["1-9", "1-9"],
  ])("%j → %j", (input, expected) => {
    expect(formatRut(input)).toBe(expected);
  });

  it("agrupa un cuerpo de 4 dígitos", () => {
    const verifier = computeRutVerifier(1000);
    expect(formatRut(`1000-${verifier}`)).toBe(`1.000-${verifier}`);
  });

  it("rechaza un RUT inválido", () => {
    expect(() => formatRut("12345678-4")).toThrow(TypeError);
  });
});

describe("maskRut", () => {
  it.each([
    ["12.345.678-5", "12.***.***-5"],
    ["10000013-K", "10.***.***-K"],
  ])("%j → %j", (input, expected) => {
    expect(maskRut(input)).toBe(expected);
  });

  it("un cuerpo de un solo grupo se oculta completo", () => {
    expect(maskRut("1-9")).toBe("***-9");
  });

  it("nunca deja ver los dígitos centrales", () => {
    const masked = maskRut("12.345.678-5");
    expect(masked).not.toContain("345");
    expect(masked).not.toContain("678");
  });

  it("rechaza un RUT inválido", () => {
    expect(() => maskRut("abc")).toThrow(TypeError);
  });
});

function findBodyWithVerifier(verifier: string): string {
  for (let body = 1_000_000; body < 1_000_100; body++) {
    if (computeRutVerifier(body) === verifier) return String(body);
  }
  throw new Error(`Sin cuerpo con verificador ${verifier} en el rango de prueba`);
}
