# Bastion Node

Un Bastion de Sécurité (PAM) moderne et souverain, écrit en Node.js et React.

## 🚀 Caractéristiques

- **Accès SSH Direct** : Connexion sécurisée sans exposition des identifiants.
- **Multi-Auth** : Support Local, LDAP/AD et OIDC (SSO).
- **Contrôle d'Accès** : RBAC granulaire liant utilisateurs, groupes et machines.
- **Audit & Monitoring** : Traçabilité totale des actions et scanner d'intégrité.
- **Sécurité Maximale** : Chiffrement AES-256-GCM contextuel, Rate Limiting, Zéro-trust.

## 🛠️ Stack Technique

- **Backend** : NestJS, Prisma, PostgreSQL, SSH2.
- **Frontend** : React, Vite, Tailwind CSS, xterm.js.

## 📦 Installation

1.  **Cloner le projet**
    ```bash
    git clone https://github.com/nardann/OpenBastion.git
    cd OpenBastion
    ```

2.  **Configuration**
    Créez un fichier `.env` à la racine (basé sur l'exemple du .env.example).

3.  **Lancement via Docker**
    ```bash
    sudo docker compose up -d --build
    ```

4.  **Accès**
    - Frontend : `https://localhost`
    - Backend API : `https://localhost:${BACKEND_PORT}`
    - Compte par défaut : `admin@bastion.local` / `${ADMIN_PASSWORD}`

