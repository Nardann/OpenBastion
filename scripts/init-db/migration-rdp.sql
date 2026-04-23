-- ============================================================================
--  OpenBastion — migration RDP (idempotent)
-- ----------------------------------------------------------------------------
--  A appliquer sur une base existante pre-RDP. Cree le type RdpSecurity,
--  ajoute les colonnes RDP a Machine, rend sshFingerprint nullable.
--
--  Usage (a chaud) :
--    psql "$DATABASE_URL" -f scripts/init-db/migration-rdp.sql
--
--  Sur nouvelle installation le schema est deja a jour via init.sql.
-- ============================================================================

BEGIN;

-- 1. Nouveau type enum (si absent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RdpSecurity') THEN
        CREATE TYPE "RdpSecurity" AS ENUM ('ANY', 'RDP', 'TLS', 'NLA');
    END IF;
END $$;

-- 2. sshFingerprint : obligatoire -> nullable (RDP/VNC n'en ont pas besoin)
ALTER TABLE "Machine"
    ALTER COLUMN "sshFingerprint" DROP NOT NULL;

-- 3. Ajout colonnes RDP (idempotent)
ALTER TABLE "Machine"
    ADD COLUMN IF NOT EXISTS "rdpSecurity"   "RdpSecurity" NOT NULL DEFAULT 'NLA',
    ADD COLUMN IF NOT EXISTS "rdpIgnoreCert" BOOLEAN       NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "rdpDomain"     TEXT;

COMMIT;
