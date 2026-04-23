/**
 * Native utility to replace 'clsx' and 'tailwind-merge' logic.
 * Simple but effective for our needs.
 */
export function cn(...inputs: any[]): string {
  return inputs
    .filter(Boolean)
    .map(x => (typeof x === 'string' ? x : Object.keys(x).filter(k => x[k]).join(' ')))
    .join(' ');
}

/**
 * Format date using native Intl API
 */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

/**
 * Native secure ID generator for client-side use if needed
 */
export function generateId(): string {
  return crypto.randomUUID();
}
