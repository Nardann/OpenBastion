-- Migration: add HMAC integrity column to AuditLog
-- Each row's HMAC is computed server-side over its immutable fields.
-- Existing rows will have NULL hmac; they can be verified with the /audit/verify endpoint.

BEGIN;

ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "hmac" TEXT;

COMMIT;
