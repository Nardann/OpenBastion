#!/bin/sh
set -e

# Generate self-signed certificate if it doesn't exist
mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/server.crt ]; then
    echo "🔐 Generating self-signed SSL certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/server.key \
        -out /etc/nginx/ssl/server.crt \
        -subj "/C=FR/ST=Paris/L=Paris/O=OpenBastion/CN=localhost"
fi

# Replace environment variables in nginx.conf template
envsubst '${BACKEND_PORT}' < /app/nginx.conf.template > /etc/nginx/conf.d/default.conf

echo "🚀 Starting Nginx..."
exec nginx -g 'daemon off;'
