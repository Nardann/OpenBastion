# OpenBastion

A modern and sovereign Bastion/PAM (Privileged Access Management) system written in Node.js and React.

## 🚀 Features

- **Secure SSH Access** : Direct secure connection without exposing credentials.
- **Remote Desktop (RDP)** : Optional RDP support for Windows systems (configurable via environment variables).
- **Multi-Authentication** : Support for Local, LDAP/AD, and OIDC/SSO.
- **Fine-grained Access Control** : RBAC binding users, groups, and machines with granular permission levels (READ, ACCESS, MANAGE).
- **Machine Groups** : Organize and manage machines by logical groups for better resource organization.
- **Two-Factor Authentication (2FA)** : OTP-based authentication for enhanced account security.
- **User Profiles** : Manage personal information, security settings, and device sessions.
- **Session Management** : Revoke all active sessions for compromised accounts.
- **Audit & Traceability** : Complete immutable logs of all system activities with filtering and search.
- **Admin Settings** : Centralized configuration including default language selection.
- **Multi-Language Support** : Full internationalization (i18n) with French and English, configurable per user and globally.
- **Advanced Security** : AES-256-GCM contextual encryption, Rate Limiting, Zero-Trust principles.

## 🛠️ Technical Stack

- **Backend** : NestJS, Prisma ORM, PostgreSQL, SSH2, Guacamole (RDP).
- **Frontend** : React 19, Vite 6, Tailwind CSS, xterm.js, Lucide icons.
- **Database** : PostgreSQL with migrations via Prisma.
- **Authentication** : Local, LDAP/AD integration, OpenID Connect (OIDC) SSO.

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/nardann/OpenBastion.git
   cd OpenBastion
   ```

2. **Configuration**
   Create a `.env` file at the root (based on `.env.example`). At minimum, generate fresh secrets:
   ```bash
   echo "JWT_SECRET=$(openssl rand -hex 32)"     >> .env
   echo "VAULT_KEY=$(openssl rand -hex 32)"      >> .env
   echo "VAULT_SALT=$(openssl rand -hex 32)"     >> .env
   echo "METRICS_TOKEN=$(openssl rand -hex 32)"  >> .env
   ```

3. **Launch with Docker**
   ```bash
   sudo docker compose up -d --build
   ```

4. **Tighten filesystem permissions** (critical, run once after first boot)
   ```bash
   sudo ./scripts/harden-perms.sh
   ```
   This sets `.env` to `600`, `certs/server.key` to `600`, and `pg_data/` to `700` owned by the Postgres uid (70). Without this, any local user on the host can read your TLS private key and DB secrets.

5. **Access the application**
   - Frontend: `https://localhost`
   - Backend API: `https://localhost:${BACKEND_PORT}`
   - Default admin account: `admin@bastion.local` / `${ADMIN_PASSWORD}`
   - On first login the admin account is locked into a forced password rotation; only `/auth/me`, `/auth/change-password`, `/auth/refresh` and `/auth/logout` are reachable until you change the password.

## 🚨 Production Deployment

The default `docker-compose.yml` is hardened for self-hosted production but **a real prod deployment also needs**:

### TLS certificate (required)

The repo ships a self-signed cert in `certs/`. **Replace it before going public** — browsers will refuse OIDC redirects, SSO, and several security policies otherwise.

Two options:

**Option A — Let's Encrypt via Caddy / Traefik in front of the bastion**

Put a reverse proxy on the public side. Caddy handles ACME automatically:
```caddyfile
bastion.example.com {
    reverse_proxy localhost:443 {
        transport http {
            tls_insecure_skip_verify  # internal hop only
        }
    }
}
```

**Option B — drop a real cert into `./certs/`**
```bash
# Replace the self-signed pair with your CA-issued one
cp /path/to/fullchain.pem certs/server.crt
cp /path/to/privkey.pem  certs/server.key
sudo chmod 644 certs/server.crt
sudo chmod 600 certs/server.key
sudo docker compose restart frontend
```

Then **re-run** `sudo ./scripts/harden-perms.sh` so permissions stay tight.

### Prerequisites checklist

Before exposing OpenBastion to a network you don't fully control:

- [ ] `NODE_ENV=production` in `.env` (not `development`).
- [ ] All four secrets (`JWT_SECRET`, `VAULT_KEY`, `VAULT_SALT`, `METRICS_TOKEN`) regenerated with `openssl rand -hex 32`.
- [ ] `ADMIN_PASSWORD` ≥ 16 chars with complexity, never reused.
- [ ] `CORS_ALLOWED_ORIGINS` set to your public hostname only — the same-origin auto-detection covers all reachable hostnames/IPs without listing them.
- [ ] `OIDC_ALLOW_INSECURE_TLS` left unset (or `false`).
- [ ] `./scripts/harden-perms.sh` applied.
- [ ] Real CA-issued TLS cert (see above).
- [ ] WAF / reverse proxy with rate limiting (Caddy, nginx + ModSecurity, Cloudflare).
- [ ] Postgres backups (see below) tested for restore.
- [ ] `npm audit --audit-level=high` clean on `/` and `/client` (CI does this for every PR — see `.github/workflows/security.yml`).
- [ ] OTP enforced on every ADMIN account.
- [ ] Recording retention configured in **Administration > Settings > Recording retention**.
- [ ] Independent penetration test scheduled before opening to real users.

### Postgres backups

