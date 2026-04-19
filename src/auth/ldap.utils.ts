export function escapeLdapFilter(str: string): string {
  if (!str) return '';
  return str.replace(/[\*\(\)\\\0]/g, (c) => {
    return '\\' + c.charCodeAt(0).toString(16).padStart(2, '0');
  });
}
