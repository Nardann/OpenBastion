# Analyse et Corrections - LDAP et OIDC

## 🔍 ANALYSE DES PROBLÈMES

### 1. LDAP (Windows Active Directory)

#### Problème 1: Search Filter incorrect
**Actuel:** `(uid={{username}})` - filtrage standard UNIX
**Correct:** `(sAMAccountName={{username}})` ou `(userPrincipalName={{username}})` pour AD

**Impact:** Impossible de trouver les utilisateurs dans Active Directory

#### Problème 2: Attribut email
**Actuel:** Utilise `mail` directement
**Correct:** Devrait checker `mail`, puis fallback sur `proxyAddresses[0]`

**Impact:** Utilisateurs sans email ne peuvent pas se connecter

#### Problème 3: Comptes désactivés
**Manquant:** Pas de vérification de `userAccountControl`
**Correct:** Ajouter filtre `(!(userAccountControl:1.2.840.113556.1.4.803:=2))` pour exclure les comptes désactivés

**Impact:** Comptes désactivés peuvent toujours se connecter

#### Problème 4: Bind anonyme non supporté
**Manquant:** Nécessite toujours un bind DN et password
**Correct:** Supporter la connexion anonyme pour la recherche

### 2. OIDC (Authentik/OpenID Connect)

#### Problème 1: API openid-client incorrecte
**Actuel:** Utilise `discovery()`, `buildAuthorizationUrl()`, `authorizationCodeGrant()`
**Version:** Code basé sur openid-client v4, mais compatible v5+

#### Problème 2: Validation callback - API incorrecte
**Actuel:** Passe `expectedState`, `expectedNonce` directement à `authorizationCodeGrant()`
**Correct:** Ces paramètres doivent être validés via la callback URL

#### Problème 3: fetchUserInfo signature
**Actuel:** Passe `client_id`, `client_secret` et `sub` explicitement
**Correct:** Utiliser directement `tokens.access_token` sans client credentials

#### Problème 4: SSL/TLS - DANGEREUX
**Actuel:** Désactive globalement `NODE_TLS_REJECT_UNAUTHORIZED`
**Danger:** 
- Affecte TOUTES les requêtes HTTPS (pas juste OIDC)
- Vulnérable aux attaques MITM
- Non-thread-safe

**Correct:** Utiliser agent HTTP avec `rejectUnauthorized: false` localement

## 📋 CORRECTIONS À APPLIQUER

### Fichiers à modifier:
1. `src/auth/ldap.service.ts` - Correction search filter et attributs
2. `src/auth/oidc.service.ts` - Correction API openid-client et SSL handling
3. `.env` - Configuration LDAP et OIDC de base

## ✅ RÉSULTAT ATTENDU
- Connexion LDAP fonctionnelle avec Windows AD
- Connexion OIDC fonctionnelle avec Authentik
- Sécurité SSL/TLS respectée
- Gestion correcte des attributs utilisateur
