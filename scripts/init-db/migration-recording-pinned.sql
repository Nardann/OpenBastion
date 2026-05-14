-- migration-recording-pinned.sql
-- Adds the `pinned` flag to SessionRecording.
--
-- A pinned recording is excluded from automatic retention sweeps so that an
-- admin can preserve a specific session indefinitely for incident review or
-- compliance.
--
-- Idempotent: safe to run on a fresh DB and on an existing DB that was
-- created by an older version of OpenBastion before this column existed.

BEGIN;

ALTER TABLE "SessionRecording"
  ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT FALSE;

-- Index used by the retention sweep (WHERE pinned = false ORDER BY startedAt)
-- and by the admin recordings list (sorted by pinned status).
CREATE INDEX IF NOT EXISTS "SessionRecording_pinned_startedAt_idx"
    ON "SessionRecording" ("pinned", "startedAt");

-- Also covered by Prisma's `@@index([startedAt(sort: Desc)])`.
CREATE INDEX IF NOT EXISTS "SessionRecording_startedAt_idx"
    ON "SessionRecording" ("startedAt" DESC);

COMMIT;
