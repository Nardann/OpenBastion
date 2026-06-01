/**
 * RFC 4515 §3 filter value escaping. The ONLY octets that must be
 * escaped inside an attribute value are:
 *   - `*`  (0x2a) — wildcard
 *   - `(`  (0x28) — filter open
 *   - `)`  (0x29) — filter close
 *   - `\`  (0x5c) — escape marker
 *   - NUL  (0x00) — string terminator
 *
 * Earlier versions of this helper also escaped `=`, `<`, `>`, `~`, `&`,
 * `|`, `!` "to be safe". They aren't special inside a value, and
 * escaping them silently broke any filter that interpolated a DN —
 * notably the LDAP reverse group lookup, where the user DN literally
 * contains `=` everywhere (`uid=foo,ou=bar,dc=baz,dc=local`). The
 * server then searched for the literal-but-escaped value, found no
 * match, and group sync stayed empty.
 *
 * Injection prevention still holds: an attacker controlling a username
 * cannot escape the surrounding filter because the structural
 * characters (`(`, `)`) are still escaped.
 */
export function escapeLdapFilter(str: string): string {
  if (!str) return '';
  return str.replace(/[\*\(\)\\\0]/g, (c) => {
    return '\\' + c.charCodeAt(0).toString(16).padStart(2, '0');
  });
}
