# Correctifs LDAP & OIDC - Résumé des Modifications

## 📝 Fichiers Modifiés

### 1. `src/auth/ldap.service.ts`

#### ✅ Corrections Appliquées:

**A) Support pour Windows Active Directory**
```typescript
// Avant: Recherche LDAP générique
const searchFilter = config.searchFilter || '(uid={{username}})';

// Après: Support Windows AD et LDAP générique
const defaultFilter = config.isActiveDirectory
  ? '(sAMAccountName={{username}})'  // Windows AD
  : '(uid={{username}})';              // LDAP générique
```

**B) Filtre pour exclure les comptes désactivés**
```typescript
// Active Directory: Ajoute filtre pour exclure comptes avec bit 2 (ACCOUNT_DISABLED)
if (config.isActiveDirectory && !finalFilter.includes('userAccountControl')) {
  finalFilter = `(&${finalFilter}(!(userAccountControl:1.2.840.113556.1.4.803:=2)))`;
}
```

**C) Support du bind anonyme**
```typescript
// Avant: Requis toujours
bindDn: config.bindDn,
bindCredentials: config.bindPassword,

// Après: Optionnel (support bind anonyme)
...(config.bindDn && config.bindPassword && {
  bindDn: config.bindDn,
  bindCredentials: config.bindPassword,
}),
```

**D) Extraction d'email robuste**
```typescript
// Avant: Utilise directement `mail`
const email = ldapUser.mail;

// Après: `mail` → `proxyAddresses` (important pour AD)
let email = ldapUser.mail;
if (!email && ldapUser.proxyAddresses) {
  const smtpAddr = (Array.isArray(ldapUser.proxyAddresses)
    ? ldapUser.proxyAddresses
    : [ldapUser.proxyAddresses]
  ).find((addr: string) => addr.toLowerCase().startsWith('smtp:'));
  if (smtpAddr) {
    email = smtpAddr.substring(5); // Enlève 'smtp:' prefix
  }
}
```

**E) Configuration AD-spécifique**
```typescript
...(config.isActiveDirectory && {
  referrals: false,      // AD envoie des referrals sur échec
  sizeLimit: 1000,       // Limite taille résultats
}),
```

---

### 2. `src/auth/oidc.service.ts`

#### ❌ Problèmes Critiques Corrigés:

**A) API openid-client v5+ Correcte**

Avant (INCORRECT):
```typescript
// Ces méthodes n'existent pas ou ont des signatures incorrectes
const serverMetadata = await oidc.discovery(new URL(issuerUrl), ...);
const authorizationUrl = oidc.buildAuthorizationUrl(config, {...});
const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {...});
const userinfo = await oidc.fetchUserInfo(config, tokens.access_token, ...);
```

Après (CORRECT):
```typescript
// OIDC Discovery via Issuer
const issuer = await oidc.Issuer.discover(issuerUrl, { agent: httpsAgent });
const client = new issuer.Client({ client_id, client_secret, redirect_uris, response_types });

// Authorization URL
const authorizationUrl = client.authorizationUrl({ scope, state, nonce, redirect_uri });

// Token Exchange
const params = client.callbackParams(currentUrl);
const tokenSet = await client.callback(redirectUri, params, { state, nonce }, { agent });

// User Info
const userinfo = await client.userinfo(tokenSet, { agent });
```

**B) Sécurité SSL/TLS Améliorée**

Avant (DANGEREUX):
```typescript
// Désactive GLOBALEMENT SSL pour TOUT le processus Node.js
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';  // 🚨 MITM attack vector!
// ... opérations ...
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '1';
```

Après (SÉCURISÉ):
```typescript
// Crée un agent HTTPS local avec rejectUnauthorized: false
private getHttpsAgent(issuerUrl: string) {
  const isInternal = issuerUrl.includes('localhost') || ...;
  
  if (isInternal && process.env.NODE_ENV !== 'production') {
    this.logger.warn('Using insecure HTTPS agent for internal OIDC issuer');
    return new https.Agent({ rejectUnauthorized: false });
  }
  return undefined; // Production: standard HTTPS verification
}

// Utilisé localement:
const httpsAgent = this.getHttpsAgent(issuerUrl);
const issuer = await oidc.Issuer.discover(issuerUrl, { agent: httpsAgent });
```

