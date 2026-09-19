import { HexCoord, Tile } from '../types/game';
import { hexKey, hexNeighbors, isConnected } from './hexGrid';
import { Rng } from './rng';

export interface LakeOptions {
  numLakes: number;
  minLakeSize: number;
  maxLakeSize: number;
}

/**
 * Carves numLakes interior water pockets into the landmass, mutating
 * tileMap in place. Each lake grows via the same flood-fill-from-a-point
 * pattern used elsewhere in map generation, just removing tiles instead
 * of adding them. After each lake, checks the remaining landmass is still
 * fully connected (a lake could sever a narrow isthmus into two islands)
 * — if not, that lake is reverted rather than accepted.
 *
 * Deliberately simple placement (uniform random seed point, bounded
 * random size) rather than engineering lakes to pinch specific
 * chokepoints — that's flagged as a refinement worth trying once this
 * baseline has been played with, not built blind.
 *
 * Note: this reduces the final active tile count below whatever the
 * pre-lake landmass selection targeted — mapLandPercent describes land
 * BEFORE lakes, not the guaranteed final result after carving.
 */
export function carveLakes(tileMap: Map<string, Tile>, options: LakeOptions, rng: Rng): void {
  for (let i = 0; i < options.numLakes; i++) {
    const activeCoords: HexCoord[] = [];
    for (const tile of tileMap.values()) {
      if (tile.active) activeCoords.push(tile.coord);
    }
    if (activeCoords.length === 0) break;

    const seedCoord = activeCoords[Math.floor(rng() * activeCoords.length)];
    const targetSize = options.minLakeSize + Math.floor(rng() * (options.maxLakeSize - options.minLakeSize + 1));

    const pocket = new Set<string>([hexKey(seedCoord)]);
    const frontier: HexCoord[] = hexNeighbors(seedCoord).filter((c) => tileMap.get(hexKey(c))?.active);
    const inFrontier = new Set(frontier.map(hexKey));

    while (pocket.size < targetSize && frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const coord = frontier[idx];
      frontier.splice(idx, 1);
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

    if (!isConnected(remainingActiveKeys)) {
      // This lake would split the landmass — revert it and move on.
      for (const tile of removedTiles) tile.active = true;
    }
  }
}
