# LDAP & OIDC Configuration Examples

## 📋 LDAP Configuration (Windows Active Directory)

### Database Setup
First, create the LDAP provider in the database:

```bash
# Using the admin API
curl -X POST http://localhost:4000/auth/providers/upsert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{
    "type": "LDAP",
    "enabled": true,
    "config": {
      "url": "ldap://192.168.1.100:389",
      "searchBase": "dc=company,dc=com",
      "bindDn": "cn=admin,dc=company,dc=com",
      "bindPassword": "AdminPassword123!",
      "searchFilter": "(sAMAccountName={{username}})",
      "isActiveDirectory": true
    }
  }'
```

### Configuration Details

| Property | Value | Description |
|----------|-------|-------------|
| `url` | `ldap://192.168.1.100:389` | LDAP server URL (use port 636 for LDAPS) |
| `searchBase` | `dc=company,dc=com` | Base DN where users are located |
| `bindDn` | `cn=admin,dc=company,dc=com` | Service account DN for binding |
| `bindPassword` | `***` | Service account password |
| `searchFilter` | `(sAMAccountName={{username}})` | **Windows AD** - searches by SAM account name |
| `searchFilter` | `(userPrincipalName={{username}})` | **Windows AD** - alternative: searches by UPN |
| `searchFilter` | `(uid={{username}})` | **Generic LDAP** - searches by uid attribute |
| `isActiveDirectory` | `true` | Enables AD-specific optimizations |

### Active Directory Specific Features

When `isActiveDirectory: true`, the service will:
1. **Exclude disabled accounts** - Adds filter `(!(userAccountControl:1.2.840.113556.1.4.803:=2))`
2. **Handle proxyAddresses** - Falls back from `mail` to `proxyAddresses` for email extraction
3. **Set referrals: false** - Disables referral following (AD sends referrals on failed binds)
4. **Set sizeLimit: 1000** - Prevents excessive result sets

### Testing LDAP Connection

```bash
# Test with ldapsearch (Linux)
ldapsearch -x -H ldap://192.168.1.100:389 \
  -D "cn=admin,dc=company,dc=com" \
  -w "AdminPassword123!" \
  -b "dc=company,dc=com" \
  "(sAMAccountName=john.doe)"
```

## 🔑 OIDC Configuration (Authentik)

### Database Setup

```bash
curl -X POST http://localhost:4000/auth/providers/upsert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{
    "type": "OIDC",
    "enabled": true,
    "config": {
      "issuer": "https://authentik.example.com/application/o/openbastion/",
      "clientId": "openbastion-client",
      "clientSecret": "YOUR_CLIENT_SECRET_HERE",
      "callbackUrl": "https://bastion.example.com/auth/oidc/callback"
    }
  }'
```

### Configuration Details

| Property | Value | Description |
|----------|-------|-------------|
| `issuer` | `https://authentik.example.com/application/o/openbastion/` | **EXACT** Authentik OIDC endpoint |
| `clientId` | `openbastion-client` | OAuth2 Application Client ID from Authentik |
| `clientSecret` | `***` | OAuth2 Application Client Secret from Authentik |
| `callbackUrl` | `https://bastion.example.com/auth/oidc/callback` | Redirect URI registered in Authentik |

### Getting Configuration from Authentik

1. Go to **Admin Interface** → **Applications** → **OAuth2/OpenID** → **Applications**
2. Create new or find existing application
3. Note:
   - **Client ID** and **Client Secret** from the application
   - **Provider** configuration page for the issuer URL

### OpenID Connect Metadata Discovery

The service automatically discovers:
- Authorization endpoint
- Token endpoint
- UserInfo endpoint
- Supported scopes
- JWKS (JSON Web Key Set)

Discovery happens from: `https://authentik.example.com/application/o/openbastion/.well-known/openid-configuration`

### Required Authentik Application Settings

In Authentik, create an OAuth2/OpenID Provider with:

```
- Name: OpenBastion
- Authentication Flow: [Select appropriate flow]
- Authorization Flow: [Select appropriate flow]
- Client ID: openbastion-client
- Client Secret: [Generate with button]
- Redirect URIs: 
  - https://bastion.example.com/auth/oidc/callback
  - http://localhost:3000/auth/oidc/callback (for dev)
- Scopes: openid, email, profile
```

### Testing OIDC Configuration

```bash
# Test OpenID Configuration Discovery
curl -s https://authentik.example.com/application/o/openbastion/.well-known/openid-configuration | jq

# Should return endpoints for:
# - authorization_endpoint
# - token_endpoint
# - userinfo_endpoint
# - jwks_uri
```

## 🔒 Security Considerations

### LDAP
- Use **LDAPS (LDAP over SSL)** in production (port 636)
- Use **strong bind credentials** - create dedicated service account in AD
- **Restrict bind DN permissions** - only allow user search, not other operations
- Enable **SSL verification** - don't disable certificate checks

### OIDC
- Always use **HTTPS** for callback URLs in production
- Use **strong client secrets** - generate with cryptographic randomness
- **Validate issuer URLs** - prevent authorization code redirection attacks
- **Verify SSL certificates** - don't disable in production (only dev/internal)
- Implement **PKCE** for public clients if needed

## 🐛 Troubleshooting

### LDAP Connection Issues

```
"LDAP Auth failed: ldaperror: 80090308: LdapErr: DSID-0C090400"
```
→ Wrong bind DN or password

```
"Search returned 0 results"
```
→ Incorrect searchBase or searchFilter

```
"LDAP User {username} has no email attribute"
```
→ User doesn't have `mail` or `proxyAddresses` attribute in AD

### OIDC Connection Issues

```
"OIDC discovery failed: getaddrinfo ENOTFOUND"
```
→ Issuer URL is unreachable or misspelled

```
"Invalid code parameter"
```
→ Client ID/Secret mismatch or callback URL not registered

```
"OIDC user has no email claim"
```
→ Authentik scopes don't include `email` or user doesn't have email

## 📚 References

- **LDAP RFC**: https://tools.ietf.org/html/rfc4511
- **OpenID Connect**: https://openid.net/specs/openid-connect-core-1_0.html
- **Authentik OIDC**: https://docs.goauthentik.io/docs/providers/oauth2/
- **Microsoft AD LDAP**: https://learn.microsoft.com/en-us/windows/win32/ad/ldap
