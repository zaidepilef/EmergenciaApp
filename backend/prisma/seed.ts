// Datos DEMO para la base local. Borra y vuelve a crear todos los datos de
// emergencia_dev (no toca el esquema ni las migraciones).
//
//   npm run db:seed
//
// Se niega a correr si DATABASE_URL no apunta a localhost.
import { computeRutVerifier } from "@emergencia/shared/rut";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { hashPassword } from "../src/auth/password.js";
import { uuidv7 } from "../src/ids.js";

const host = new URL(config.databaseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`seed: DATABASE_URL apunta a ${host}; solo se permite una base local.`);
  process.exit(1);
}

const DEMO_PASSWORD = process.env["DEMO_PASSWORD"] ?? "Brigada2026!";
const rut = (body: number) => `${body}-${computeRutVerifier(body)}`;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

// Usuario de prueba del dueño del proyecto (pedido explícito, 2026-11-16).
const OWNER = { rut: "16200587-1", fullName: "Felipe Díaz", email: "fel.di.rod@gmail.com" };

/**
 * Escenario de llegada del aviso de activación para cada brigadista ficticio:
 * - opened:   teléfono con push válido, lo abrió (acuse OPENED)
 * - received: push válido, llegó al teléfono (acuse RECEIVED) pero no lo abrió
 * - accepted: el proveedor aceptó el push, sin acuse del teléfono
 * - sending:  push en cola
 * - failed:   token rechazado por el proveedor
 * - disabled: teléfono registrado sin permiso de notificaciones
 * - none:     sin teléfono registrado
 */
type Push = "opened" | "received" | "accepted" | "sending" | "failed" | "disabled" | "none";
interface Seeded {
  body: number;
  name: string;
  phone: string;
  push: Push;
  answer?: ["VOY" | "NO_PUEDO", number]; // respuesta y minutos tras la activación
  /** Disponibilidad declarada y hace cuántos minutos (más de 240 = desactualizada). Sin teléfono no hay declaración. */
  availability?: ["DISPONIBLE" | "NO_DISPONIBLE" | "EN_SERVICIO", number];
}
const BRIGADISTAS: Seeded[] = [
  { body: 17345120, name: "Joaquín Muñoz", phone: "+56 9 5123 4401", push: "opened", answer: ["VOY", 2], availability: ["DISPONIBLE", 40] },
  { body: 18456231, name: "Valentina Soto", phone: "+56 9 5123 4402", push: "opened", answer: ["VOY", 3], availability: ["DISPONIBLE", 95] },
  { body: 15567342, name: "Matías González", phone: "+56 9 5123 4403", push: "opened", answer: ["NO_PUEDO", 4], availability: ["NO_DISPONIBLE", 130] },
  { body: 19678453, name: "Francisca Díaz", phone: "+56 9 5123 4404", push: "opened", answer: ["VOY", 5], availability: ["EN_SERVICIO", 70] },
  { body: 16789564, name: "Benjamín Pérez", phone: "+56 9 5123 4405", push: "accepted", availability: ["DISPONIBLE", 320] },
  { body: 20890675, name: "Antonia Herrera", phone: "+56 9 5123 4406", push: "opened", answer: ["VOY", 7], availability: ["DISPONIBLE", 55] },
  { body: 14901786, name: "Tomás Castillo", phone: "+56 9 5123 4407", push: "failed", availability: ["NO_DISPONIBLE", 600] },
  { body: 18012897, name: "Isidora Morales", phone: "+56 9 5123 4408", push: "opened", answer: ["NO_PUEDO", 8], availability: ["NO_DISPONIBLE", 45] },
  { body: 17123908, name: "Vicente Araya", phone: "+56 9 5123 4409", push: "received", availability: ["DISPONIBLE", 200] },
  { body: 19234019, name: "Josefa Fuentes", phone: "+56 9 5123 4410", push: "opened", answer: ["VOY", 11], availability: ["NO_DISPONIBLE", 30] },
  { body: 16345120, name: "Agustín Reyes", phone: "+56 9 5123 4411", push: "none" },
  { body: 20456231, name: "Florencia Vargas", phone: "+56 9 5123 4412", push: "sending", availability: ["EN_SERVICIO", 380] },
  { body: 15567343, name: "Martín Espinoza", phone: "+56 9 5123 4413", push: "opened", answer: ["VOY", 12], availability: ["DISPONIBLE", 150] },
  { body: 12987654, name: "Camila Rojas", phone: "+56 9 5123 4414", push: "disabled", availability: ["NO_DISPONIBLE", 90] },
];

