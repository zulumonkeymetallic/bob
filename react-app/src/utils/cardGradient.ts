function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');
}

export function lightenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const factor = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    rgb.r + (255 - rgb.r) * factor,
    rgb.g + (255 - rgb.g) * factor,
    rgb.b + (255 - rgb.b) * factor,
  );
}

// Returns a light gradient background derived from a goal/theme hex colour.
// Falls back to the CSS card variable when given a non-hex value.
export function cardThemeGradient(hexColor: string): string {
  if (!hexColor || !hexColor.startsWith('#')) return 'var(--card, #fff)';
  const start = lightenColor(hexColor, 0.55);
  const end = lightenColor(hexColor, 0.78);
  return `linear-gradient(165deg, ${start} 0%, ${end} 100%)`;
}
