# OpenBastion — RDP (Remote Desktop) Support

Ce document décrit le proxy RDP intégré à OpenBastion, basé sur une image
`guacd` minimale (Apache Guacamole stripped à RDP-only). Le bastion expose
la machine cible via un terminal graphique HTML5 dans le navigateur, sans
jamais exposer les credentials au client.

---

## 1. Architecture

```
Navigateur (React + guacamole-common-js)
        │  Socket.IO namespace `/rdp`  (JWT cookie, WSS uniquement)
        ▼
NestJS RdpGateway ── RBAC check ── vault decrypt
        │  TCP 4822 (backend-net, jamais exposé à l'hôte)
        ▼
guacd (image custom, RDP-only, read-only FS, cap_drop ALL)
        │  RDP 3389
        ▼
Machine Windows / serveur cible
```

Le **handshake Guacamole** (`select` → `args` → `size` / `audio` / `video` /
`image` / `timezone` → `connect`) est réalisé **côté backend**. Les
credentials (mot de passe, domaine AD) sont injectés dans la trame
`connect` avant que le pipeline ne bascule en mode « pipe raw ». Le
navigateur ne voit que les frames post-handshake.

---

## 2. Activation

### 2.1 Variables d'environnement

| Variable            | Défaut   | Description                                  |
| ------------------- | -------- | -------------------------------------------- |
| `GUACD_HOST`        | `guacd`  | Nom DNS du container guacd (backend-net).    |
| `GUACD_PORT`        | `4822`   | Port TCP guacd (jamais exposé à l'hôte).     |
| `SESSION_INACTIVITY_MS` | `1800000` | Timeout d'inactivité (ms) appliqué aussi au RDP. |

Aucune variable n'est à ajouter côté `.env` en configuration par défaut —
`docker-compose.yml` fournit déjà les valeurs.

### 2.2 Build de l'image guacd

```bash
docker compose build guacd
docker compose up -d guacd
```

L'image est produite depuis `Dockerfile.guacd` (multi-stage Debian
`bookworm-slim`) avec `./configure --with-rdp --without-ssh --without-vnc
--without-telnet --without-kubernetes --disable-guacenc --disable-guaclog`.
Poids ≈ 85 Mo, RAM au repos ≈ 8-15 Mo.

Hardening appliqué :
- `read_only: true` + tmpfs 16 Mo sur `/tmp`
- `security_opt: no-new-privileges`
- `cap_drop: [ALL]`
- utilisateur non-root `uid 1001`
- limites `mem_limit: 256m`, `cpus: 1.0`
- pas de port exposé à l'hôte (backend-net uniquement)

---

## 3. Migration de base de données

### 3.1 Nouveau déploiement

`scripts/init-db/init.sql` a été mis à jour : toute base fraîche est déjà
prête.

### 3.2 Base existante

Appliquer la migration idempotente :

```bash
psql "$DATABASE_URL" -f scripts/init-db/migration-rdp.sql
```

La migration :
- crée l'enum `RdpSecurity { ANY, RDP, TLS, NLA }` si absent
- ajoute `rdpSecurity`, `rdpIgnoreCert`, `rdpDomain` à `Machine`
- rend `sshFingerprint` nullable (obligatoire uniquement pour SSH)

Elle utilise `ADD COLUMN IF NOT EXISTS` et `DO $$ ... $$` pour être
ré-exécutable sans effet de bord.

Après la migration : `npx prisma generate` pour régénérer le client.

---

## 4. Créer une machine RDP

Dans l'UI `/administration/machines` → « Nouvelle machine » :

1. Sélectionner **Protocole : RDP** (le port bascule automatiquement à 3389).
2. **Mode de sécurité** :
   - `NLA` (défaut recommandé, Windows 2012+)
   - `TLS` (legacy TLS-only)
   - `RDP` (RDP standard security, déconseillé)
   - `ANY` (guacd négocie)
