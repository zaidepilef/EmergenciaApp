import type { FastifyReply, FastifyRequest } from "fastify";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "PASSWORD_CHANGE_REQUIRED"
  | "MOBILE_SESSION_REQUIRED"
  | "DEVICE_REVOKED"
  | "DEVICE_ID_CONFLICT"
  | "DEVICE_SEQ_CONFLICT"
  | "REFRESH_RACE"
  | "NOT_FOUND"
  | "IDEMPOTENCY_KEY_REUSED"
  | "EMERGENCY_ALREADY_ACTIVE"
  | "EMERGENCY_NOT_ACTIVE"
  | "EMERGENCY_CLOSED"
  | "USER_INACTIVE"
  | "RUT_ALREADY_EXISTS"
  | "EMAIL_ALREADY_EXISTS"
  | "LAST_ADMIN"
  | "CANNOT_DEACTIVATE_SELF"
  | "PASSWORD_POLICY"
  | "PASSWORD_REUSED"
  | "CURRENT_PASSWORD_INVALID"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface FieldError {
  field: string;
  code: string;
  message?: string;
}

/** Error de negocio que termina en application/problem+json (RFC 9457). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly title: string,
    readonly errors?: FieldError[],
  ) {
    super(title);
  }
}

export function sendProblem(req: FastifyRequest, reply: FastifyReply, err: ApiError) {
  return reply
    .status(err.status)
    .type("application/problem+json")
    .send({
      type: "about:blank",
      title: err.title,
      status: err.status,
      code: err.code,
      requestId: req.id,
      ...(err.errors ? { errors: err.errors } : {}),
    });
}
