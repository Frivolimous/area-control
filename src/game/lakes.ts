import { HexCoord, Tile } from '../types/game';
import { hexKey, hexNeighbors, hexDistance, isConnected } from './hexGrid';
import { Rng } from './rng';

export interface LakeOptions {
  numLakes: number;
  minLakeSize: number;
  maxLakeSize: number;
}

// A larger lake is more likely to bump into a narrow isthmus somewhere
// and get rejected by the connectivity check — retrying with a fresh
// seed keeps the ACTUAL lake count close to what was asked for, rather
// than silently ending up with fewer than requested.
const MAX_ATTEMPTS_PER_LAKE = 6;

/**
 * Carves numLakes interior water pockets into the landmass, mutating
 * tileMap in place. After each lake, checks the remaining landmass is
 * still fully connected (a lake could sever a narrow isthmus into two
 * islands) — if not, that lake is reverted and retried with a fresh seed
 * (see MAX_ATTEMPTS_PER_LAKE) rather than just given up on.
 *
 * Placement is still simple (random seed point) rather than deliberately
 * engineering lakes to pinch toward each other for guaranteed
 * chokepoints — that's flagged as a refinement worth trying if fewer,
 * larger, round lakes don't create enough of them on their own.
 *
 * Note: this reduces the final active tile count below whatever the
 * pre-lake landmass selection targeted — mapLandPercent describes land
 * BEFORE lakes, not the guaranteed final result after carving.
 */
export function carveLakes(tileMap: Map<string, Tile>, options: LakeOptions, rng: Rng): void {
  for (let i = 0; i < options.numLakes; i++) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_LAKE; attempt++) {
      const activeCoords: HexCoord[] = [];
      for (const tile of tileMap.values()) {
        if (tile.active) activeCoords.push(tile.coord);
      }
      if (activeCoords.length === 0) return;

      const seedCoord = activeCoords[Math.floor(rng() * activeCoords.length)];
      const targetSize = options.minLakeSize + Math.floor(rng() * (options.maxLakeSize - options.minLakeSize + 1));
      const pocket = growRoundPocket(seedCoord, targetSize, tileMap, rng);

      const removedTiles: Tile[] = [];
      for (const key of pocket) {
        const tile = tileMap.get(key);
        if (tile) {
          tile.active = false;
          removedTiles.push(tile);
        }
      }

      const remainingActiveKeys = new Set<string>();
      for (const tile of tileMap.values()) {
        if (tile.active) remainingActiveKeys.add(hexKey(tile.coord));
      }

      if (isConnected(remainingActiveKeys)) {
        break; // this lake is good, move on to the next one
      }
      for (const tile of removedTiles) tile.active = true; // revert, try a different seed
    }
  }
}

/**
 * Grows a round, smooth-edged pocket of roughly targetSize tiles from
 * seedCoord, by always expanding into whichever frontier candidate is
 * CLOSEST to the seed (with mild jitter so it's not a perfect disk) — the
 * same distance-weighted-growth technique used for shaping the landmass
 * itself (game/voronoiRegions.ts selectLandRegions), just at lake scale.
 * The original approach picked frontier tiles uniformly at random, which
 * produced jagged, spiky pocket shapes for the same underlying reason it
 * did for the original hex-level land flood-fill.
 */
function growRoundPocket(seedCoord: HexCoord, targetSize: number, tileMap: Map<string, Tile>, rng: Rng): Set<string> {
  const pocket = new Set<string>([hexKey(seedCoord)]);
  const frontier: HexCoord[] = hexNeighbors(seedCoord).filter((c) => tileMap.get(hexKey(c))?.active);
  const inFrontier = new Set(frontier.map(hexKey));

  while (pocket.size < targetSize && frontier.length > 0) {
    let bestIdx = 0;
    let bestScore = hexDistance(frontier[0], seedCoord) * (0.75 + rng() * 0.5);
    for (let i = 1; i < frontier.length; i++) {
      const s = hexDistance(frontier[i], seedCoord) * (0.75 + rng() * 0.5);
      if (s < bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }

    const coord = frontier[bestIdx];
    frontier.splice(bestIdx, 1);
    const key = hexKey(coord);
    inFrontier.delete(key);
    if (pocket.has(key)) continue;

    const tile = tileMap.get(key);
    if (!tile || !tile.active) continue;
    pocket.add(key);

    for (const n of hexNeighbors(coord)) {
      const nKey = hexKey(n);
      if (!pocket.has(nKey) && !inFrontier.has(nKey) && tileMap.get(nKey)?.active) {
        frontier.push(n);
        inFrontier.add(nKey);
      }
    }
  }

  return pocket;
}
