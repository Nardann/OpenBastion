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

# ── Migrations: deploy, with auto-baseline fallback ──────────────────────
# Background: scripts/init-db/*.sql initialise the schema directly when the
# Postgres container is first created, so by the time the backend starts,
# all the tables already exist BUT the `_prisma_migrations` history table
# does NOT. The first `prisma migrate deploy` then fails with P3005:
#     "The database schema is not empty"
# Fix: detect that error, walk every migration directory, mark each as
# applied (creates `_prisma_migrations` and inserts the rows without
# re-running the SQL), then retry `migrate deploy` which is now a no-op.
echo "Applying schema migrations..."
DEPLOY_OUTPUT=$(npx --yes prisma migrate deploy 2>&1) || DEPLOY_RC=$?
echo "$DEPLOY_OUTPUT"

if [ "${DEPLOY_RC:-0}" -ne 0 ]; then
  if echo "$DEPLOY_OUTPUT" | grep -q "P3005"; then
    echo "⚠ P3005 detected — schema exists without migration history."
    echo "  Baselining each migration as already applied..."
    if [ -d prisma/migrations ]; then
      for m in prisma/migrations/*/; do
        name=$(basename "$m")
        [ "$name" = "*" ] && continue
        case "$name" in _*) continue;; esac # skip _meta etc.
        echo "  → $name"
        # Best-effort: ignore "already applied" / "already recorded" errors on retries.
        npx --yes prisma migrate resolve --applied "$name" 2>&1 || true
      done
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
