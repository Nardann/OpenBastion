#!/bin/sh
set -e

# SECURITY: the runtime image is read-only (compose: read_only:true). The
# Prisma client was generated at BUILD time (Dockerfile.backend stage 1)
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

# ── Baseline an existing schema if needed ─────────────────────────────────
# When the DB was originally created with `prisma db push` (no migration
# history table) and we later switched to `prisma migrate deploy`, the
# first deploy fails with P3005 ("database schema is not empty"). We detect
# the missing _prisma_migrations table and mark the existing migrations as
# "applied" without re-running them. This keeps user data intact.
echo "Checking migration history baseline..."
NEEDS_BASELINE=$(npx --yes prisma migrate status 2>&1 || true)
if echo "$NEEDS_BASELINE" | grep -qE "P3005|database schema is not empty|_prisma_migrations.*does not exist"; then
  echo "⚠ Existing schema without migration history detected — baselining."
  for m in prisma/migrations/*/ ; do
    name=$(basename "$m")
    [ "$name" = "*" ] && continue # no migrations dir entries
    echo "  → marking $name as applied"
    npx --yes prisma migrate resolve --applied "$name" || true
  done
fi

echo "Applying schema migrations..."
# prisma migrate deploy is idempotent and safe:
# - Fresh DB  : creates _prisma_migrations, applies 0001_init
# - Existing DB freshly baselined (above): no-op
# - Subsequent restarts: only new migrations are applied
npx prisma migrate deploy

echo "Starting NestJS application..."
exec su -s /bin/sh nestjs -c "npm run start:prod"
