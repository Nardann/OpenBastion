-- Migration 0006: pinned flag on SessionRecording
--
-- A pinned recording is excluded from automatic retention sweeps so an
-- admin can preserve a specific session indefinitely (incident review,
-- compliance, audit). Adds the column with a default of FALSE and two
-- indexes used by the retention sweep and the admin recordings list.
--
-- Idempotent; safe to re-apply.

ALTER TABLE "SessionRecording"
  ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "SessionRecording_pinned_startedAt_idx"
    ON "SessionRecording" ("pinned", "startedAt");

CREATE INDEX IF NOT EXISTS "SessionRecording_startedAt_idx"
    ON "SessionRecording" ("startedAt" DESC);
