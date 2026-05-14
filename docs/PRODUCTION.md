# Production deployment

This document covers what you should change between a `docker compose up` and a
real deployment that mediates access to production servers.

> The README's "Quick start" gets you a working bastion in five minutes; this
> guide is for keeping it secure once you put it in front of real users.

---

## 1. TLS certificate

OpenBastion's frontend generates a **self-signed** certificate at first boot.
That is fine for trial use but unacceptable in production — browsers will
refuse OIDC redirects from third-party providers, and your users will become
habituated to clicking through certificate warnings.

You have two options.

### Option A — Reverse proxy with automatic ACME

Put a reverse proxy in front of OpenBastion and let it handle Let's Encrypt
for you. Example with [Caddy](https://caddyserver.com/):

```caddyfile
bastion.example.com {
    reverse_proxy localhost:443 {
        transport http {
            tls_insecure_skip_verify  # internal hop only — Caddy ↔ bastion stays on localhost
        }
    }
}
```

Equivalent with Traefik, nginx-acme, or any other ACME-aware proxy works
fine. Caddy is the smallest moving piece.

### Option B — Drop a CA-issued certificate in `./certs/`

```bash
# Replace the self-signed pair with your CA-issued one
cp /path/to/fullchain.pem certs/server.crt
cp /path/to/privkey.pem   certs/server.key
sudo docker compose restart frontend

# Then re-apply file permissions so the private key stays 600
sudo ./scripts/harden-perms.sh
```

The frontend entrypoint detects the existing certificate and skips
regenerating one.

---

## 2. Secrets

Never commit secrets. The `.env` file is fine for a single self-hosted
deployment; as soon as you have multiple machines, CI pipelines, or audit
requirements, move to a real secret manager.

### Why a secret manager?

| Concern | `.env` on disk | Secret manager |
|---|---|---|
| Source of truth | One file per host | Centralised |
| Access trail | None | Every fetch is logged |
| Rotation | Manual file edit + redeploy | Versioned, automatable |
| At-rest encryption | Filesystem permissions only | HSM / KMS backed |
| Per-service identity | Shared file | Short-lived tokens per service |

Common choices: HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager,
1Password Secrets Automation, Doppler, Bitwarden Secrets Manager.

### Migration sketch

```sh
# 1. Push every value to the manager once
aws secretsmanager create-secret \
  --name openbastion/prod \
  --secret-string file://./.env.json

# 2. Replace the static .env at container start with a fetch wrapper:
eval "$(aws secretsmanager get-secret-value --secret-id openbastion/prod \
  --query SecretString --output text \
  | jq -r 'to_entries[] | "export \(.key)=\(.value | @sh)"')"
exec /app/entrypoint.sh

# 3. Drop the `environment:` block referencing those values from
#    docker-compose.yml — they come from the wrapper now.

# 4. Delete the local .env once verified.
```

### `VAULT_KEY` rotation

`VAULT_KEY` encrypts every credential stored for target machines. Rotating
it requires re-encrypting every `Secret` and `AuthProvider.config` row in
the database. A safe procedure is:

1. Stand up a second instance with the new key against a copy of the
   database.
2. Run a one-shot script that decrypts each row with the old key and
   re-encrypts with the new one.
3. Verify by logging in and opening one SSH session per machine group.
4. Switch DNS/traffic to the new instance and decommission the old one.

A reference script lives at `scripts/rotate-vault-key.ts` (placeholder —
contribute one if you build it).

---

## 3. Backups

The Postgres database is the source of truth for users, encrypted machine
credentials, audit log HMACs and recording metadata. Lose it and the
bastion is unrecoverable; lose the unencrypted backup *and* `VAULT_KEY`
and an attacker has access to every target.

### Nightly backup

```bash
docker exec bastion-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip \
  | gpg --encrypt -r ops@example.com \
  > "/secure-backups/bastion-$(date +%F).sql.gz.gpg"

# Keep 14 daily snapshots, then drop
find /secure-backups -name 'bastion-*.sql.gz.gpg' -mtime +14 -delete
```

Recommendations:

- **3-2-1 rule**: 3 copies on 2 different media with 1 off-site.
- Encrypt at rest with GPG or an equivalent (the dump contains the
  encrypted vault, but defence in depth wins).
- Store `VAULT_KEY` *separately* from the database backups so a single
  compromise does not yield both.

### Restore drill

```bash
# Spin up a throwaway Postgres
docker run --rm -d --name pg-restore-test \
  -e POSTGRES_PASSWORD=test postgres:17-alpine

# Decrypt + restore
gpg --decrypt /secure-backups/bastion-2026-XX-XX.sql.gz.gpg | gunzip \
  | docker exec -i pg-restore-test psql -U postgres

# Sanity check
docker exec pg-restore-test psql -U postgres -c 'SELECT COUNT(*) FROM "User";'

# Tear down
docker rm -f pg-restore-test
```

Run this quarterly. A backup you have not restored is not a backup.

---

## 4. Pre-flight checklist

Before exposing OpenBastion to a network you don't fully control:

- [ ] `NODE_ENV=production` set in `.env`.
- [ ] All four secrets (`JWT_SECRET`, `VAULT_KEY`, `VAULT_SALT`,
      `METRICS_TOKEN`) regenerated with `openssl rand -hex 32`.
- [ ] `ADMIN_PASSWORD` ≥ 16 chars and complex; rotated at first login.
- [ ] `CORS_ALLOWED_ORIGINS` set to your public hostname(s) only.
- [ ] `./scripts/harden-perms.sh` applied (`.env` → 600, key → 600,
      `pg_data/` → 700:70).
- [ ] CA-issued TLS certificate in place (Option A or B above).
- [ ] WAF / reverse proxy with rate limiting (Caddy, nginx-modsecurity,
      Cloudflare, ...).
- [ ] Postgres backups configured **and** a restore drill performed.
- [ ] `npm audit --audit-level=high` clean on `/` and `/client`.
      (CI does this on every PR — see `.github/workflows/security.yml`.)
- [ ] TOTP enforced for every administrator.
- [ ] Recording retention configured in
      **Administration → Settings → Recording retention**.
- [ ] Independent security review scheduled.

---

## 5. Operational concerns

### Monitoring

`GET /api/metrics` exposes Prometheus metrics behind a bearer-token gate
(`METRICS_TOKEN`). Wire it into your existing Prometheus + Grafana stack.

Useful counters and gauges:

- `bastion_active_sessions` — current SSH + RDP sessions
- `bastion_session_duration_seconds` — histogram, per protocol
- `bastion_auth_attempts_total{method,outcome}` — login attempts
- `bastion_otp_failures_total` — OTP brute-force signal
- `bastion_vault_operations_total{op}` — encrypt/decrypt rate

### Alerting

The container ships an `AlertingService` that can forward incidents to
Slack, a generic webhook, or SMTP. Configure with:

```
ALERT_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
ALERT_WEBHOOK_URL=https://your-incident-tool.example.com/webhook
ALERT_EMAIL_TO=ops@example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=openbastion@example.com
```

A failing health check (database, vault) triggers a `critical` severity
alert.

### Log retention

Audit log entries are kept indefinitely by default — that's the point of
an audit trail. If you have a compliance policy that requires deletion
after a fixed window, run a periodic `DELETE FROM "AuditLog" WHERE
timestamp < NOW() - INTERVAL 'N days';` job. Note that the HMAC chain
still validates even after row deletion; you simply lose history.

Recording retention is enforced automatically — configure in admin
settings; the cleanup cron runs every hour.

### Upgrading

Pull, rebuild, restart:

```bash
git pull
sudo docker compose up -d --build
```

The backend runs `prisma migrate deploy` on every boot, so schema
migrations apply automatically and idempotently. Major Prisma version
bumps (e.g. 6 → 7) may need manual handling — read the release notes.

---

## 6. What's *not* covered out of the box

OpenBastion delivers the bastion. It does **not** ship:

- A WAF or DDoS protection — front it with one.
- A horizontal HA strategy. The current architecture is single-node; a
  multi-replica setup requires moving session state (rate-limiter
  counters, OTP replay cache) into Redis.
- A secrets distribution mechanism — bring your own
  ([§2](#2-secrets)).
- A centralised log aggregator — pipe `docker logs` into Loki, ELK,
  CloudWatch, etc. as appropriate.

If you build any of those for your deployment, contributions back are
welcome.
