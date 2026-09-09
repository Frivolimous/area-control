import { HexCoord, Tile } from '../types/game';
import { hexKey, hexNeighbors } from './hexGrid';
import { createRng } from './rng';

export interface MapGenOptions {
  width: number;
  height: number;
  landPercent: number;
  /** Same seed always produces the same map on every client. */
  seed: number;
}

/**
 * Generates a rectangular hex map: exactly one connected landmass, grown
 * by flood-fill from a random (seeded) starting point until it covers
 * ~landPercent of the grid. Deterministic — same seed, same map, on every
 * client, with no data ever needing to be synced beyond the seed itself.
 *
 * KNOWN ISSUE: produces visually ugly maps — uniform-random frontier
 * selection tends to grow thin tendrils outward rather than filling in a
 * compact blob, so coastlines end up spiky/splotchy rather than natural-
 * looking. Connectivity and landPercent are both correct; this is purely
 * an aesthetics problem. Ideas for later:
 *   - Weight frontier tile selection by how many active neighbors it
 *     already has, biasing growth toward filling in rather than reaching
 *     out (cheap fix, same algorithm shape).
 *   - Generate via seeded noise (simplex/Perlin) thresholded by
 *     landPercent, then take the largest connected component and grow/
 *     shrink it to hit the target percentage — generally produces more
 *     natural coastlines than pure flood-fill.
 *   - Post-process pass: cellular-automata smoothing (a tile flips to
 *     match the majority of its neighbors) to knock down thin spikes.
 */
export function generateMap(options: MapGenOptions): Tile[] {
  const { width, height, landPercent, seed } = options;
  const rng = createRng(seed);

  const allCoords: HexCoord[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      allCoords.push(offsetToAxial(col, row));
    }
  }

  const tileMap = new Map<string, Tile>();
  for (const coord of allCoords) {
    tileMap.set(hexKey(coord), { coord, active: false, influence: {} });
  }

  const targetActive = Math.round(allCoords.length * landPercent);
  const startCoord = allCoords[Math.floor(rng() * allCoords.length)];
  const startTile = tileMap.get(hexKey(startCoord));
  if (!startTile) return Array.from(tileMap.values());
  startTile.active = true;

  const frontier: HexCoord[] = hexNeighbors(startCoord).filter((c) => tileMap.has(hexKey(c)));
  const inFrontier = new Set(frontier.map(hexKey));

  let activeCount = 1;
  while (activeCount < targetActive && frontier.length > 0) {
    const idx = Math.floor(rng() * frontier.length);
    const coord = frontier[idx];
    frontier.splice(idx, 1);
    inFrontier.delete(hexKey(coord));

    const tile = tileMap.get(hexKey(coord));
    if (!tile || tile.active) continue;
    tile.active = true;
    activeCount++;

    for (const n of hexNeighbors(coord)) {
      const key = hexKey(n);
      const neighborTile = tileMap.get(key);
      if (neighborTile && !neighborTile.active && !inFrontier.has(key)) {
        frontier.push(n);
        inFrontier.add(key);
      }
    }
  }

  return Array.from(tileMap.values());
}

/** "odd-r" horizontal offset layout -> axial conversion. */
function offsetToAxial(col: number, row: number): HexCoord {
  const q = col - (row - (row & 1)) / 2;
  const r = row;
  return { q, r };
}

export function tileMapFromArray(tiles: Tile[]): Map<string, Tile> {
  const map = new Map<string, Tile>();
  for (const tile of tiles) {
    map.set(hexKey(tile.coord), tile);
  }
  return map;
}
