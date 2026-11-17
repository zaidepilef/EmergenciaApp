import Fastify, { type FastifyError } from "fastify";
import { Ajv } from "ajv";
import addFormatsModule from "ajv-formats";
import { prisma } from "./db.js";
import { ApiError, sendProblem } from "./http/problem.js";
import { uuidv7 } from "./ids.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { brigadistaRoutes } from "./routes/brigadista.js";
import { syncPushRoutes } from "./routes/sync-push.js";
import { coordinatorRoutes } from "./routes/coordinator.js";
import { adminRoutes } from "./routes/admin.js";

// Cuerpos JSON estrictos (sin coerción). Querystring y parámetros de ruta llegan
// siempre como texto: ahí sí se convierten tipos (`?limit=2`, `?active=false`).
const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;
const ajvOptions = { removeAdditional: false, allErrors: true, useDefaults: true } as const;
const strictAjv = addFormats(new Ajv({ ...ajvOptions, coerceTypes: false }));
const coercingAjv = addFormats(new Ajv({ ...ajvOptions, coerceTypes: true }));

export function buildApp() {
  const app = Fastify({
    logger: { level: process.env["LOG_LEVEL"] ?? "info", redact: ["req.headers.authorization", "req.body.password"] },
    genReqId: () => uuidv7(),
    bodyLimit: 64 * 1024,
  });
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === "querystring" || httpPart === "params" ? coercingAjv : strictAjv).compile(schema),
  );

  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Request-Id", req.id);
  });

  app.setErrorHandler((err: FastifyError | ApiError, req, reply) => {
    if (err instanceof ApiError) return sendProblem(req, reply, err);
    if ("validation" in err && err.validation) {
      return sendProblem(
        req,
        reply,
        new ApiError(
          400,
          "VALIDATION_ERROR",
          "Entrada inválida",
          err.validation.map((v) => ({ field: v.instancePath || "/", code: v.keyword, ...(v.message ? { message: v.message } : {}) })),
        ),
      );
    }
    if (err.statusCode === 413) return sendProblem(req, reply, new ApiError(413, "PAYLOAD_TOO_LARGE", "Lote demasiado grande"));
    if (err.statusCode === 400) return sendProblem(req, reply, new ApiError(400, "VALIDATION_ERROR", "Entrada inválida"));
    req.log.error({ err }, "error no controlado");
    return sendProblem(req, reply, new ApiError(500, "INTERNAL_ERROR", "Error interno"));
  });

  app.setNotFoundHandler((req, reply) => sendProblem(req, reply, new ApiError(404, "NOT_FOUND", "No existe")));

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      reply.header("Retry-After", "5");
      return sendProblem(req, reply, new ApiError(503, "SERVICE_UNAVAILABLE", "La base no responde"));
    }
  });

  app.register(authRoutes);
  app.register(meRoutes);
  app.register(brigadistaRoutes);
  app.register(syncPushRoutes);
  app.register(coordinatorRoutes);
  app.register(adminRoutes);
  return app;
}
