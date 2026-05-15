-- Migration 0005: GlobalSetting key/value store
--
-- Backs the runtime settings exposed in Administration → Settings:
-- default UI language, recording retention policy, etc. Seeded with the
-- default language so a fresh install matches the bundled UI default.
-- Idempotent.

CREATE TABLE IF NOT EXISTS "GlobalSetting" (
    "key"   TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "GlobalSetting_pkey" PRIMARY KEY ("key")
);

INSERT INTO "GlobalSetting" ("key", "value") VALUES ('defaultLang', 'fr')
ON CONFLICT ("key") DO NOTHING;
