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

echo "Applying schema migrations..."
# prisma migrate deploy is idempotent and safe:
# - Fresh DB  : creates _prisma_migrations, applies 0001_init (IF NOT EXISTS SQL → no-op on existing tables)
# - Existing DB (upgraded from db push): same — IF NOT EXISTS means no data loss ever
# - Subsequent restarts: 0001_init already recorded → skipped; only new migrations are applied
npx prisma migrate deploy

echo "Starting NestJS application..."
exec su -s /bin/sh nestjs -c "npm run start:prod"
