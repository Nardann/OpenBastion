-- Migration 0003: RDP/VNC support
--
-- Adds the RdpSecurity enum, the per-machine RDP columns, and relaxes
-- sshFingerprint to nullable (RDP/VNC machines do not pin a key — guacd
-- handles its own TLS).
--
-- Idempotent end to end: enum creation guarded by pg_type lookup, columns
-- use ADD COLUMN IF NOT EXISTS, NOT NULL drop is a no-op when already
-- nullable.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RdpSecurity') THEN
        CREATE TYPE "RdpSecurity" AS ENUM ('ANY', 'RDP', 'TLS', 'NLA');
    END IF;
END $$;

ALTER TABLE "Machine"
    ALTER COLUMN "sshFingerprint" DROP NOT NULL;

ALTER TABLE "Machine"
    ADD COLUMN IF NOT EXISTS "rdpSecurity"   "RdpSecurity" NOT NULL DEFAULT 'NLA',
    ADD COLUMN IF NOT EXISTS "rdpIgnoreCert" BOOLEAN       NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "rdpDomain"     TEXT;
