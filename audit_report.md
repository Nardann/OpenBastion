# Rapport d'Audit de Sécurité - OpenBastion

## Résumé Exécutif
Un audit de sécurité en boîte blanche a été réalisé sur le code source de l'application **OpenBastion**. L'application fait preuve d'une excellente maturité en matière de sécurité (utilisation stricte de Prisma empêchant les injections SQL, chiffrement robuste AES-256-GCM des secrets via un coffre-fort interne, protection CSRF/CORS stricte, RBAC granulaire, protection contre le SSRF). 

Cependant, une vulnérabilité critique a été identifiée concernant la **gestion des sessions actives lors de la révocation des accès**, permettant à un utilisateur banni ou révoqué de maintenir ses connexions aux terminaux.

---

## 1. Vulnérabilité Critique : Maintien des sessions WebSocket après révocation des tokens (Broken Session Management)

**Catégorie OWASP :** A01:2021 - Broken Access Control / A07:2021 - Identification and Authentication Failures
**Gravité :** Critique (CVSS: 9.0)

### Description
Lorsqu'un administrateur révoque les tokens d'un utilisateur (via `POST /users/:id/revoke-tokens`) ou désactive un utilisateur, la version du token (`tokenVersion`) de l'utilisateur est incrémentée en base de données. Cela empêche l'utilisateur d'utiliser son JWT actuel pour de nouvelles requêtes API HTTP.
Cependant, pour les sessions WebSocket de terminaux SSH et RDP (gérées dans `ssh.gateway.ts` et `rdp.gateway.ts`), la boucle de vérification périodique (`accessPoll`) qui s'exécute toutes les 30 secondes vérifie **uniquement** si l'utilisateur possède toujours les droits RBAC sur la machine (`rbacService.hasAccess`). Elle **ne vérifie pas** si la session de l'utilisateur (le `tokenVersion`) a été révoquée.
En conséquence, un utilisateur dont la session a été explicitement révoquée par un administrateur ne sera pas déconnecté de ses terminaux SSH/RDP en cours.

### Preuve de Concept (PoC)
1. L'utilisateur (Attaquant) se connecte légitimement et ouvre une session terminal SSH ou RDP sur une machine cible.
2. L'administrateur, suspectant une compromission, clique sur "Révoquer toutes les sessions" pour cet utilisateur (ce qui appelle `/users/:id/revoke-tokens`).
3. L'utilisateur tente de naviguer sur l'interface web : il est immédiatement déconnecté (API renvoie 401).
4. **Cependant**, dans son onglet terminal SSH/RDP déjà ouvert, l'utilisateur peut continuer à taper des commandes et voir l'écran indéfiniment (jusqu'à la limite codée en dur de 4 heures) car le WebSocket ne se ferme pas.

### Remédiation
Dans `ssh.gateway.ts` et `rdp.gateway.ts`, la vérification périodique `accessPoll` doit non seulement vérifier les droits RBAC, mais également vérifier que la version du token de l'utilisateur correspond toujours à celle stockée lors de la connexion initiale.

```typescript
// Exemple de correction dans ssh.gateway.ts (accessPoll)
const dbUser = await this.usersService.findOneById(user.sub);
if (!dbUser || dbUser.tokenVersion !== client.data.user.tokenVersion) {
  client.emit('error', 'Session révoquée');
  session.stream.end();
  // ... déconnexion
}
```

---

## 2. Vulnérabilité Faible : Déni de Service (DoS) partiel via Parameter Tampering

**Catégorie OWASP :** A03:2021 - Injection (Parameter Tampering)
**Gravité :** Faible (Informative)

### Description
Dans le contrôleur `RecordingController` (`backend/src/terminal/recording/recording.controller.ts`), les paramètres de requête HTTP (`userId` et `machineId`) ne sont pas strictement validés comme étant de type chaîne de caractères. Contrairement au `AuditController` qui a implémenté un correctif (`asOptionalString`) pour le paramètre *array poisoning*, le endpoint `GET /recordings` est vulnérable.
Si un utilisateur envoie un tableau de valeurs via l'URL (par exemple `?userId=id1&userId=id2`), Express parsera ce champ comme un tableau. Cela sera ensuite injecté dans Prisma (`where['userId'] = filterUserId`), ce qui entraînera une erreur d'exécution au niveau de l'ORM (qui attend un `String` et non un tableau de `String`). L'application renverra alors une erreur 500 Internal Server Error.

### Preuve de Concept (PoC)
Requête HTTP :
```bash
curl -b "jwt=<votre_token>" "https://localhost/api/recordings?userId=123&userId=456"
```
Résultat : L'API crash sur cette requête spécifique et renvoie une erreur 500 non gérée proprement.

### Remédiation
Appliquer la même méthode de validation rigoureuse que dans l'audit (ex: utiliser une fonction `asOptionalString` ou utiliser les `Pipes` de validation de NestJS).

---

## 3. Anomalie Informative : Faux Positifs potentiels dans la validation d'intégrité HMAC des Audits

**Catégorie OWASP :** A09:2021 - Security Logging and Monitoring Failures
**Gravité :** Informative

### Description
Le service `AuditService` (`backend/src/audit/audit.service.ts`) utilise un mécanisme très intéressant de HMAC pour garantir l'intégrité des logs d'audit en base de données.
Le HMAC est calculé en faisant un `JSON.stringify` d'un objet contenant le champ `metadata` et `userSnapshot` (qui sont des `JsonB` dans PostgreSQL).
Or, l'ordre des clés d'un objet JSON n'est pas garanti. Si Prisma ou PostgreSQL restitue l'objet `metadata` avec un ordre de clés différent de celui au moment de l'insertion, le résultat de `JSON.stringify` sera différent. Lors de l'appel à l'API `GET /audit/verify-integrity`, cela produira une incohérence de hash et signalera à tort des logs comme altérés (Faux Positifs).

### Remédiation
Trier récursivement les clés de l'objet JSON avant de générer la chaîne de caractères (ex: via une librairie tierce comme `json-stable-stringify`), ou hacher individuellement les valeurs textuelles plutôt que le dump complet du JSON.

---

## Conclusion et Points Forts

Malgré la faille liée au maintien des WebSockets après révocation, **le niveau de sécurité global de l'application est exceptionnel**. 
Voici quelques très bonnes pratiques qui ont été validées durant cet audit :
- **Protection SSRF :** Le code gérant les sondages SSH (`assertProbeTargetAllowed`) et OIDC interdit explicitement le ciblage des IP locales, Loopback ou Cloud Metadata.
- **Défense Cryptographique :** Les clés privées et les mots de passe des machines sont correctement chiffrés en base de données via AES-256-GCM avec une génération correcte des IVs et tags d'authentification forcés à 16 bytes.
- **Mitigation des Timing Attacks :** Les vérifications de mots de passe OTP et d'empreintes SSH utilisent correctement `crypto.timingSafeEqual`.
- **Politique de Mots de Passe :** Exigence stricte sur la complexité (12 caractères min, maj, min, num, spécial).

**Action immédiate recommandée :** Corriger le fichier `ssh.gateway.ts` et `rdp.gateway.ts` pour que la boucle `accessPoll` vérifie la validité du JWT et de sa version (`tokenVersion`).