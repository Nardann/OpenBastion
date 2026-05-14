-- ============================================================
-- Migration 0001_init — OpenBastion baseline
-- Idempotent: safe to run on both fresh and existing databases
-- (previously managed by prisma db push or the init-db scripts)
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AuthMethod" AS ENUM ('LOCAL', 'LDAP', 'OIDC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AccessLevel" AS ENUM ('OWNER', 'OPERATOR', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "Protocol" AS ENUM ('SSH', 'RDP', 'VNC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RdpSecurity" AS ENUM ('ANY', 'RDP', 'TLS', 'NLA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AuthProviderType" AS ENUM ('LDAP', 'OIDC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "User" (
    "id"                     TEXT        NOT NULL,
    "email"                  TEXT        NOT NULL,
    "username"               TEXT,
    "passwordHash"           TEXT,
    "role"                   "Role"      NOT NULL DEFAULT 'USER',
    "authMethod"             "AuthMethod" NOT NULL DEFAULT 'LOCAL',
    "externalId"             TEXT,
    "tokenVersion"           INTEGER     NOT NULL DEFAULT 0,
    "requiresPasswordChange" BOOLEAN     NOT NULL DEFAULT false,
    "otpSecret"              TEXT,
    "pendingOtpSecret"       TEXT,
    "isOtpEnabled"           BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Group" (
    "id"          TEXT        NOT NULL,
    "name"        TEXT        NOT NULL,
    "description" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MachineGroup" (
    "id"          TEXT        NOT NULL,
    "name"        TEXT        NOT NULL,
    "description" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MachineGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Machine" (
    "id"             TEXT        NOT NULL,
    "name"           TEXT        NOT NULL,
    "ip"             TEXT        NOT NULL,
    "port"           INTEGER     NOT NULL,
    "protocol"       "Protocol"  NOT NULL DEFAULT 'SSH',
    "description"    TEXT,
    "sshFingerprint" TEXT,
    "machineGroupId" TEXT,
    "allowTunneling" BOOLEAN     NOT NULL DEFAULT false,
    "allowRebound"   BOOLEAN     NOT NULL DEFAULT false,
    "allowCopyPaste" BOOLEAN     NOT NULL DEFAULT false,
    "rdpSecurity"    "RdpSecurity" NOT NULL DEFAULT 'NLA',
    "rdpIgnoreCert"  BOOLEAN     NOT NULL DEFAULT false,
    "rdpDomain"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Permission" (
    "id"             TEXT          NOT NULL,
    "userId"         TEXT,
    "groupId"        TEXT,
    "machineId"      TEXT,
    "machineGroupId" TEXT,
    "level"          "AccessLevel" NOT NULL DEFAULT 'OPERATOR',
    "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Secret" (
    "id"                  TEXT        NOT NULL,
    "machineId"           TEXT        NOT NULL,
    "encryptedUsername"   TEXT        NOT NULL,
    "encryptedPassword"   TEXT,
    "encryptedPrivateKey" TEXT,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Secret_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuthProvider" (
    "id"        TEXT              NOT NULL,
    "name"      TEXT              NOT NULL,
    "type"      "AuthProviderType" NOT NULL,
    "enabled"   BOOLEAN           NOT NULL DEFAULT true,
    "config"    JSONB             NOT NULL,
    "createdAt" TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3)      NOT NULL,
    CONSTRAINT "AuthProvider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id"           TEXT        NOT NULL,
    "userId"       TEXT,
    "userSnapshot" JSONB,
    "action"       TEXT        NOT NULL,
    "category"     TEXT,
    "authMethod"   "AuthMethod",
    "ipAddress"    TEXT,
    "timestamp"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata"     JSONB,
    "hmac"         TEXT,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BlacklistedToken" (
    "id"        TEXT        NOT NULL,
    "token"     TEXT        NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlacklistedToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GlobalSetting" (
    "key"   TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "GlobalSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id"        TEXT        NOT NULL,
    "jti"       TEXT        NOT NULL,
    "userId"    TEXT        NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OtpLockout" (
    "id"          TEXT        NOT NULL,
    "userId"      TEXT        NOT NULL,
    "attempts"    INTEGER     NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OtpLockout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SessionRecording" (
    "id"        TEXT        NOT NULL,
    "sessionId" TEXT        NOT NULL,
    "userId"    TEXT        NOT NULL,
    "machineId" TEXT        NOT NULL,
    "filePath"  TEXT        NOT NULL,
    "sizeBytes" INTEGER     NOT NULL DEFAULT 0,
    "sha256"    TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"   TIMESTAMP(3),
    "pinned"    BOOLEAN     NOT NULL DEFAULT false,
    CONSTRAINT "SessionRecording_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "_UserGroups" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_UserGroups_AB_pkey" PRIMARY KEY ("A", "B")
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key"                        ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key"                     ON "User"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "User_externalId_authMethod_key"        ON "User"("externalId", "authMethod");
CREATE UNIQUE INDEX IF NOT EXISTS "Group_name_key"                        ON "Group"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Permission_userId_machineId_key"       ON "Permission"("userId", "machineId");
CREATE UNIQUE INDEX IF NOT EXISTS "Permission_groupId_machineId_key"      ON "Permission"("groupId", "machineId");
CREATE UNIQUE INDEX IF NOT EXISTS "Permission_userId_machineGroupId_key"  ON "Permission"("userId", "machineGroupId");
CREATE UNIQUE INDEX IF NOT EXISTS "Permission_groupId_machineGroupId_key" ON "Permission"("groupId", "machineGroupId");
CREATE INDEX        IF NOT EXISTS "Machine_ip_port_idx"                   ON "Machine"("ip", "port");
CREATE UNIQUE INDEX IF NOT EXISTS "MachineGroup_name_key"                 ON "MachineGroup"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Secret_machineId_key"                  ON "Secret"("machineId");
CREATE UNIQUE INDEX IF NOT EXISTS "AuthProvider_name_key"                 ON "AuthProvider"("name");
CREATE INDEX        IF NOT EXISTS "AuditLog_category_idx"                 ON "AuditLog"("category");
CREATE INDEX        IF NOT EXISTS "AuditLog_timestamp_idx"                ON "AuditLog"("timestamp" DESC);
CREATE INDEX        IF NOT EXISTS "AuditLog_userId_idx"                   ON "AuditLog"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "BlacklistedToken_token_key"            ON "BlacklistedToken"("token");
CREATE INDEX        IF NOT EXISTS "BlacklistedToken_expiresAt_idx"        ON "BlacklistedToken"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_jti_key"                  ON "RefreshToken"("jti");
CREATE INDEX        IF NOT EXISTS "RefreshToken_userId_idx"               ON "RefreshToken"("userId");
CREATE INDEX        IF NOT EXISTS "RefreshToken_expiresAt_idx"            ON "RefreshToken"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "OtpLockout_userId_key"                 ON "OtpLockout"("userId");
CREATE INDEX        IF NOT EXISTS "OtpLockout_userId_idx"                 ON "OtpLockout"("userId");
CREATE INDEX        IF NOT EXISTS "OtpLockout_lockedUntil_idx"            ON "OtpLockout"("lockedUntil");
CREATE UNIQUE INDEX IF NOT EXISTS "SessionRecording_sessionId_key"        ON "SessionRecording"("sessionId");
CREATE INDEX        IF NOT EXISTS "SessionRecording_userId_idx"           ON "SessionRecording"("userId");
CREATE INDEX        IF NOT EXISTS "SessionRecording_machineId_idx"        ON "SessionRecording"("machineId");
CREATE INDEX        IF NOT EXISTS "SessionRecording_startedAt_idx"        ON "SessionRecording"("startedAt" DESC);
CREATE INDEX        IF NOT EXISTS "SessionRecording_pinned_startedAt_idx" ON "SessionRecording"("pinned", "startedAt");
CREATE INDEX        IF NOT EXISTS "_UserGroups_B_index"                   ON "_UserGroups"("B");

-- ── Foreign keys ──────────────────────────────────────────────────────────────
-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS — use DO blocks instead.

DO $$ BEGIN
  ALTER TABLE "Permission" ADD CONSTRAINT "Permission_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Permission" ADD CONSTRAINT "Permission_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Permission" ADD CONSTRAINT "Permission_machineId_fkey"
    FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Permission" ADD CONSTRAINT "Permission_machineGroupId_fkey"
    FOREIGN KEY ("machineGroupId") REFERENCES "MachineGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Machine" ADD CONSTRAINT "Machine_machineGroupId_fkey"
    FOREIGN KEY ("machineGroupId") REFERENCES "MachineGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Secret" ADD CONSTRAINT "Secret_machineId_fkey"
    FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "_UserGroups" ADD CONSTRAINT "_UserGroups_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "_UserGroups" ADD CONSTRAINT "_UserGroups_B_fkey"
    FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Seed data ─────────────────────────────────────────────────────────────────

INSERT INTO "GlobalSetting" ("key", "value")
  VALUES ('defaultLang', 'fr')
  ON CONFLICT ("key") DO NOTHING;
