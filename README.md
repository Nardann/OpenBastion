# OpenBastion

> A modern, self-hosted Privileged Access Management (PAM) gateway for SSH and RDP.
> Brokers terminal and remote-desktop sessions to your infrastructure without ever
> exposing the underlying credentials to your operators.

[![security](https://github.com/Nardann/OpenBastion/actions/workflows/security.yml/badge.svg?branch=main)](.github/workflows/security.yml)
![license](https://img.shields.io/badge/license-AGPL--3.0-blue)
![status](https://img.shields.io/badge/status-beta-orange)

---

## What it does

OpenBastion sits between your operators and your servers. Instead of sharing SSH
keys or RDP passwords across the team, you store target credentials once,
encrypted, in OpenBastion's vault and let users connect through their browser.
Every keystroke is recorded; every action is auditable.

- 🔐 **SSH and RDP/VNC** sessions in the browser (xterm.js + Apache Guacamole)
- 👥 **Local / LDAP-AD / OIDC** authentication with optional just-in-time
      provisioning
- 🧱 **RBAC** with three permission levels (Viewer / Operator / Owner), bound to
      users, groups, machines and machine groups
- 🛡️ **2FA (TOTP)** with anti-replay and brute-force lockout
- 📼 **Session recordings** in asciinema format, with configurable retention
      and SHA-256 integrity hashes
- 📋 **Tamper-evident audit log** (HMAC-chained) covering every authentication
      event, configuration change and session
- 🌍 **French + English** UI, switchable per user
- 🐳 **Docker-first** deployment, hardened by default

---

## Quick start

Requirements: Docker 24+ with Compose v2, `openssl`, `git`.

```bash
git clone https://github.com/Nardann/OpenBastion.git
cd OpenBastion

# 1. Configure
cp .env.example .env

# Generate strong secrets (REQUIRED — do not skip)
sed -i \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=\"$(openssl rand -hex 32)\"|"     \
  -e "s|^VAULT_KEY=.*|VAULT_KEY=\"$(openssl rand -hex 32)\"|"        \
  -e "s|^VAULT_SALT=.*|VAULT_SALT=\"$(openssl rand -hex 32)\"|"      \
  -e "s|^METRICS_TOKEN=.*|METRICS_TOKEN=\"$(openssl rand -hex 32)\"|" \
  .env

# Pick an initial admin password (>= 16 chars, complex)
$EDITOR .env # set ADMIN_PASSWORD

# 2. Launch
sudo docker compose up -d --build

# 3. Tighten host permissions (one-off, after the first boot)
sudo ./scripts/harden-perms.sh
```

Open <https://localhost> in your browser, accept the self-signed certificate
warning, and sign in with `admin@bastion.local` + the `ADMIN_PASSWORD` you set.
You will be asked to rotate the password immediately.

> 💡 For a production deployment behind a public hostname, see
> [docs/PRODUCTION.md](docs/PRODUCTION.md).

---

## How sessions work

1. An administrator adds a target machine (SSH or RDP/VNC) and stores its
   credentials. They are encrypted with **AES-256-GCM** and never decryptable
   from the API — only the session worker on the server side ever sees them.
2. An operator with `OPERATOR` access opens a session from the web UI.
3. The backend opens the SSH/RDP connection on the operator's behalf and pipes
   it through a WebSocket. The operator's keystrokes and the server's output
   stream through OpenBastion, which records them and re-checks authorisation
   every 30 seconds.
4. Revoking an operator's access closes their active session within ~30 s,
   whether they were typing or just watching.

---

## Authentication

| Method | Use case |
|---|---|
| **Local** | Standalone deployments. Argon2id-hashed passwords, optional TOTP. |
| **LDAP/AD** | Existing directory. `(uid=...)` or `(sAMAccountName=...)` filter, optional JIT provisioning. |
| **OIDC** | Single sign-on with any RFC-compliant provider (Keycloak, Authentik, Authelia, Okta, Azure AD, Google...). PKCE + nonce + state. |

Configure providers from **Administration → Authentication**. Per-user TOTP
can be enrolled from the user profile page.

---

## Configuration

All configuration goes through environment variables — typically in `.env` at
the repo root, picked up by `docker-compose.yml`.

### Required

| Variable | Description |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials |
| `DATABASE_URL` | Built from the three above. |
| `JWT_SECRET` | JWT signing secret. Generate with `openssl rand -hex 32`. |
| `VAULT_KEY` | Master key for the secret vault. **Do not rotate without re-encrypting.** |
| `VAULT_SALT` | HKDF salt for per-resource key derivation. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Initial admin account, created at first boot. Rotated on first login. |
| `METRICS_TOKEN` | Bearer token guarding `/api/metrics`. Required in production. |

### Optional

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `production` | Set `development` only for local hacking. |
| `FRONTEND_HTTPS_PORT` | `443` | Host port mapping for the web UI. |
| `BACKEND_PORT` | `3000` | Internal port for the API container. Not exposed. |
| `CORS_ALLOWED_ORIGINS` | `https://localhost` | Comma-separated HTTPS origins. Plaintext HTTP origins are always rejected. |
| `ENABLE_RDP` | `false` | Build & start the guacd companion container. Required for any RDP/VNC machine. |
| `RECORDINGS_PATH` | `/var/lib/bastion/recordings` | Volume path for asciinema recordings. |
| `RECORDINGS_ENABLED` | `true` | Set to `false` to disable session recording entirely. |
| `DEFAULT_LANG` | `fr` | Default UI language (`fr` or `en`). Configurable later in admin settings. |
| `THROTTLE_AUTH_TTL` / `THROTTLE_AUTH_LIMIT` | `900000` / `20` | Login rate limit window and count. |
| `THROTTLE_GLOBAL_TTL` / `THROTTLE_GLOBAL_LIMIT` | `1000` / `20` | Global per-IP rate limit. |

> 🔒 **Transport policy**: OpenBastion is HTTPS-only. The bundled nginx
> generates a self-signed certificate at first boot — fine for trial use,
> replace with a CA-signed certificate for production (see
> [docs/PRODUCTION.md](docs/PRODUCTION.md)). Plaintext HTTP origins are
> rejected at the CORS layer regardless of configuration.

---

## Architecture

```
                    Browser
                       │ HTTPS (TLS at the edge)
                       ▼
        ┌──────────────────────────┐
        │  nginx  (frontend)       │  ← serves React bundle, terminates TLS
        └──────────┬───────────────┘
                   │ HTTP on backend-net (internal docker network)
                   ▼
        ┌──────────────────────────┐
        │  NestJS  (backend)       │  ← API + WebSocket gateways
        └──────────┬────────┬──────┘
                   │        └────────────┐
                   ▼                     ▼
        ┌──────────────────┐   ┌──────────────────────────┐
        │ PostgreSQL       │   │ guacd  (optional, RDP)   │
        │ (vault, audit,   │   │ Apache Guacamole daemon  │
        │  recordings DB)  │   └──────────────────────────┘
        └──────────────────┘
```

Three Docker networks: `frontend-net` (browser ↔ nginx), `backend-net`
(internal only — nginx ↔ backend ↔ postgres ↔ guacd), no port forwarding
between them.

---

## Development

The codebase is split into two top-level workspaces:

| Path | Stack | Build context |
|---|---|---|
| `backend/` | NestJS + Prisma + PostgreSQL | `./backend` |
| `client/`  | React 19 + Vite | `./client` |

```bash
# Backend (NestJS + Prisma)
cd backend
npm install
npx prisma generate
npm run start:dev      # http://localhost:3000

# Frontend (Vite + React)
cd ../client
npm install --legacy-peer-deps
npm run dev            # https://localhost:5173

# Run the security test suite (from backend/)
cd ../backend
npx jest src/auth src/users src/common
```

A live database is required — start just the Postgres container from the
repo root with `docker compose up postgres -d`.

### Database migrations

Migrations live in `backend/prisma/migrations/`. To author a new one:

```bash
cd backend
npx prisma migrate dev --name your_change
```

The backend runs `prisma migrate deploy` at boot, so simply rebuilding the
image picks up new migrations in any environment — fresh installs **and**
upgrades from older versions. Old installs whose database was created by a
pre-Prisma version are auto-baselined on the first boot (the entrypoint
detects P3005 and resolves `0001_init`), then the missing migrations replay
idempotently. **Add every schema change as a Prisma migration**, never as
an ad-hoc SQL file under `scripts/` — that path is intentionally gone now.

---

## Security

OpenBastion is engineered to be a security-critical piece of your infrastructure
and applies the obvious defences plus a few less obvious ones:

- **Vault**: AES-256-GCM with HKDF-derived per-resource subkeys and
  resource-id binding via AAD. The vault key never appears in the API
  response of any endpoint.
- **Authentication**: Argon2id for local passwords, TOTP with ±1 window
  and replay protection, OIDC with PKCE + nonce + state.
- **Sessions**: short-lived access JWT (15 min), refresh-token rotation
  with reuse detection (RFC 9700 §2.2.2). Admin revoke kills both the
  access JWT *and* every active refresh token atomically.
- **Transport**: HTTPS only. Cookies are `HttpOnly` + `SameSite=Strict` and
  `Secure` whenever served over HTTPS.
- **Audit log**: HMAC-SHA256 chained per entry, verifiable via
  `GET /api/audit/verify-integrity`.
- **Container hardening**: backend and frontend run on `read_only` rootfs
  with `cap_drop: ALL`, `no-new-privileges`, `pids_limit`, and tmpfs for
  the few writable paths needed at runtime.

See [SECURITY.md](.github/SECURITY.md) for the vulnerability-reporting
process.

---

## Project status

OpenBastion is in **beta**. It is being actively developed and used
internally; APIs and the database schema may still change between minor
versions. Before relying on it for production workloads:

- Replace the bundled self-signed TLS certificate with one issued by a
  trusted CA — see [docs/PRODUCTION.md](docs/PRODUCTION.md).
- Set up Postgres backups and verify a restore drill.
- Commission an independent security review of your specific deployment;
  a template engagement brief is provided at
  [docs/EXTERNAL_PENTEST_BRIEF.md](docs/EXTERNAL_PENTEST_BRIEF.md).

---

## Contributing

Issues and pull requests are welcome. Please:

- Open an issue describing the change before sending a large PR.
- Run `npx jest` and `npx tsc --noEmit` before pushing.
- For anything security-related, follow the responsible disclosure flow
  in [SECURITY.md](.github/SECURITY.md) rather than the public issue tracker.

---

## License

Licensed under the **GNU Affero General Public License v3.0**.
See [LICENSE](LICENSE) for the full text.
