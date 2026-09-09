/**
 * Blends multiple hex colors by simple RGB averaging. Used to render tiles
 * influenced by more than one player. Swap for a blend in a different color
 * space (e.g. LAB) if a flat average looks too muddy in practice.
 */
export function blendColors(colors: string[]): string {
  if (colors.length === 0) return '#888888';
  if (colors.length === 1) return colors[0];

  let r = 0,
    g = 0,
    b = 0;
  for (const color of colors) {
    const rgb = hexToRgb(color);
    r += rgb.r;
    g += rgb.g;
    b += rgb.b;
  }
  const n = colors.length;
  return rgbToHex(Math.round(r / n), Math.round(g / n), Math.round(b / n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

export function hexStringToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Fill color for a tile during Active play: blends every influencing
 * player's color, or a neutral shade for untouched land. Used by
 * render/mapScreen.ts's game-mode rendering.
 */
export function influenceFillColor(
  tile: { influence: Partial<Record<string, number>> },
  playerColors: Record<string, string>
): number {
  const influencers = Object.keys(tile.influence).filter((id) => (tile.influence[id] ?? 0) > 0);
  const colors = influencers.map((id) => playerColors[id] ?? '#888888');
  const fill = colors.length > 0 ? blendColors(colors) : '#3a3a4e';
  return hexStringToNumber(fill);
}

/** Default selectable player colors (brief: "select a color from a specified list"). */
export const PLAYER_COLOR_PALETTE: string[] = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
  '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000',
  '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080',
];
