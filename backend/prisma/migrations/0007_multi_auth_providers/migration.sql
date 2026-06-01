-- Multi-provider auth: a User can now point at a specific AuthProvider so
-- that two different LDAP/OIDC directories can coexist without externalId
-- collisions (e.g. same OIDC `sub` issued by two different IdPs).
--
-- Migration is idempotent (IF NOT EXISTS / IF EXISTS) so the entrypoint can
-- run `prisma migrate deploy` safely on upgrades.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "authProviderId" TEXT;

-- Backfill: if exactly one LDAP provider exists, attach every LDAP user to
-- it. Same for OIDC. If multiple providers of the same type already exist
-- (impossible under the previous one-per-type code path, but guarded for
-- safety), leave the column NULL — those rows stay legacy.
DO $$
DECLARE
  ldap_count   INT;
  oidc_count   INT;
  ldap_id      TEXT;
  oidc_id      TEXT;
BEGIN
  SELECT COUNT(*) INTO ldap_count FROM "AuthProvider" WHERE "type" = 'LDAP';
  SELECT COUNT(*) INTO oidc_count FROM "AuthProvider" WHERE "type" = 'OIDC';

  IF ldap_count = 1 THEN
    SELECT "id" INTO ldap_id FROM "AuthProvider" WHERE "type" = 'LDAP' LIMIT 1;
    UPDATE "User" SET "authProviderId" = ldap_id
      WHERE "authMethod" = 'LDAP' AND "authProviderId" IS NULL;
  END IF;

  IF oidc_count = 1 THEN
    SELECT "id" INTO oidc_id FROM "AuthProvider" WHERE "type" = 'OIDC' LIMIT 1;
    UPDATE "User" SET "authProviderId" = oidc_id
      WHERE "authMethod" = 'OIDC' AND "authProviderId" IS NULL;
  END IF;
END
$$;

-- Drop the old (externalId, authMethod) unique index — it can't tolerate
-- two providers issuing the same sub — and replace it with the
-- provider-scoped variant.
DROP INDEX IF EXISTS "User_externalId_authMethod_key";

CREATE UNIQUE INDEX IF NOT EXISTS "User_externalId_authMethod_authProviderId_key"
  ON "User"("externalId", "authMethod", "authProviderId");

CREATE INDEX IF NOT EXISTS "User_authProviderId_idx"
  ON "User"("authProviderId");

-- FK to AuthProvider — SetNull on delete so removing a provider doesn't
-- cascade-delete its users (admins can re-attach them or fall back to a
-- different IdP). The DELETE endpoint in the API refuses to drop a provider
-- that still has users attached, so this path is mostly defence in depth.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_authProviderId_fkey'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_authProviderId_fkey"
      FOREIGN KEY ("authProviderId") REFERENCES "AuthProvider"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
