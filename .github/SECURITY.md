# Security Policy

## Reporting a vulnerability

If you find a security issue in OpenBastion, **please do not open a public
issue.** Instead, email [the maintainer](mailto:nardann@example.invalid) with:

- a description of the vulnerability,
- the affected version (commit SHA if possible),
- a minimal reproduction (curl, screenshot, PoC code),
- the impact you observed.

We will acknowledge within **72 hours** and aim to publish a fix or workaround
within **14 days** for high/critical issues.

## Scope

In scope:

- Backend (`src/`) — auth, RBAC, vault, gateways, audit, recordings.
- Frontend (`client/src/`) — XSS, CSRF, exposed endpoints.
- Default `docker-compose.yml` deployment.
- `Dockerfile.backend`, `Dockerfile.guacd`, `client/Dockerfile.frontend`.

Out of scope:

- Self-hosted modifications to the codebase.
- Findings that require pre-existing root on the host.
- Issues in upstream dependencies that are already publicly tracked
  (open a PR to bump the version instead).

## Hardening checklist for production

Before exposing OpenBastion publicly:

- [ ] `NODE_ENV=production` (not `development`).
- [ ] `JWT_SECRET`, `VAULT_KEY`, `VAULT_SALT`, `METRICS_TOKEN` rotated to
      values from `openssl rand -hex 32` (and stored in a secret manager,
      not `.env`).
- [ ] `ADMIN_PASSWORD` set to a non-guessable value (>= 16 chars, complexity
      enforced) and rotated immediately on first login.
- [ ] TLS certificate from a real CA (not the self-signed `certs/server.crt`).
- [ ] `CORS_ALLOWED_ORIGINS` set to the public hostname only — no wildcards,
      no `localhost` in prod.
- [ ] `OIDC_ALLOW_INSECURE_TLS` unset (or `false`).
- [ ] `./scripts/harden-perms.sh` executed (`.env` 600, certs 600, pg_data
      700:70).
- [ ] Postgres backups configured with `pg_dump` to encrypted off-host
      storage, restoration tested.
- [ ] WAF / reverse proxy in front (Cloudflare, nginx-modsecurity, fail2ban
      on repeated 401s).
- [ ] `npm audit --audit-level=high` clean on both `/` and `/client`.
- [ ] `OTP enforcement` for ADMIN accounts (manual policy until a hard
      check is added).
- [ ] Recording retention configured in **Settings > Recording retention**.
- [ ] Independent penetration test scheduled.

## Audit history

| Date | Type | Coverage | Notes |
|------|------|----------|-------|
| 2026-05-09 | Internal pentest pass 1 | 12 findings, all patched | Auth providers leak, default creds, cookie Secure flag, sudo step-up, fs perms, metrics token, OIDC TLS bypass, SSRF probe-fingerprint, provider DTO, TOTP hardening, CORS no-origin, double CSP |
| 2026-05-09 | Internal pentest pass 2 | 7 findings, all patched | revoke-tokens bypass via refresh, WS bypass of `requiresPasswordChange`, login user-enumeration timing, refresh-token race + replay, OTP code logged, nodemailer + axios CVEs |

The current codebase has **not** undergone a third-party penetration test.
Anyone deploying OpenBastion publicly is strongly encouraged to commission
one before going live with sensitive targets.
