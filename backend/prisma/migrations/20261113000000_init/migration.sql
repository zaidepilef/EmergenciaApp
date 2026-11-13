-- Migración inicial de EmergenciaApp (PostgreSQL 18).
-- Parte 1 generada con: prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
-- Parte 2: SQL manual al final del archivo.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "app_role" AS ENUM ('ADMINISTRADOR', 'COORDINADOR');

-- CreateEnum
CREATE TYPE "availability_status" AS ENUM ('DISPONIBLE', 'NO_DISPONIBLE', 'EN_SERVICIO');

-- CreateEnum
CREATE TYPE "emergency_status" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "notice_kind" AS ENUM ('ACTIVATION', 'UPDATE', 'CLOSURE', 'REOPEN');

-- CreateEnum
CREATE TYPE "response_value" AS ENUM ('VOY', 'NO_PUEDO');

-- CreateEnum
CREATE TYPE "action_source" AS ENUM ('APP', 'WEB', 'COORDINATOR_PROXY');

-- CreateEnum
CREATE TYPE "contact_channel" AS ENUM ('APP', 'PHONE_CALL', 'RADIO', 'IN_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "contact_outcome" AS ENUM ('ANSWERED', 'NO_ANSWER', 'MESSAGE_LEFT');

-- CreateEnum
CREATE TYPE "recipient_reason" AS ENUM ('ACTIVATION', 'LATE_ADDITION');

-- CreateEnum
CREATE TYPE "delivery_channel" AS ENUM ('PUSH');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('QUEUED', 'SENT', 'PROVIDER_ACCEPTED', 'PROVIDER_DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "ack_level" AS ENUM ('RECEIVED', 'OPENED');

-- CreateEnum
CREATE TYPE "ack_via" AS ENUM ('PUSH', 'SYNC');

-- CreateEnum
CREATE TYPE "device_platform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "push_token_status" AS ENUM ('VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "client_type" AS ENUM ('MOBILE', 'WEB');

-- CreateEnum
CREATE TYPE "session_scope" AS ENUM ('FULL', 'PASSWORD_CHANGE_ONLY');

-- CreateEnum
CREATE TYPE "time_confidence" AS ENUM ('MONOTONIC', 'CLOCK_OFFSET', 'SERVER_RECEIPT', 'HUMAN_DECLARED');

-- CreateEnum
CREATE TYPE "sync_result" AS ENUM ('APPLIED', 'SUPERSEDED', 'CONFLICT', 'REJECTED');

-- CreateEnum
CREATE TYPE "resolution_action" AS ENUM ('NOTE', 'CONFIRMED', 'CORRECTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "rut" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "password_expires_at" TIMESTAMPTZ(3),
    "credential_version" INTEGER NOT NULL DEFAULT 1,
    "password_changed_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "deactivated_at" TIMESTAMPTZ(3),
    "deactivated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "user_id" UUID NOT NULL,
    "role" "app_role" NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "device" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" "device_platform" NOT NULL,
    "push_token" TEXT,
    "push_token_status" "push_token_status",
    "push_token_updated_at" TIMESTAMPTZ(3),
    "app_version" TEXT,
    "os_version" TEXT,
    "last_device_seq" BIGINT NOT NULL DEFAULT 0,
    "last_clock_offset_ms" INTEGER,
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "client_type" "client_type" NOT NULL,
    "device_id" UUID,
    "scope" "session_scope" NOT NULL,
    "credential_version" INTEGER NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brigadista_profile" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT,
    "availability_status" "availability_status" NOT NULL DEFAULT 'NO_DISPONIBLE',
    "availability_declared_at" TIMESTAMPTZ(3) NOT NULL,
    "last_availability_change_id" UUID,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "brigadista_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_change" (
    "id" UUID NOT NULL,
    "brigadista_id" UUID NOT NULL,
    "status" "availability_status" NOT NULL,
    "source" "action_source" NOT NULL,
    "declared_at" TIMESTAMPTZ(3) NOT NULL,
    "estimated_at" TIMESTAMPTZ(3) NOT NULL,
    "time_confidence" "time_confidence" NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" UUID,
    "device_seq" BIGINT,
    "base_row_version" BIGINT,
    "created_offline" BOOLEAN NOT NULL DEFAULT false,
    "sync_result" "sync_result" NOT NULL,
    "row_version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "availability_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "emergency_type" TEXT NOT NULL,
    "meeting_point" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "instructions" TEXT,
    "status" "emergency_status" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "activated_by" UUID,
    "activated_at" TIMESTAMPTZ(3),
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "emergency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_notice" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "emergency_id" UUID NOT NULL,
    "kind" "notice_kind" NOT NULL,
    "message" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "emergency_notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_recipient" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "emergency_id" UUID NOT NULL,
    "brigadista_id" UUID NOT NULL,
    "added_reason" "recipient_reason" NOT NULL,
    "added_by" UUID,
    "convoked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_response" "response_value",
    "current_response_id" UUID,
    "responded_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "emergency_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_response" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "response" "response_value" NOT NULL,
    "source" "action_source" NOT NULL,
    "channel" "contact_channel" NOT NULL,
    "recorded_by" UUID,
    "declared_at" TIMESTAMPTZ(3) NOT NULL,
    "estimated_at" TIMESTAMPTZ(3) NOT NULL,
    "time_confidence" "time_confidence" NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" UUID,
    "device_seq" BIGINT,
    "base_row_version" BIGINT,
    "created_offline" BOOLEAN NOT NULL DEFAULT false,
    "late_sync_after_close" BOOLEAN NOT NULL DEFAULT false,
    "sync_result" "sync_result" NOT NULL,
    "corrects_operation_id" UUID,
    "row_version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "emergency_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "notice_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "channel" "delivery_channel" NOT NULL,
    "device_id" UUID NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "provider_accepted_at" TIMESTAMPTZ(3),
    "provider_delivered_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "provider_message_id" TEXT,
    "last_error_code" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notice_ack" (
    "id" UUID NOT NULL,
    "notice_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "level" "ack_level" NOT NULL,
    "via" "ack_via",
    "acked_at_device" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operation_id" UUID NOT NULL,

    CONSTRAINT "notice_ack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_contact" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "recipient_id" UUID NOT NULL,
    "channel" "contact_channel" NOT NULL,
    "outcome" "contact_outcome" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "manual_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operation" (
    "operation_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_seq" BIGINT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "base_row_version" BIGINT,
    "entity_id" UUID,
    "result" "sync_result" NOT NULL,
    "result_code" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_operation_pkey" PRIMARY KEY ("operation_id")
);

-- CreateTable
CREATE TABLE "sync_operation_resolution" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "operation_id" UUID NOT NULL,
    "action" "resolution_action" NOT NULL,
    "resolved_by" UUID NOT NULL,
    "resolved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "corrective_response_id" UUID,

    CONSTRAINT "sync_operation_resolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_metadata" (
    "id" SMALLINT NOT NULL,
    "sync_epoch" UUID NOT NULL,
    "epoch_started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_rut_key" ON "app_user"("rut");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "app_user_sync_idx" ON "app_user"("row_version");

-- CreateIndex
CREATE UNIQUE INDEX "device_push_token_uq" ON "device"("push_token");

-- CreateIndex
CREATE INDEX "device_user_idx" ON "device"("user_id") WHERE (revoked_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_refresh_token_hash_key" ON "auth_session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_session_user_active_idx" ON "auth_session"("user_id") WHERE (revoked_at IS NULL);

-- CreateIndex
CREATE INDEX "auth_session_family_idx" ON "auth_session"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "brigadista_profile_user_id_key" ON "brigadista_profile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "brigadista_profile_last_change_key" ON "brigadista_profile"("last_availability_change_id");

-- CreateIndex
CREATE INDEX "brigadista_panel_idx" ON "brigadista_profile"("availability_status", "availability_declared_at") WHERE (active);

-- CreateIndex
CREATE INDEX "brigadista_profile_sync_idx" ON "brigadista_profile"("row_version");

-- CreateIndex
CREATE INDEX "availability_history_idx" ON "availability_change"("brigadista_id", "estimated_at" DESC);

-- CreateIndex
CREATE INDEX "availability_sync_idx" ON "availability_change"("brigadista_id", "row_version");

-- CreateIndex
CREATE INDEX "emergency_recent_idx" ON "emergency"("created_at" DESC) WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "emergency_sync_idx" ON "emergency"("row_version") WHERE (status <> 'DRAFT');

-- CreateIndex
CREATE UNIQUE INDEX "emergency_one_active_uq" ON "emergency"("status") WHERE (status = 'ACTIVE');

-- CreateIndex
CREATE INDEX "emergency_notice_idx" ON "emergency_notice"("emergency_id", "created_at");

-- CreateIndex
CREATE INDEX "emergency_notice_sync_idx" ON "emergency_notice"("row_version");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_recipient_current_response_key" ON "emergency_recipient"("current_response_id");

-- CreateIndex
CREATE INDEX "recipient_counts_idx" ON "emergency_recipient"("emergency_id", "current_response");

-- CreateIndex
CREATE INDEX "recipient_sync_idx" ON "emergency_recipient"("brigadista_id", "row_version");

-- CreateIndex
CREATE UNIQUE INDEX "recipient_once_uq" ON "emergency_recipient"("emergency_id", "brigadista_id");

-- CreateIndex
CREATE INDEX "response_history_idx" ON "emergency_response"("recipient_id", "estimated_at" DESC);

-- CreateIndex
CREATE INDEX "response_sync_idx" ON "emergency_response"("recipient_id", "row_version");

-- CreateIndex
CREATE INDEX "delivery_retry_idx" ON "notification_delivery"("next_attempt_at") WHERE (status IN ('QUEUED', 'SENT', 'PROVIDER_ACCEPTED'));

-- CreateIndex
CREATE UNIQUE INDEX "delivery_once_uq" ON "notification_delivery"("notice_id", "recipient_id", "channel", "device_id");

-- CreateIndex
CREATE UNIQUE INDEX "notice_ack_operation_key" ON "notice_ack"("operation_id");

-- CreateIndex
CREATE INDEX "notice_ack_recipient_idx" ON "notice_ack"("recipient_id", "notice_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "notice_ack_once_uq" ON "notice_ack"("notice_id", "recipient_id", "device_id", "level");

-- CreateIndex
CREATE INDEX "manual_contact_idx" ON "manual_contact"("recipient_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "sync_operation_review_idx" ON "sync_operation"("received_at") WHERE (result IN ('CONFLICT', 'REJECTED'));

-- CreateIndex
CREATE UNIQUE INDEX "sync_operation_seq_uq" ON "sync_operation"("device_id", "device_seq");

-- CreateIndex
CREATE INDEX "resolution_operation_idx" ON "sync_operation_resolution"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "resolution_final_uq" ON "sync_operation_resolution"("operation_id") WHERE (action <> 'NOTE');

-- CreateIndex
CREATE INDEX "audit_log_time_idx" ON "audit_log"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actor_idx" ON "audit_log"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_entity_idx" ON "audit_log"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_deactivated_by_fkey" FOREIGN KEY ("deactivated_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "auth_session"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "brigadista_profile" ADD CONSTRAINT "brigadista_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "brigadista_profile" ADD CONSTRAINT "brigadista_profile_last_availability_change_id_fkey" FOREIGN KEY ("last_availability_change_id") REFERENCES "availability_change"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "availability_change" ADD CONSTRAINT "availability_change_brigadista_id_fkey" FOREIGN KEY ("brigadista_id") REFERENCES "brigadista_profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "availability_change" ADD CONSTRAINT "availability_change_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency" ADD CONSTRAINT "emergency_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency" ADD CONSTRAINT "emergency_activated_by_fkey" FOREIGN KEY ("activated_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency" ADD CONSTRAINT "emergency_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency_notice" ADD CONSTRAINT "emergency_notice_emergency_id_fkey" FOREIGN KEY ("emergency_id") REFERENCES "emergency"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency_notice" ADD CONSTRAINT "emergency_notice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency_recipient" ADD CONSTRAINT "emergency_recipient_emergency_id_fkey" FOREIGN KEY ("emergency_id") REFERENCES "emergency"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency_recipient" ADD CONSTRAINT "emergency_recipient_brigadista_id_fkey" FOREIGN KEY ("brigadista_id") REFERENCES "brigadista_profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency_recipient" ADD CONSTRAINT "emergency_recipient_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency_recipient" ADD CONSTRAINT "emergency_recipient_current_response_id_fkey" FOREIGN KEY ("current_response_id") REFERENCES "emergency_response"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency_response" ADD CONSTRAINT "emergency_response_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "emergency_recipient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency_response" ADD CONSTRAINT "emergency_response_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency_response" ADD CONSTRAINT "emergency_response_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "emergency_response" ADD CONSTRAINT "emergency_response_corrects_operation_id_fkey" FOREIGN KEY ("corrects_operation_id") REFERENCES "sync_operation"("operation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "emergency_notice"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "emergency_recipient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notice_ack" ADD CONSTRAINT "notice_ack_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "emergency_notice"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notice_ack" ADD CONSTRAINT "notice_ack_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "emergency_recipient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notice_ack" ADD CONSTRAINT "notice_ack_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notice_ack" ADD CONSTRAINT "notice_ack_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "sync_operation"("operation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "manual_contact" ADD CONSTRAINT "manual_contact_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "emergency_recipient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "manual_contact" ADD CONSTRAINT "manual_contact_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sync_operation" ADD CONSTRAINT "sync_operation_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sync_operation" ADD CONSTRAINT "sync_operation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sync_operation_resolution" ADD CONSTRAINT "sync_operation_resolution_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "sync_operation"("operation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sync_operation_resolution" ADD CONSTRAINT "sync_operation_resolution_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sync_operation_resolution" ADD CONSTRAINT "sync_operation_resolution_corrective_response_id_fkey" FOREIGN KEY ("corrective_response_id") REFERENCES "emergency_response"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ═══════════════════════════════════════════════════════════════════════════
-- SQL MANUAL — lo que Prisma no expresa.
-- Fuente: docs/database/postgresql/schema.md (revisión 2).
-- No editar el bloque generado por Prisma de arriba; los cambios futuros van en
-- migraciones nuevas.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Restricciones CHECK ────────────────────────────────────────────────

ALTER TABLE "app_user"
  ADD CONSTRAINT "app_user_rut_format_chk" CHECK (rut ~ '^[1-9][0-9]{0,7}-[0-9K]$'),
  ADD CONSTRAINT "app_user_email_lower_chk" CHECK (email IS NULL OR email = lower(email)),
  ADD CONSTRAINT "app_user_deactivation_chk" CHECK (active = (deactivated_at IS NULL)),
  ADD CONSTRAINT "app_user_provisional_chk" CHECK (must_change_password = (password_expires_at IS NOT NULL)),
  ADD CONSTRAINT "app_user_credential_version_chk" CHECK (credential_version >= 1);

ALTER TABLE "device"
  ADD CONSTRAINT "device_token_status_chk" CHECK ((push_token IS NULL) = (push_token_status IS NULL)),
  ADD CONSTRAINT "device_last_seq_chk" CHECK (last_device_seq >= 0);

ALTER TABLE "auth_session"
  ADD CONSTRAINT "auth_session_device_chk" CHECK (client_type <> 'MOBILE' OR device_id IS NOT NULL),
  ADD CONSTRAINT "auth_session_expiry_chk" CHECK (expires_at > created_at),
  ADD CONSTRAINT "auth_session_revoked_chk" CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  ADD CONSTRAINT "auth_session_reason_chk" CHECK (revoked_reason IS NULL OR revoked_reason IN
    ('LOGOUT', 'ROTATED', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'ACCOUNT_DEACTIVATED',
     'DEVICE_REVOKED', 'REUSE_DETECTED', 'EXPIRED'));

ALTER TABLE "brigadista_profile"
  ADD CONSTRAINT "brigadista_left_chk" CHECK (active = (left_at IS NULL));

ALTER TABLE "availability_change"
  ADD CONSTRAINT "availability_source_chk" CHECK (source <> 'COORDINATOR_PROXY'),
  ADD CONSTRAINT "availability_app_chk" CHECK (source <> 'APP' OR (device_id IS NOT NULL AND device_seq IS NOT NULL)),
  ADD CONSTRAINT "availability_result_chk" CHECK (sync_result <> 'REJECTED'),
  ADD CONSTRAINT "availability_time_chk" CHECK (estimated_at <= received_at);

ALTER TABLE "emergency"
  ADD CONSTRAINT "emergency_activation_chk" CHECK ((status = 'DRAFT') = (activated_at IS NULL)),
  ADD CONSTRAINT "emergency_activated_by_chk" CHECK ((activated_at IS NULL) = (activated_by IS NULL)),
  ADD CONSTRAINT "emergency_closed_chk" CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  ADD CONSTRAINT "emergency_closed_by_chk" CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  ADD CONSTRAINT "emergency_close_order_chk" CHECK (closed_at IS NULL OR closed_at >= activated_at),
  ADD CONSTRAINT "emergency_delete_chk" CHECK (deleted_at IS NULL OR status = 'DRAFT');

ALTER TABLE "emergency_recipient"
  ADD CONSTRAINT "recipient_response_chk" CHECK (
    (current_response IS NULL) = (current_response_id IS NULL)
    AND (current_response IS NULL) = (responded_at IS NULL)),
  ADD CONSTRAINT "recipient_added_chk" CHECK ((added_reason = 'LATE_ADDITION') = (added_by IS NOT NULL));

ALTER TABLE "emergency_response"
  ADD CONSTRAINT "response_proxy_chk" CHECK (
    source <> 'COORDINATOR_PROXY'
    OR (recorded_by IS NOT NULL AND channel <> 'APP' AND time_confidence = 'HUMAN_DECLARED')),
  ADD CONSTRAINT "response_app_chk" CHECK (
    source <> 'APP' OR (channel = 'APP' AND device_id IS NOT NULL AND device_seq IS NOT NULL)),
  ADD CONSTRAINT "response_result_chk" CHECK (sync_result <> 'REJECTED'),
  ADD CONSTRAINT "response_time_chk" CHECK (estimated_at <= received_at);

ALTER TABLE "notification_delivery"
  ADD CONSTRAINT "delivery_attempts_chk" CHECK (attempts >= 0),
  ADD CONSTRAINT "delivery_failed_chk" CHECK ((status = 'FAILED') = (failed_at IS NOT NULL)),
  ADD CONSTRAINT "delivery_sent_chk" CHECK (status IN ('QUEUED', 'FAILED') OR sent_at IS NOT NULL),
  ADD CONSTRAINT "delivery_accepted_chk" CHECK (status NOT IN ('PROVIDER_ACCEPTED', 'PROVIDER_DELIVERED')
                                                OR provider_accepted_at IS NOT NULL),
  ADD CONSTRAINT "delivery_delivered_chk" CHECK ((status = 'PROVIDER_DELIVERED') = (provider_delivered_at IS NOT NULL));

ALTER TABLE "notice_ack"
  ADD CONSTRAINT "notice_ack_via_chk" CHECK ((level = 'RECEIVED') = (via IS NOT NULL));

ALTER TABLE "manual_contact"
  ADD CONSTRAINT "manual_contact_channel_chk" CHECK (channel <> 'APP'),
  ADD CONSTRAINT "manual_contact_time_chk" CHECK (occurred_at <= recorded_at + interval '5 minutes');

ALTER TABLE "sync_operation"
  ADD CONSTRAINT "sync_operation_seq_chk" CHECK (device_seq > 0),
  ADD CONSTRAINT "sync_operation_type_chk" CHECK (operation_type IN
    ('DECLARE_AVAILABILITY', 'RESPOND_EMERGENCY', 'ACK_NOTICE', 'REGISTER_PUSH_TOKEN')),
  ADD CONSTRAINT "sync_operation_code_chk" CHECK (result IN ('APPLIED', 'SUPERSEDED') OR result_code IS NOT NULL);

ALTER TABLE "sync_operation_resolution"
  ADD CONSTRAINT "resolution_correction_chk" CHECK ((action = 'CORRECTED') = (corrective_response_id IS NOT NULL)),
  ADD CONSTRAINT "resolution_note_chk" CHECK (action <> 'NOTE' OR note IS NOT NULL);

ALTER TABLE "sync_metadata"
  ADD CONSTRAINT "sync_metadata_singleton_chk" CHECK (id = 1);

-- ─── 2. Versión de fila para la sincronización (docs/database/synchronization/versioning.md) ───

-- CACHE 1 es obligatorio: con caché por sesión los números salen fuera de orden.
CREATE SEQUENCE "sync_row_version_seq" AS bigint CACHE 1;

CREATE FUNCTION set_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Candado de transacción con clave fija: se libera al terminar la transacción,
  -- después de que su commit es visible. Garantiza que las versiones se
  -- confirman en el orden en que se asignan.
  PERFORM pg_advisory_xact_lock(7352001);
  NEW.row_version := nextval('sync_row_version_seq');
  RETURN NEW;
END $$;

CREATE TRIGGER app_user_row_version            BEFORE INSERT OR UPDATE ON "app_user"            FOR EACH ROW EXECUTE FUNCTION set_row_version();
CREATE TRIGGER brigadista_profile_row_version  BEFORE INSERT OR UPDATE ON "brigadista_profile"  FOR EACH ROW EXECUTE FUNCTION set_row_version();
CREATE TRIGGER availability_change_row_version BEFORE INSERT OR UPDATE ON "availability_change" FOR EACH ROW EXECUTE FUNCTION set_row_version();
CREATE TRIGGER emergency_row_version           BEFORE INSERT OR UPDATE ON "emergency"           FOR EACH ROW EXECUTE FUNCTION set_row_version();
CREATE TRIGGER emergency_notice_row_version    BEFORE INSERT OR UPDATE ON "emergency_notice"    FOR EACH ROW EXECUTE FUNCTION set_row_version();
CREATE TRIGGER emergency_recipient_row_version BEFORE INSERT OR UPDATE ON "emergency_recipient" FOR EACH ROW EXECUTE FUNCTION set_row_version();
CREATE TRIGGER emergency_response_row_version  BEFORE INSERT OR UPDATE ON "emergency_response"  FOR EACH ROW EXECUTE FUNCTION set_row_version();

-- ─── 3. updated_at también para escrituras fuera de Prisma ─────────────────

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER app_user_touch              BEFORE UPDATE ON "app_user"              FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER device_touch                BEFORE UPDATE ON "device"                FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER brigadista_profile_touch    BEFORE UPDATE ON "brigadista_profile"    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER emergency_touch             BEFORE UPDATE ON "emergency"             FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER emergency_recipient_touch   BEFORE UPDATE ON "emergency_recipient"   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER notification_delivery_touch BEFORE UPDATE ON "notification_delivery" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ─── 4. Tablas append-only ─────────────────────────────────────────────────

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es append-only', TG_TABLE_NAME;
END $$;

CREATE TRIGGER availability_change_append_only       BEFORE UPDATE OR DELETE ON "availability_change"       FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER emergency_notice_append_only          BEFORE UPDATE OR DELETE ON "emergency_notice"          FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER emergency_response_append_only        BEFORE UPDATE OR DELETE ON "emergency_response"        FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER notice_ack_append_only                BEFORE UPDATE OR DELETE ON "notice_ack"                FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER manual_contact_append_only            BEFORE UPDATE OR DELETE ON "manual_contact"            FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sync_operation_append_only            BEFORE UPDATE OR DELETE ON "sync_operation"            FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sync_operation_resolution_append_only BEFORE UPDATE OR DELETE ON "sync_operation_resolution" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_append_only                 BEFORE UPDATE OR DELETE ON "audit_log"                 FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ─── 5. Datos iniciales obligatorios ───────────────────────────────────────

INSERT INTO "sync_metadata" ("id", "sync_epoch") VALUES (1, uuidv7());

-- Los permisos del rol de base de datos de la aplicación (sin DELETE salvo en
-- user_role; sin UPDATE en tablas append-only) dependen del nombre del rol en
-- cada entorno y los aplica devops-architect con un script aparte.
