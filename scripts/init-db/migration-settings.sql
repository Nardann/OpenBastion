-- migration-settings.sql
-- A appliquer sur une base existante.
-- Cree la table GlobalSetting pour les parametres globaux (langue par defaut, etc.)
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/init-db/migration-settings.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "GlobalSetting" (
    "key"   TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "GlobalSetting_pkey" PRIMARY KEY ("key")
);

INSERT INTO "GlobalSetting" ("key", "value") VALUES ('defaultLang', 'fr')
ON CONFLICT ("key") DO NOTHING;

COMMIT;
