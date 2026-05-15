-- Migration 0004: refresh-token rotation, OTP lockout, session recordings
--
-- Adds three independent tables that were originally introduced via
-- scripts/init-db/migration-security-recording.sql. All CREATE TABLE
-- and CREATE INDEX statements use IF NOT EXISTS so applying this on a
-- DB that was already patched by the legacy script is a no-op.

-- Persistent refresh tokens (JWT rotation pattern, RFC 9700 §2.2.2)
CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id"        TEXT         NOT NULL,
    "jti"       TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_jti_key" ON "RefreshToken"("jti");
CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- Persistent OTP lockout with exponential backoff
CREATE TABLE IF NOT EXISTS "OtpLockout" (
    "id"          TEXT         NOT NULL,
    "userId"      TEXT         NOT NULL,
    "attempts"    INTEGER      NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OtpLockout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OtpLockout_userId_key" ON "OtpLockout"("userId");

-- Session recording metadata (asciinema file paths + hashes)
CREATE TABLE IF NOT EXISTS "SessionRecording" (
    "id"        TEXT         NOT NULL,
    "sessionId" TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "machineId" TEXT         NOT NULL,
    "filePath"  TEXT         NOT NULL,
    "sizeBytes" INTEGER      NOT NULL DEFAULT 0,
    "sha256"    TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"   TIMESTAMP(3),
    CONSTRAINT "SessionRecording_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SessionRecording_sessionId_key" ON "SessionRecording"("sessionId");
CREATE INDEX IF NOT EXISTS "SessionRecording_userId_idx" ON "SessionRecording"("userId");
CREATE INDEX IF NOT EXISTS "SessionRecording_machineId_idx" ON "SessionRecording"("machineId");