**C) Caching du Client (pas des metadata)**

Avant:
```typescript
private configCache: Map<string, { config: any; ... }> = new Map();
const serverMetadata = await oidc.discovery(...);
this.configCache.set(provider.id, { config: serverMetadata, ... });
```

Après:
```typescript
private configCache: Map<string, { client: any; ... }> = new Map();
const client = new issuer.Client({...});
this.configCache.set(provider.id, { client, ... });
```

**D) Validation Correcte des Paramètres Callback**

Avant (INCORRECT - expectedState/expectedNonce ne sont pas des paramètres):
```typescript
const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
  expectedState: savedState,
  expectedNonce: savedNonce,
  // ...
});
```

Après (CORRECT):
```typescript
const params = client.callbackParams(currentUrl); // Extrait code, state, etc de URL
const tokenSet = await client.callback(
  redirectUri,
  params,
  { state: savedState, nonce: savedNonce }, // Passés ici pour validation
  { agent: httpsAgent }
);
```

**E) Validation des Claims Requises**

```typescript
// Valide les claims essentiels
if (!userinfo.email) {
  this.logger.error('OIDC user has no email claim');
  return null;
}

if (!userinfo.sub) {
  this.logger.error('OIDC user has no sub claim');
  return null;
}
```

---

## 📊 Comparaison Avant/Après

| Aspect | Avant | Après |
|--------|-------|-------|
| **LDAP Windows AD** | ❌ Filter `(uid=...)` incorrect | ✅ `(sAMAccountName=...)` correct |
| **LDAP Comptes Désactivés** | ❌ Non filtrés | ✅ Exclu avec `userAccountControl` |
| **LDAP Email** | ⚠️ Seulement `mail` | ✅ `mail` + fallback `proxyAddresses` |
| **OIDC API** | ❌ API incorrecte | ✅ openid-client v5+ API correcte |
| **OIDC Callback** | ❌ Validation incorrecte | ✅ Validation correcte via `client.callback()` |
| **OIDC SSL/TLS** | 🚨 Désactif globalement | ✅ Agent local, prod-safe |
| **OIDC Caching** | ⚠️ Metadata cachées | ✅ Client cachée (plus performant) |

---

## 🧪 Tests Recommandés

### LDAP
1. **Tester avec compte AD valide**
   ```bash
   POST /auth/login
   { "identifier": "john.doe", "password": "...", "authMethod": "LDAP" }
   ```

2. **Tester compte désactivé** - Doit être rejeté
3. **Tester compte sans email** - Doit être rejeté
4. **Tester bind anonyme** - Si `bindDn` non fourni

### OIDC
1. **Tester discovery endpoint**
   ```bash
   GET https://authentik.example.com/application/o/openbastion/.well-known/openid-configuration
   ```

2. **Tester login flow complet**
3. **Tester callback avec code** - Doit échanger correctement
4. **Tester user sans email** - Doit être rejeté

---

## 🔧 Configuration Requise

### Pour Windows AD
```json
{
  "url": "ldap://ad.company.com:389",
  "searchBase": "dc=company,dc=com",
  "bindDn": "cn=service_account,dc=company,dc=com",
  "bindPassword": "***",
  "searchFilter": "(sAMAccountName={{username}})",
  "isActiveDirectory": true
}
```

### Pour Authentik
```json
{
  "issuer": "https://authentik.example.com/application/o/openbastion/",
  "clientId": "openbastion-client",
  "clientSecret": "***",
  "callbackUrl": "https://bastion.example.com/auth/oidc/callback"
}
```

---

## ⚠️ Notes de Sécurité

1. **LDAP**: Utilisez **LDAPS (port 636)** en production
2. **OIDC**: Vérifiez que **callbackUrl est HTTPS** en production
3. **Secrets**: Stockez `bindPassword` et `clientSecret` de manière sécurisée (Vault)
4. **SSL**: Ne désactivez jamais SSL en production