3. **Domaine AD** : optionnel, `MONDOMAINE` ou `corp.local`.
4. **Ignorer certificat** : à activer uniquement pour les serveurs avec
   certificats auto-signés (log d'audit explicite).
5. Renseigner username / password — stockés chiffrés AES-256-GCM dans la
   table `Secret` (clé dérivée par machine via HKDF).

L'empreinte SSH n'est **pas demandée** pour une machine RDP.

---

## 5. Flux session utilisateur

1. Sur le Dashboard, cliquer **« Ouvrir le bureau distant »** sur une carte
   de machine RDP (icône `Monitor`).
2. La page `/rdp/:id` se charge, ouvre un `Socket.IO` sur `/rdp`.
3. Le gateway vérifie :
   - JWT valide (cookie) et non blacklisté
   - max 5 sessions/user, 15 connexions/min/IP
   - RBAC `AccessLevel.OPERATOR` sur la machine (re-check toutes les 30 s)
   - protocole de la machine == `RDP`
4. Handshake guacd → bascule en mode pipe.
5. `xterm.js` n'est pas utilisé : le display est un canvas HTML5 contrôlé
   par `Guacamole.Client` (souris/clavier natifs).

Limites par session :
- durée max 4 h (auto-kill)
- inactivité 30 min (override via `SESSION_INACTIVITY_MS`)
- message max 2 Mo (pour accommoder les frames image)

Audit (`AuditCategory.TERMINAL`) :
- `RDP: SESSION_STARTED` avec `{ machineId, machineName, ip, security }`
- `RDP: SESSION_CLOSED` avec `{ machineId, duration }`

---

## 6. Politique presse-papiers

Chaque machine a un booléen `allowCopyPaste`. Si `false` :
- guacd reçoit `disable-copy=true` et `disable-paste=true`
- le front bloque aussi `copy/paste/cut` au niveau DOM (redondance
  defense-in-depth)
- un badge rouge « Mode Isolé » s'affiche dans le header de session

Les flags `disable-download` et `disable-upload` sont toujours à `true` :
aucun transfert de fichier n'est autorisé via le canal RDP bastion.

---

## 7. Structure fichiers ajoutés / modifiés

Backend :
- `src/terminal/guac-protocol.ts` — codec Guacamole (encode + parser stream)
- `src/terminal/rdp.service.ts` — handshake guacd, mapping paramètres
- `src/terminal/rdp.gateway.ts` — namespace `/rdp`, RBAC, audit, limites
- `src/terminal/dto/rdp.dto.ts` — DTOs `start-session` / `resize`
- `src/terminal/terminal.module.ts` — ajoute `RdpGateway` + `RdpService`
- `src/common/dto/security.dto.ts` — champs RDP + `@ValidateIf` SSH-only

Infra :
- `Dockerfile.guacd` — image custom minimale
- `docker-compose.yml` — service `guacd`, env `GUACD_HOST/PORT`, depends_on
- `prisma/schema.prisma` — enum `RdpSecurity`, champs `Machine`, `sshFingerprint?`
- `scripts/init-db/init.sql` — schéma initial mis à jour
- `scripts/init-db/migration-rdp.sql` — migration idempotente

Frontend :
- `client/src/lib/guacSocketIoTunnel.ts` — sous-classe `Guacamole.Tunnel`
- `client/src/pages/RdpSession.tsx` — page session RDP
- `client/src/pages/Dashboard.tsx` — routing conditionnel SSH/RDP
- `client/src/pages/AdminMachines.tsx` — formulaire protocol-aware
- `client/src/App.tsx` — route `/rdp/:id`
- `client/package.json` — `guacamole-common-js` + types

---

## 8. Troubleshooting

**« guacd connection timeout »** : le container guacd n'est pas démarré ou
la résolution DNS échoue. Vérifier `docker compose ps guacd` et le
healthcheck (`nc -z 127.0.0.1 4822`).

**« Expected "args" instruction from guacd, got "error" »** : guacd a
rejeté `select.rdp`. Typiquement une version de guacd où le plugin RDP
n'est pas chargé — reconstruire l'image.

**Écran noir après connexion** : vérifier le mode de sécurité côté
Windows (cible Win 2012+ → NLA par défaut). Si serveur legacy, basculer
la machine sur `TLS` ou `ANY`.

**Certificat invalide** : activer `rdpIgnoreCert` uniquement si le
certificat est auto-signé et la machine est en réseau interne de
confiance. Une entrée d'audit explicite est créée.

**Sessions qui se coupent à 30 min** : timeout d'inactivité standard,
ajustable via `SESSION_INACTIVITY_MS` (en millisecondes).

---

## 9. Limites connues

- Pas d'audio (désactivé pour limiter la bande passante et la surface
  d'attaque).
- Pas de redirection USB/imprimante/drive (explicitement désactivé).
- Pas de reconnexion automatique : un drop réseau ferme la session et
  génère un audit `RDP: SESSION_CLOSED`.
- Une seule résolution par session (pas d'auto-resize côté serveur
  au-delà du `size` initial et `display-update`).
- L'enregistrement vidéo des sessions RDP n'est pas encore activé (le
  binaire `guacenc` est volontairement désactivé dans l'image pour
  réduire la surface ; sera réactivé avec le lecteur de sessions).
