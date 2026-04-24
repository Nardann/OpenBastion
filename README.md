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
   Create a `.env` file at the root (based on `.env.example`):

3. **Launch with Docker**
   ```bash
   sudo docker compose up -d --build
   ```

4. **Access the application**
   - Frontend: `https://localhost`
   - Backend API: `https://localhost:${BACKEND_PORT}`
   - Default admin account: `admin@bastion.local` / `${ADMIN_PASSWORD}`

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
