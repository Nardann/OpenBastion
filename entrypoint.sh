#!/bin/sh
set -e

# SECURITY FIX: Verify that the nestjs user exists before attempting to use it
if ! id "nestjs" >/dev/null 2>&1; then
  echo "❌ User 'nestjs' not found. Creating user..."
  adduser -D -s /bin/sh nestjs || {
    echo "❌ Failed to create 'nestjs' user"
    exit 1
  }
fi

echo "Generating Prisma client..."
npx prisma generate

echo "Starting NestJS application..."
exec su -s /bin/sh nestjs -c "npm run start:prod"
