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

/**
 * All hex coords exactly `radius` steps from center — radius 0 returns
 * just [center], radius N returns a ring of 6*N coords (standard hex-ring
 * walk: start N steps out in one fixed direction, then walk N steps along
 * each of the 6 sides in turn). Used for ring-by-ring influence expansion
 * (game/influence.ts ringExpand) — radius 1, 2, 3... outward from a focus.
 */
export function hexRing(center: HexCoord, radius: number): HexCoord[] {
  if (radius <= 0) return radius === 0 ? [center] : [];

  const results: HexCoord[] = [];
  let coord: HexCoord = {
    q: center.q + AXIAL_DIRECTIONS[4].q * radius,
    r: center.r + AXIAL_DIRECTIONS[4].r * radius,
  };

  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push(coord);
      coord = { q: coord.q + AXIAL_DIRECTIONS[side].q, r: coord.r + AXIAL_DIRECTIONS[side].r };
    }
  }
  return results;
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

/** Inverse of hexToPixel — pixel position -> nearest hex coordinate. */
export function pixelToHex(x: number, y: number, size: number): HexCoord {
  const q = (2 / 3) * (x / size);
  const r = y / (Math.sqrt(3) * size) - q / 2;
  return hexRound({ q, r, s: -q - r });
}

/**
 * True if every coord in activeKeys is reachable from every other via
 * neighbor steps staying within activeKeys — i.e. a single connected
 * landmass rather than separate islands. Used by both map generation
 * (Voronoi region selection) and lake carving (reject a lake if it would
 * sever the landmass into pieces).
 */
export function isConnected(activeKeys: Set<string>): boolean {
  if (activeKeys.size === 0) return true;
  const start = activeKeys.values().next().value as string;
  const [q, r] = start.split(',').map(Number);

  const visited = new Set<string>([start]);
  const queue: HexCoord[] = [{ q, r }];
  let head = 0;
  while (head < queue.length) {
    const coord = queue[head++];
    for (const n of hexNeighbors(coord)) {
      const key = hexKey(n);
      if (!visited.has(key) && activeKeys.has(key)) {
        visited.add(key);
        queue.push(n);
      }
    }
  }
  return visited.size === activeKeys.size;
}

/**
 * Finds every connected component within activeKeys and returns the
 * largest one. Used to repair the rare case where clipping a hard edge
 * margin onto Voronoi-region-selected land severs a region's connection
 * to its neighbor — cheap insurance for the "one continuous landmass"
 * invariant the rest of the game depends on.
 */
export function largestConnectedComponent(activeKeys: Set<string>): Set<string> {
  const unvisited = new Set(activeKeys);
  let largest: Set<string> = new Set();

  while (unvisited.size > 0) {
    const start = unvisited.values().next().value as string;
    const [q, r] = start.split(',').map(Number);
    const component = new Set<string>([start]);
    unvisited.delete(start);

    const queue: HexCoord[] = [{ q, r }];
    let head = 0;
    while (head < queue.length) {
      const coord = queue[head++];
      for (const n of hexNeighbors(coord)) {
        const key = hexKey(n);
        if (unvisited.has(key)) {
          unvisited.delete(key);
          component.add(key);
          queue.push(n);
        }
      }
    }

    if (component.size > largest.size) largest = component;
  }

  return largest;
}
