/**
 * Validación y formato del RUT chileno (Rol Único Tributario).
 *
 * Forma canónica (la que guarda la base, `app_user_rut_format_chk`):
 * cuerpo sin puntos ni ceros a la izquierda, guion y dígito verificador con
 * `K` mayúscula. Ejemplo: `12345678-5`.
 *
 * Este módulo no tiene dependencias y es el mismo en backend, web y mobile.
 * La regla vale para los tres, pero **solo el servidor decide**: los clientes
 * validan para dar un mensaje temprano, nunca como control de acceso.
 */

/** Cuerpo máximo admitido: 8 dígitos (hasta 99.999.999). */
export const RUT_MAX_BODY_DIGITS = 8;

/** Expresión de la forma canónica. Igual a la restricción CHECK de PostgreSQL. */
export const CANONICAL_RUT_PATTERN = /^[1-9][0-9]{0,7}-[0-9K]$/;

/**
 * Formas de entrada aceptadas (antes de normalizar):
 * - con puntos bien agrupados: `12.345.678-5`, `1.234.567-K`
 * - sin puntos, con o sin guion: `12345678-5`, `123456785`
 * - `k` minúscula, espacios al inicio y al final, ceros a la izquierda.
 *
 * Se rechazan puntos mal agrupados (`1.2345.678-5`), espacios internos y
 * cualquier otro carácter.
 */
const INPUT_PATTERN = /^(?:(\d{1,3}(?:\.\d{3})+)|(\d+?))-?([\dkK])$/;

export type RutErrorCode =
  /** Vacío o solo espacios. */
  | "RUT_EMPTY"
  /** Caracteres o agrupación inválidos, o cuerpo fuera de rango. */
  | "RUT_INVALID_FORMAT"
  /** El dígito verificador no corresponde al cuerpo. */
  | "RUT_INVALID_VERIFIER";

export type RutParseResult =
  | { ok: true; rut: string; body: number; verifier: string }
  | { ok: false; error: RutErrorCode };

/**
 * Calcula el dígito verificador (módulo 11) de un cuerpo de RUT.
 *
 * @param body Dígitos del cuerpo, sin puntos ni dígito verificador.
 * @returns `"0"`–`"9"` o `"K"`.
 * @throws {RangeError} si `body` no son solo dígitos o excede 8 dígitos significativos.
 */
export function computeRutVerifier(body: string | number): string {
  const digits = typeof body === "number" ? String(body) : body;
  if (!/^\d+$/.test(digits)) {
    throw new RangeError("El cuerpo del RUT debe contener solo dígitos");
  }
  const significant = digits.replace(/^0+/, "");
  if (significant.length === 0 || significant.length > RUT_MAX_BODY_DIGITS) {
    throw new RangeError("Cuerpo de RUT fuera de rango");
  }

  let sum = 0;
  let factor = 2;
  for (let i = significant.length - 1; i >= 0; i--) {
    sum += Number(significant[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const result = 11 - (sum % 11);
  if (result === 11) return "0";
  if (result === 10) return "K";
  return String(result);
}

/**
 * Analiza un RUT escrito por una persona y lo lleva a la forma canónica.
 * Distingue el motivo del rechazo para que la interfaz pueda explicarlo.
 */
export function parseRut(input: string): RutParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, error: "RUT_EMPTY" };

  const match = INPUT_PATTERN.exec(trimmed);
  if (!match) return { ok: false, error: "RUT_INVALID_FORMAT" };

  const rawBody = (match[1] ?? match[2] ?? "").replaceAll(".", "");
  const verifier = (match[3] ?? "").toUpperCase();
  const body = rawBody.replace(/^0+/, "");

  if (body.length === 0 || body.length > RUT_MAX_BODY_DIGITS) {
    return { ok: false, error: "RUT_INVALID_FORMAT" };
  }
  if (computeRutVerifier(body) !== verifier) {
    return { ok: false, error: "RUT_INVALID_VERIFIER" };
  }
  return { ok: true, rut: `${body}-${verifier}`, body: Number(body), verifier };
}

/** Forma canónica (`12345678-5`) o `null` si el RUT no es válido. */
export function normalizeRut(input: string): string | null {
  const parsed = parseRut(input);
  return parsed.ok ? parsed.rut : null;
}

/** `true` si el RUT tiene formato válido y su dígito verificador corresponde. */
export function isValidRut(input: string): boolean {
  return parseRut(input).ok;
}

/** `true` si el texto ya está exactamente en forma canónica y es válido. */
export function isCanonicalRut(value: string): boolean {
  return CANONICAL_RUT_PATTERN.test(value) && normalizeRut(value) === value;
}

/**
 * Formato para mostrar: `12.345.678-5`.
 * @throws {TypeError} si el RUT no es válido.
 */
export function formatRut(input: string): string {
  const parsed = requireValid(input);
  return `${groupThousands(String(parsed.body))}-${parsed.verifier}`;
}

/**
 * Enmascarado para logs y auditoría: conserva el primer grupo y el dígito
 * verificador (`12.***.***-5`). No permite reconstruir el RUT.
 * @throws {TypeError} si el RUT no es válido.
 */
export function maskRut(input: string): string {
  const parsed = requireValid(input);
  const [first, ...rest] = groupThousands(String(parsed.body)).split(".");
  // Un cuerpo de un solo grupo (< 1.000) se oculta completo.
  const masked = rest.length === 0 ? "***" : [first, ...rest.map(() => "***")].join(".");
  return `${masked}-${parsed.verifier}`;
}

function requireValid(input: string): { body: number; verifier: string } {
  const parsed = parseRut(input);
  if (!parsed.ok) throw new TypeError(`RUT inválido (${parsed.error})`);
  return parsed;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
