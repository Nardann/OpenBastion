# Guide de Test - LDAP & OIDC

## 🚀 Démarrage Rapide

### Prérequis
- Backend OpenBastion en cours d'exécution
- Token JWT administrateur (obtenu après login admin)
- Base de données PostgreSQL initialisée

### 1. Configuration LDAP (Windows Active Directory)

#### Étape 1: Créer le fournisseur LDAP

```bash
#!/bin/bash

ADMIN_TOKEN="<YOUR_ADMIN_JWT_TOKEN>"
BACKEND_URL="http://localhost:4000"

curl -X POST "${BACKEND_URL}/auth/providers/upsert" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{
    "type": "LDAP",
    "enabled": true,
    "config": {
      "url": "ldap://192.168.1.100:389",
      "searchBase": "ou=Users,dc=company,dc=com",
      "bindDn": "cn=BaseLdapUser,ou=ServiceAccounts,dc=company,dc=com",
      "bindPassword": "ServiceAccountPassword123!",
      "searchFilter": "(sAMAccountName={{username}})",
      "isActiveDirectory": true
    }
  }'
```

#### Étape 2: Tester la connexion LDAP

```bash
curl -X POST "${BACKEND_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "john.doe",
    "password": "UserPassword123!",
    "authMethod": "LDAP"
  }'
```

**Résultat attendu:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "requiresOtp": false
}
```

**Erreurs courantes:**
- `"Identifiants invalides"` → Vérifier username/password ou filter LDAP
- `"LDAP User has no email attribute"` → Ajouter email à l'utilisateur AD
- `"LDAP Auth failed: ldaperror: 80090308"` → Binddn/password incorrect

#### Étape 3: Tester les cas limites

**Cas 1: Compte désactivé (should fail)**
```bash
# Supposant que 'disabled.user' est un compte AD désactivé
curl -X POST "${BACKEND_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "disabled.user",
    "password": "Password123!",
    "authMethod": "LDAP"
  }'
# Doit retourner: 401 Identifiants invalides
```

**Cas 2: Utilisateur sans email (should fail)**
```bash
# Supposant que 'no.email.user' n'a pas d'attribut mail
curl -X POST "${BACKEND_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "no.email.user",
    "password": "Password123!",
    "authMethod": "LDAP"
  }'
# Doit retourner: 401 Identifiants invalides (avec log: "has no email attribute")
```

---

## 🔑 Configuration OIDC (Authentik)

### Étape 1: Configuration Authentik

1. **Accéder à Authentik Admin Panel**
   - URL: `https://authentik.example.com/if/admin/`
   - Connectez-vous comme administrateur

2. **Créer une nouvelle application OAuth2/OpenID**
   - Menu: **Applications** → **OAuth2/OpenID** → **Applications**
   - Cliquer: **Create**

3. **Remplir les paramètres:**
   ```
   Name: OpenBastion
   Slug: openbastion
   Provider: [Créer nouveau provider - voir ci-dessous]
   ```

4. **Créer le Provider OIDC**
   - Menu: **Applications** → **OAuth2/OpenID** → **Providers**
   - Cliquer: **Create**
   
   ```
   Name: OpenBastion OIDC
   Authentication Flow: [Select default authentication flow]
   Authorization Flow: [Select default authorization flow]
   Client ID: openbastion-client
   Client Secret: [Generate] → Copier la valeur
   Redirect URIs:
   - https://bastion.example.com/auth/oidc/callback
   - http://localhost:3000/auth/oidc/callback (DEV ONLY)
   
   Advanced protocol settings:
   - Scopes: openid profile email
   - Access Token lifetime: 86400 (24 hours)
   - Refresh Token lifetime: 604800 (7 days)
   ```

5. **Vérifier l'endpoint OIDC Discovery**
   ```bash
   curl -s https://authentik.example.com/application/o/openbastion/.well-known/openid-configuration | jq
   ```
   
   Doit retourner:
   ```json
   {
     "issuer": "https://authentik.example.com/application/o/openbastion/",
     "authorization_endpoint": "...",
     "token_endpoint": "...",
     "userinfo_endpoint": "...",
     "jwks_uri": "...",
     ...
   }
   ```

### Étape 2: Créer le fournisseur OIDC dans OpenBastion

```bash
#!/bin/bash

ADMIN_TOKEN="<YOUR_ADMIN_JWT_TOKEN>"
BACKEND_URL="http://localhost:4000"
CLIENT_SECRET="<FROM_AUTHENTIK>"

curl -X POST "${BACKEND_URL}/auth/providers/upsert" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d "{
    \"type\": \"OIDC\",
    \"enabled\": true,
    \"config\": {
      \"issuer\": \"https://authentik.example.com/application/o/openbastion/\",
      \"clientId\": \"openbastion-client\",
      \"clientSecret\": \"${CLIENT_SECRET}\",
      \"callbackUrl\": \"https://bastion.example.com/auth/oidc/callback\"
    }
  }"
```

### Étape 3: Tester le flux OIDC (dans le navigateur)

1. **Obtenir l'URL d'autorisation:**
   ```bash
   curl -X GET "http://localhost:4000/auth/oidc/authorize" \
     -H "Content-Type: application/json"
   ```
   
   Répond:
   ```json
   {
     "authorizationUrl": "https://authentik.example.com/application/o/openbastion/authorize?..."
   }
   ```

