-- SQL manual (Prisma no expresa CHECK). Auditoría de database-architect, 2026-11-13.
--
-- row_version tiene DEFAULT 0 solo para que Prisma no lo exija al insertar; el
-- trigger set_row_version siempre lo sobrescribe con nextval (>= 1). Si una tabla
-- replicada quedara sin trigger, el DEFAULT 0 anularía la protección del NOT NULL
-- y las filas serían invisibles para la descarga (cursor inicial 0). Este CHECK
-- hace fallar esa escritura en vez de perderla en silencio.

ALTER TABLE "app_user"            ADD CONSTRAINT "app_user_row_version_chk"            CHECK (row_version > 0);
ALTER TABLE "brigadista_profile"  ADD CONSTRAINT "brigadista_profile_row_version_chk"  CHECK (row_version > 0);
ALTER TABLE "availability_change" ADD CONSTRAINT "availability_change_row_version_chk" CHECK (row_version > 0);
ALTER TABLE "emergency"           ADD CONSTRAINT "emergency_row_version_chk"           CHECK (row_version > 0);
ALTER TABLE "emergency_notice"    ADD CONSTRAINT "emergency_notice_row_version_chk"    CHECK (row_version > 0);
ALTER TABLE "emergency_recipient" ADD CONSTRAINT "emergency_recipient_row_version_chk" CHECK (row_version > 0);
ALTER TABLE "emergency_response"  ADD CONSTRAINT "emergency_response_row_version_chk"  CHECK (row_version > 0);
