-- Migration 0002: HMAC integrity column on AuditLog
--
-- Each audit row carries a server-computed HMAC-SHA256 over its
-- immutable fields, so post-hoc tampering is detectable via
-- /api/audit/verify-integrity.
--
-- Idempotent: safe to apply to an existing schema that may already have
-- the column (e.g. installs that ran the legacy scripts/init-db/*.sql).
ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "hmac" TEXT;