2. **Cliquer sur l'URL** ou l'ouvrir dans le navigateur
3. **Authentifier auprès d'Authentik** (username/password)
4. **Approuver l'accès** si demandé
5. **Être redirigé vers** `https://bastion.example.com/auth/oidc/callback?code=...&state=...`

**Résultat attendu:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "requiresOtp": false,
  "user": {
    "id": "...",
    "email": "user@example.com",
    "role": "USER",
    "authMethod": "OIDC"
  }
}
```

---

## 🔍 Débogage & Logs

### Logs Backend

**Activer les logs détaillés:**
```bash
# Dans .env
NODE_ENV=development  # Enable debug logs
LOG_LEVEL=debug
```

**Rechercher les logs LDAP:**
```bash
docker logs openbastion-backend 2>&1 | grep -i "ldap"
```

**Rechercher les logs OIDC:**
```bash
docker logs openbastion-backend 2>&1 | grep -i "oidc"
```

### Erreurs Courantes

#### LDAP

| Erreur | Cause | Solution |
|--------|-------|----------|
| `LDAP Auth failed: ldaperror: 80090308: LdapErr: DSID-0C090400` | Bind DN incorrect | Vérifier DN dans Active Directory |
| `Search returned 0 results` | SearchFilter incorrect | Vérifier `searchFilter` et `searchBase` |
| `LDAP User has no email attribute` | Pas d'attribut `mail` ou `proxyAddresses` | Ajouter email à l'utilisateur AD |
| `Connection refused` | Port LDAP incorrect | Vérifier port 389 (LDAP) ou 636 (LDAPS) |

**Diagnostiquer avec `ldapsearch`:**
```bash
# Installer: apt-get install ldap-utils
ldapsearch -x -H "ldap://192.168.1.100:389" \
  -D "cn=admin,dc=company,dc=com" \
  -w "password" \
  -b "dc=company,dc=com" \
  "(sAMAccountName=john.doe)"
```

#### OIDC

| Erreur | Cause | Solution |
|--------|-------|----------|
| `OIDC discovery failed: getaddrinfo ENOTFOUND` | Issuer URL inaccessible | Vérifier DNS, firewall, URL |
| `Invalid code parameter` | Client ID/Secret mismatch | Vérifier Authentik config |
| `OIDC user has no email claim` | Authentik n'envoie pas `email` | Ajouter scope `email` à Authentik |
| `State mismatch` | Cookie de session perdu | Vérifier CORS, cookies |

**Diagnostiquer OIDC Discovery:**
```bash
curl -v https://authentik.example.com/application/o/openbastion/.well-known/openid-configuration
# Doit retourner 200 avec les endpoints
```

---

## 📈 Cas de Test Complets

### Scénario LDAP

```gherkin
Scénario: Connexion LDAP réussie
  Donné un utilisateur "john.doe" dans AD avec email "john@company.com"
  Quand je POST /auth/login avec LDAP:john.doe:password123
  Alors je reçois un access_token
  Et l'utilisateur est créé en DB avec authMethod=LDAP

Scénario: Compte AD désactivé est rejeté
  Donné un utilisateur "disabled.user" avec userAccountControl=2 (DISABLED)
  Quand je POST /auth/login avec LDAP:disabled.user:password123
  Alors je reçois 401 Unauthorized

Scénario: Utilisateur sans email est rejeté
  Donné un utilisateur "no.email" sans attribut mail ni proxyAddresses
  Quand je POST /auth/login avec LDAP:no.email:password123
  Alors je reçois 401 Unauthorized
```

### Scénario OIDC

```gherkin
Scénario: Flux OIDC complet
  Quand je GET /auth/oidc/authorize
  Alors je reçois authorizationUrl vers Authentik
  
  Quand je complète l'authentification Authentik
  Alors je suis redirigé vers /auth/oidc/callback?code=...&state=...
  
  Et j'ai accès_token + refresh_token
  Et l'utilisateur est créé en DB avec authMethod=OIDC

Scénario: Utilisateur Authentik sans email est rejeté
  Donné un utilisateur Authentik sans email claim
  Quand je complète OIDC callback
  Alors je reçois 401 Unauthorized
```

---

## ✅ Checklist de Vérification

- [ ] LDAP bind avec serviceAccount fonctionne
- [ ] LDAP search filtre les utilisateurs correctement
- [ ] Comptes AD désactivés sont rejetés
- [ ] Extraction email fonctionne (mail + proxyAddresses)
- [ ] OIDC discovery endpoint répond
- [ ] OIDC authorizationUrl est générée
- [ ] OIDC callback échange le code correctement
- [ ] UserInfo est fetché avec le token d'accès
- [ ] Email claim est extrait
- [ ] JIT provisioning crée l'utilisateur en DB
- [ ] SSL/TLS fonctionne (pas de désactivation globale)
- [ ] Logs sont clairs et utiles

---

## 📞 Support

Pour les problèmes:
1. Vérifier les **logs du backend**: `docker logs openbastion-backend`
2. Vérifier la **connectivité réseau** aux serveurs (LDAP, Authentik)
3. Vérifier les **certificats SSL/TLS** (en dev: agent sans vérification)
4. Contacter l'administrateur LDAP/Authentik pour les configs