The `pg_data/` directory contains everything: user accounts, encrypted machine credentials, recording metadata, audit log HMACs. Lose it and the bastion is unrecoverable; leak it and an attacker has the encrypted vault (still needs `VAULT_KEY` to decrypt — keep them on different storage).

Minimal nightly backup with verified restore:
```bash
# Inside a daily cron on the host
docker exec bastion-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip \
  | gpg --encrypt -r ops@example.com \
  > "/secure-backups/bastion-$(date +%F).sql.gz.gpg"
```

Restore drill (run quarterly): spin up a fresh empty Postgres, decrypt + `psql -f`, point a staging backend at it, verify login + machine list. Never trust a backup you haven't restored.

### Why a secret manager (vs `.env` on disk)

`.env` works for self-hosted single-node deployments. As soon as you have:

- multiple machines running OpenBastion,
- a CI/CD pipeline that needs the same secrets,
- audit requirements ("who fetched the JWT secret last week?"),
- a key rotation policy,

…you outgrow `.env`. A secret manager (HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager, Doppler, 1Password, Bitwarden) gives you:

- **Centralised storage** — one source of truth, not 5 `.env` copies.
- **Access logs** — every read is traceable.
- **Rotation hooks** — secrets are versioned; you can rotate `VAULT_KEY` and roll out without scping files.
- **Identity-based access** — services authenticate via short-lived tokens (AWS IAM, Vault AppRole) instead of a static file every developer can `cat`.
- **Sealed at rest** — the secret manager holds master keys in an HSM you don't have to operate yourself.

Migration sketch from `.env` to (for example) AWS Secrets Manager:
1. Push every value to `aws secretsmanager create-secret --name openbastion/prod`.
2. At container start, fetch and `export` them via a wrapper:
   ```sh
   eval "$(aws secretsmanager get-secret-value --secret-id openbastion/prod \
     --query SecretString --output text \
     | jq -r 'to_entries[] | "export \(.key)=\(.value | @sh)"')"
   exec /app/entrypoint.sh
   ```
3. Drop `JWT_SECRET=...` etc. from `docker-compose.yml`'s `environment:` block — they come from the wrapper now.
4. Delete the `.env` from the host once verified.

## 📚 Key Features Explained

### Multi-Language Support
- Switch between French and English using the 🌍 globe icon in the top navigation bar.
- Default language can be configured globally via **Administration > Settings > Default Language**.
- User language preference is stored locally and persists across sessions.
- All system messages, UI labels, and form placeholders are fully translated.

### Access Control & Permissions
Three permission levels for machines and groups:
- **READ (VIEWER)** : View machine details only.
- **ACCESS (OPERATOR)** : Execute sessions on machines.
- **MANAGE (OWNER)** : Full management rights.

### Authentication Methods
- **Local** : Built-in user accounts with password and optional OTP.
- **LDAP/AD** : Directory-based authentication with optional Just-In-Time (JIT) user provisioning.
- **OIDC/SSO** : OpenID Connect for enterprise SSO integration with optional JIT provisioning.

### Machine Management
- Add and organize SSH and RDP machines.
- Configure security settings (SSH fingerprint verification, RDP security modes).
- Group machines by environment or purpose.
- Control security features per machine (port forwarding, proxy/rebound, clipboard).

### Admin Dashboard
- Real-time system status monitoring.
- Quick overview of users, machines, and audit logs.
- Navigation to all administration sections.

### Security & Audit
- **Audit Logs** : Immutable record of all actions (authentication, machine access, configuration changes).
- **Log Filtering** : Search and filter by category, user, action, and source IP.
- **Session Management** : View and revoke active sessions.
- **OTP Management** : Enable, disable, or reset 2FA for user accounts.

## 🔐 Security Highlights

- **Zero-Trust Architecture** : All access requires explicit authorization.
- **Encryption** : AES-256-GCM for sensitive data in transit.
- **Rate Limiting** : Protection against brute-force attacks.
- **SSH Fingerprint Verification** : Validate server identity before connecting.
- **Isolated Sessions** : Each session runs in isolation with keyboard/clipboard controls.
- **Audit Trail** : Complete, immutable logging of all administrative and user actions.

## 🌍 Supported Languages

- **Français** (French)
- **English**

Additional languages can be added by creating translation files in `client/src/lang/`.

## 📖 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_PORT` | `3000` | Backend API port |
| `DATABASE_URL` | - | PostgreSQL connection string |
| `JWT_SECRET` | - | JWT signing secret |
| `ADMIN_PASSWORD` | - | Initial admin password |
| `DEFAULT_LANG` | `fr` | Default system language |
| `ENABLE_RDP` | `false` | Enable RDP support |
| `LDAP_URL` | - | LDAP server URL |
| `LDAP_BASE_DN` | - | LDAP search base |
| `OIDC_ISSUER` | - | OIDC provider issuer URL |
| `OIDC_CLIENT_ID` | - | OIDC client ID |
| `OIDC_CLIENT_SECRET` | - | OIDC client secret |
| `NODE_ENV` | `production / development` | Bypass ssl verification | 


## 🚀 Development

### Backend
```bash
cd server
npm install
npm run dev
```

### Frontend
```bash
cd client
npm install
npm run dev
```

### Database Migrations
```bash
npx prisma migrate dev
```

## 👥 Author

Authored and maintained by **Nardann**

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome. Please open an issue or submit a pull request.

## 📞 Support

For issues, feature requests, or security concerns, please open an issue on GitHub.
