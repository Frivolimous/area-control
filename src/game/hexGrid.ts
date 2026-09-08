import { HexCoord } from '../types/game';

// Axial coordinate hex grid utilities, flat-top orientation.
// Swap AXIAL_DIRECTIONS + hexToPixel if you want pointy-top hexes instead.

const AXIAL_DIRECTIONS: HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

export function hexEquals(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexNeighbors(coord: HexCoord): HexCoord[] {
  return AXIAL_DIRECTIONS.map((dir) => ({
    q: coord.q + dir.q,
    r: coord.r + dir.r,
  }));
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const aq = a.q,
    ar = a.r,
    as_ = -aq - ar;
  const bq = b.q,
    br = b.r,
    bs = -bq - br;
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as_ - bs));
}

/** Straight line of hex coords from a to b (used for "spread toward focus"). */
export function hexLine(a: HexCoord, b: HexCoord): HexCoord[] {
  const n = hexDistance(a, b);
  if (n === 0) return [a];
  const results: HexCoord[] = [];
  for (let i = 0; i <= n; i++) {
    results.push(hexRound(lerpCube(a, b, i / n)));
  }
  return results;
}

function lerpCube(a: HexCoord, b: HexCoord, t: number) {
  const aq = a.q,
    ar = a.r,
    as_ = -aq - ar;
  const bq = b.q,
    br = b.r,
    bs = -bq - br;
  return {
    q: aq + (bq - aq) * t,
    r: ar + (br - ar) * t,
    s: as_ + (bs - as_) * t,
  };
}

function hexRound(cube: { q: number; r: number; s: number }): HexCoord {
  let q = Math.round(cube.q);
  let r = Math.round(cube.r);
  let s = Math.round(cube.s);

  const qDiff = Math.abs(q - cube.q);
  const rDiff = Math.abs(r - cube.r);
  const sDiff = Math.abs(s - cube.s);

  if (qDiff > rDiff && qDiff > sDiff) {
    q = -r - s;
  } else if (rDiff > sDiff) {
    r = -q - s;
  }
  return { q, r };
}

/** Axial -> pixel conversion for flat-top hexes, given a hex "size" (radius). */
export function hexToPixel(coord: HexCoord, size: number): { x: number; y: number } {
  const x = size * (3 / 2) * coord.q;
  const y = size * (Math.sqrt(3) * (coord.r + coord.q / 2));
  return { x, y };
}
