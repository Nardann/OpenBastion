# Security Policy

## Reporting a vulnerability

If you discover a security issue in OpenBastion, **please do not open a public
GitHub issue**. Instead, contact the maintainer privately:

- **Email**: `security@<your-domain>` (replace before publishing)
- **GitHub Security Advisories**: <https://github.com/Nardann/OpenBastion/security/advisories/new>

Please include:

- A description of the vulnerability and its potential impact.
- The affected version (commit SHA if possible).
- A minimal reproduction (curl, screenshot, PoC code, ...).

We will acknowledge the report within **72 hours** and aim to publish a fix
or workaround within **14 days** for high or critical issues.

## Supported versions

The `main` branch carries the latest stable security patches. We backport
critical fixes to the most recent tagged minor release. Older releases are
unsupported.

| Version | Supported |
|---------|-----------|
| `main`  | ✅ |
| latest tagged release | ✅ |
| any older release | ❌ |

## Scope

In scope:

- Backend (`src/`) — authentication, authorisation, vault, gateways,
  audit, recordings.
- Frontend (`client/`) — XSS, CSRF, exposed endpoints.
- Default `docker-compose.yml` deployment topology.
- Container images built from this repo (`backend/Dockerfile`,
  `backend/Dockerfile.guacd`, `client/Dockerfile.frontend`).
- `nginx.conf` and `scripts/harden-perms.sh`.

Out of scope:

- Self-hosted modifications to the source code.
- Findings that require pre-existing root on the host.
- Issues in upstream dependencies that are already publicly tracked CVEs
  (open a dependency-bump PR instead).
- Self-XSS reachable only by pasting attacker-supplied JavaScript into
  the browser devtools.

## Hardening guidance

The repository ships with sensible defaults, but a public-facing
deployment requires additional steps documented in
[docs/PRODUCTION.md](../docs/PRODUCTION.md), including:

- Replacing the bundled self-signed TLS certificate.
- Storing secrets in a dedicated secret manager rather than `.env`.
- Configuring Postgres backups and verifying a restore drill.
- Putting a WAF or reverse proxy with rate-limiting in front of the
  bastion.
- Enforcing TOTP on every administrator account.

Independent third-party security testing is strongly recommended before
exposing OpenBastion to a network you do not control. A scoped engagement
brief is provided at
[docs/EXTERNAL_PENTEST_BRIEF.md](../docs/EXTERNAL_PENTEST_BRIEF.md).

## Security features overview

- **Authentication**: Argon2id, TOTP with ±1 window and replay protection,
  OIDC with PKCE + nonce + state, optional LDAP/AD with filter escaping.
- **Sessions**: Short-lived access JWT (15 min), refresh-token rotation
  with reuse detection (RFC 9700 §2.2.2), atomic revocation.
- **Vault**: AES-256-GCM with HKDF-derived per-resource subkeys, AAD
  binding by resource ID.
- **Audit**: HMAC-SHA256 chain on every entry; integrity is verifiable
  through `GET /api/audit/verify-integrity` (admin sudo).
- **Transport**: HTTPS-only at the edge; plaintext-HTTP origins are
  rejected at the CORS layer.
- **Containers**: `read_only` rootfs, `cap_drop: ALL`, `no-new-privileges`,
  isolated `backend-net` network with no host port exposure.

## Disclosure timeline

After a fix is released, we publish an advisory describing the
vulnerability, the affected versions, and the remediation. Reporter
credit is included unless the reporter prefers to remain anonymous.
