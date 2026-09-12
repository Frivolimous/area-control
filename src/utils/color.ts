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

/** Linear interpolation between two hex colors. t is clamped to [0, 1]. */
export function lerpColor(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const clamped = Math.max(0, Math.min(1, t));
  return rgbToHex(
    Math.round(a.r + (b.r - a.r) * clamped),
    Math.round(a.g + (b.g - a.g) * clamped),
    Math.round(a.b + (b.b - a.b) * clamped)
  );
}

export function hexStringToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Linear interpolation between two 0xRRGGBB numeric colors. Operates
 * directly on the packed int (no hex-string round-trip) since this runs
 * every animation frame for fading tiles — see render/mapScreen.ts.
 */
export function lerpColorNumeric(from: number, to: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const fr = (from >> 16) & 0xff,
    fg = (from >> 8) & 0xff,
    fb = from & 0xff;
  const tr = (to >> 16) & 0xff,
    tg = (to >> 8) & 0xff,
    tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * clamped);
  const g = Math.round(fg + (tg - fg) * clamped);
  const b = Math.round(fb + (tb - fb) * clamped);
  return (r << 16) | (g << 8) | b;
}

const NEUTRAL_TILE_COLOR = '#3a3a4e';

/**
 * Fill color for a tile during Active play. A tile with less than max
 * influence is tinted toward neutral by how full it is, rather than
 * snapping straight to a solid color — e.g. a tile at 20% of max shows
 * mostly neutral with a light tint of the controlling player's color.
 *
 * For a contested tile (multiple influencers), the hue is a weighted
 * blend of each influencer's color by their share of the influence
 * present — so a tile two players are fighting over leans toward
 * whoever's currently ahead — and the whole thing is still tinted toward
 * neutral by total fullness (combined influence / max). This is my own
 * extrapolation of the single-player tinting rule to the contested case,
 * not something spelled out explicitly — flagging in case a different
 * treatment of contested tiles is wanted.
 */
export function influenceFillColor(
  tile: { influence: Partial<Record<string, number>> },
  playerColors: Record<string, string>,
  maxInfluencePerTile: number
): number {
  const entries = Object.entries(tile.influence).filter(
    (entry): entry is [string, number] => (entry[1] ?? 0) > 0
  );
  if (entries.length === 0) return hexStringToNumber(NEUTRAL_TILE_COLOR);

  const totalInfluence = entries.reduce((sum, [, amount]) => sum + amount, 0);

  let r = 0,
    g = 0,
    b = 0;
  for (const [playerId, amount] of entries) {
    const rgb = hexToRgb(playerColors[playerId] ?? '#888888');
    const weight = amount / totalInfluence;
    r += rgb.r * weight;
    g += rgb.g * weight;
    b += rgb.b * weight;
  }
  const weightedColor = rgbToHex(Math.round(r), Math.round(g), Math.round(b));

  const fullness = Math.min(1, totalInfluence / maxInfluencePerTile);
  return hexStringToNumber(lerpColor(NEUTRAL_TILE_COLOR, weightedColor, fullness));
}

/** Default selectable player colors (brief: "select a color from a specified list"). */
export const PLAYER_COLOR_PALETTE: string[] = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
  '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000',
  '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080',
];
