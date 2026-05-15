#!/bin/sh
set -e

# SECURITY: the runtime image is read-only (compose: read_only:true). The
# Prisma client was generated at BUILD time (backend/Dockerfile stage 1)
# and shipped inside /app/node_modules/.prisma — there is nothing to
# regenerate at boot. We only run `migrate deploy` which is read-only on
# the filesystem (it just talks to Postgres).

if ! id "nestjs" >/dev/null 2>&1; then
  echo "❌ User 'nestjs' not found. Creating user..."
  adduser -D -s /bin/sh nestjs || {
    echo "❌ Failed to create 'nestjs' user"
    exit 1
  }
fi

# ── Migrations strategy ───────────────────────────────────────────────────
#
# Three install profiles need to land on the same schema:
#
#   A) Fresh install: Postgres data dir is empty, `init.sql` from
#      scripts/init-db/ runs at the first Postgres boot and creates the
#      base schema (== content of 0001_init/migration.sql) but does NOT
#      create `_prisma_migrations`. We catch P3005, baseline ONLY
#      `0001_init`, then `migrate deploy` applies 0002-N.
#
#   B) Old install that was created by an older version of this codebase
#      (no Prisma migrations at all, possibly missing the columns/tables
#      that the legacy scripts/init-db/migration-*.sql used to add).
#      Same P3005 path as (A): baseline 0001_init, let `migrate deploy`
#      apply 0002-N. Every 0002+ migration uses `IF NOT EXISTS`, so the
#      ones already applied (e.g. via the legacy SQL scripts) are no-ops
#      and the missing ones are filled in. **This is the case that makes
#      pull + rebuild "just work" for users on old deployments.**
#
#   C) Up-to-date install: `_prisma_migrations` exists with every entry
#      up to the latest migration. `migrate deploy` is a no-op.
#
# The single edge case is the P3005 baseline: we only mark `0001_init` as
# applied, never the later migrations — those MUST be replayed (their
# idempotent SQL is responsible for filling in whatever the old install
# is missing).

echo "Applying schema migrations..."
DEPLOY_OUTPUT=$(npx --yes prisma migrate deploy 2>&1) || DEPLOY_RC=$?
echo "$DEPLOY_OUTPUT"

if [ "${DEPLOY_RC:-0}" -ne 0 ]; then
  if echo "$DEPLOY_OUTPUT" | grep -q "P3005"; then
    echo "⚠ P3005 detected — schema exists without migration history."
    echo "  Baselining ONLY 0001_init (the bootstrap); later migrations will replay idempotently."
    if [ -d prisma/migrations/0001_init ]; then
      npx --yes prisma migrate resolve --applied "0001_init" 2>&1 || true
    fi
    echo "Re-running migrate deploy after baseline..."
    npx --yes prisma migrate deploy
  else
    echo "❌ migrate deploy failed for an unexpected reason. Aborting."
    exit "$DEPLOY_RC"
  fi
fi

echo "Starting NestJS application..."
exec su -s /bin/sh nestjs -c "npm run start:prod"