async function main() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE notice_ack, notification_delivery, manual_contact, sync_operation_resolution,
             emergency_response, emergency_recipient, emergency_notice, emergency,
             sync_operation, availability_change, brigadista_profile, auth_session,
             device, user_role, audit_log, app_user
    RESTART IDENTITY CASCADE`);

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();

  const createUser = (rutValue: string, fullName: string, email: string | null) =>
    prisma.appUser.create({
      data: { rut: rutValue, fullName, email, passwordHash, mustChangePassword: false, passwordChangedAt: now },
    });
  const createProfile = (userId: string, phone: string) =>
    prisma.brigadistaProfile.create({ data: { userId, phone, availabilityDeclaredAt: now } });

  // Dueño: administrador, coordinador y brigadista. Sin teléfono hasta que inicie sesión en la app.
  const owner = await createUser(OWNER.rut, OWNER.fullName, OWNER.email);
  await prisma.userRole.createMany({
    data: [
      { userId: owner.id, role: "ADMINISTRADOR" },
      { userId: owner.id, role: "COORDINADOR" },
    ],
  });
  const ownerProfile = await createProfile(owner.id, "+56 9 1111 2222");

  // Coordinadora (no brigadista).
  const coord = await createUser(rut(13579246), "Marcela Fuentes", null);
  await prisma.userRole.create({ data: { userId: coord.id, role: "COORDINADOR", grantedById: owner.id } });

  // Convocatoria activa con aviso de activación y uno de actualización.
  const activatedAt = minutesAgo(25);
  const emergency = await prisma.emergency.create({
    data: {
      emergencyType: "Incendio forestal",
      meetingPoint: "Cuartel 2, Av. Los Aromos 1450",
      scheduledAt: activatedAt,
      instructions: "Llevar equipo de protección personal completo y radio cargada. Presentarse al jefe de turno.",
      status: "ACTIVE",
      createdById: coord.id,
      activatedById: coord.id,
      activatedAt,
    },
  });
  const activation = await prisma.emergencyNotice.create({
    data: { emergencyId: emergency.id, kind: "ACTIVATION", message: "Incendio forestal en Sector Cerro La Cruz", createdById: coord.id, createdAt: activatedAt },
  });
  await prisma.emergencyNotice.create({
    data: { emergencyId: emergency.id, kind: "UPDATE", message: "Cambió el punto de encuentro. Antes: Cuartel 1.", createdById: coord.id, createdAt: minutesAgo(16) },
  });

  // R1: todos los brigadistas activos quedan convocados.
  await prisma.emergencyRecipient.create({
    data: { emergencyId: emergency.id, brigadistaId: ownerProfile.id, addedReason: "ACTIVATION", convokedAt: activatedAt },
  });

  const later = (m: number) => new Date(activatedAt.getTime() + m * 60_000);
  for (const [i, b] of BRIGADISTAS.entries()) {
    const user = await createUser(rut(b.body), b.name, null);
    const profile = await createProfile(user.id, b.phone);
    const recipient = await prisma.emergencyRecipient.create({
      data: { emergencyId: emergency.id, brigadistaId: profile.id, addedReason: "ACTIVATION", convokedAt: activatedAt },
    });
    if (b.push === "none") continue;

    const token = `ExponentPushToken[demo-${i}]`;
    const tokenStatus = b.push === "failed" ? "INVALID" : b.push === "disabled" ? null : "VALID";
    const device = await prisma.device.create({
      data: {
        id: uuidv7(),
        userId: user.id,
        platform: i % 3 === 0 ? "IOS" : "ANDROID",
        appVersion: "demo",
        lastSeenAt: later(1 + (i % 4)),
        pushToken: tokenStatus ? token : null,
        pushTokenStatus: tokenStatus,
        pushTokenUpdatedAt: tokenStatus ? activatedAt : null,
      },
    });

    // Entrega push del aviso de activación (hechos del proveedor).
    const sent = later(0.1);
    const delivery = {
      opened: { status: "PROVIDER_DELIVERED", sentAt: sent, providerAcceptedAt: sent, providerDeliveredAt: later(0.2) },
      received: { status: "PROVIDER_DELIVERED", sentAt: sent, providerAcceptedAt: sent, providerDeliveredAt: later(0.2) },
      accepted: { status: "PROVIDER_ACCEPTED", sentAt: sent, providerAcceptedAt: sent },
      sending: { status: "QUEUED", nextAttemptAt: now },
      failed: { status: "FAILED", sentAt: sent, failedAt: later(0.2), lastErrorCode: "DeviceNotRegistered" },
      disabled: null,
    }[b.push];
    if (delivery) {
      await prisma.notificationDelivery.create({
        data: { noticeId: activation.id, recipientId: recipient.id, channel: "PUSH", deviceId: device.id, attempts: 1, ...delivery } as never,
      });
    }

    // Hechos del teléfono: cada uno nace de una operación de sincronización.
    let seq = 0;
    const op = async (type: string, payload: object, at: Date, base: bigint | null) => {
      const operationId = uuidv7();
      seq++;
      await prisma.syncOperation.create({
        data: { operationId, deviceId: device.id, userId: user.id, deviceSeq: BigInt(seq), operationType: type, payload, baseRowVersion: base, entityId: operationId, result: "APPLIED", receivedAt: at },
      });
      await prisma.device.update({ where: { id: device.id }, data: { lastDeviceSeq: BigInt(seq) } });
      return operationId;
    };
    const ack = async (level: "RECEIVED" | "OPENED", at: Date) => {
      const payload = level === "RECEIVED" ? { noticeId: activation.id, recipientId: recipient.id, level, via: "PUSH" } : { noticeId: activation.id, recipientId: recipient.id, level };
      const operationId = await op("ACK_NOTICE", payload, at, null);
      await prisma.noticeAck.create({
        data: { id: operationId, noticeId: activation.id, recipientId: recipient.id, deviceId: device.id, level, via: level === "RECEIVED" ? "PUSH" : null, ackedAtDevice: at, receivedAt: at, operationId },
      });
    };
    // Disponibilidad declarada antes de la convocatoria (independiente de la respuesta: RN-09).
    if (b.availability) {
      const [status, ago] = b.availability;
      const at = minutesAgo(ago);
      const current = await prisma.brigadistaProfile.findUniqueOrThrow({ where: { id: profile.id } });
      const operationId = await op("DECLARE_AVAILABILITY", { status }, at, current.rowVersion);
      await prisma.availabilityChange.create({
        data: {
          id: operationId,
          brigadistaId: profile.id,
          status,
          source: "APP",
          declaredAt: at,
          estimatedAt: at,
          timeConfidence: "MONOTONIC",
          receivedAt: at,
          deviceId: device.id,
          deviceSeq: BigInt(seq),
          baseRowVersion: current.rowVersion,
          syncResult: "APPLIED",
        },
      });
      await prisma.brigadistaProfile.update({
        where: { id: profile.id },
        data: { availabilityStatus: status, availabilityDeclaredAt: at, lastAvailabilityChangeId: operationId },
      });
    }

    if (b.push === "opened" || b.push === "received") await ack("RECEIVED", later(0.3));
    if (b.push === "opened") await ack("OPENED", later(1));

    if (b.answer) {
      const [value, minutesAfter] = b.answer;
      const at = later(minutesAfter);
      const current = await prisma.emergencyRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
      const operationId = await op("RESPOND_EMERGENCY", { recipientId: recipient.id, response: value }, at, current.rowVersion);
      await prisma.emergencyResponse.create({
        data: {
          id: operationId,
          recipientId: recipient.id,
          response: value,
          source: "APP",
          channel: "APP",
          declaredAt: at,
          estimatedAt: at,
          timeConfidence: "MONOTONIC",
          receivedAt: at,
          deviceId: device.id,
          deviceSeq: BigInt(seq),
          baseRowVersion: current.rowVersion,
          syncResult: "APPLIED",
        },
      });
      await prisma.emergencyRecipient.update({
        where: { id: recipient.id },
        data: { currentResponse: value, currentResponseId: operationId, respondedAt: at },
      });
    }
  }

  console.log(`seed: ${BRIGADISTAS.length + 1} brigadistas convocados a "${emergency.emergencyType}".`);
  console.log(`seed: usuario de prueba ${OWNER.rut}; contraseña de todos: ${process.env["DEMO_PASSWORD"] ? "(DEMO_PASSWORD)" : DEMO_PASSWORD}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
