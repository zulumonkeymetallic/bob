/**
 * Generate a unique share code for published goals
 * Format: 12 characters of alphanumeric lowercase (a-z, 0-9)
 * Examples: abc123xyz789, d4f7k2qw8p1m
 */
export function generateShareCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Get the public share URL for a published goal
 */
export function getShareUrl(shareCode: string): string {
  const baseUrl = window.location.origin;
  return `${baseUrl}/share/${shareCode}`;
}

/**
 * Validate share code format
 */
export function isValidShareCode(code: string): boolean {
  return /^[a-z0-9]{12}$/.test(code);
}
