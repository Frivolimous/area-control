import { GameConfig, HexCoord, Tile } from '../types/game';
import { hexKey, largestConnectedComponent } from './hexGrid';
import { createRng } from './rng';
import { buildVoronoiRegions, selectLandRegions } from './voronoiRegions';
import { carveLakes } from './lakes';

function pickRegionCount(paddedTotalTiles: number, config: GameConfig): number {
  return Math.max(
    config.mapRegionCountMin,
    Math.min(config.mapRegionCountMax, Math.round(Math.sqrt(paddedTotalTiles) / config.mapRegionCountDivisor))
  );
}

function pickLakeOptions(targetActiveCount: number, config: GameConfig) {
  return {
    numLakes: Math.max(
      config.mapLakeCountMin,
      Math.min(config.mapLakeCountMax, Math.round(targetActiveCount / config.mapLakeCountDivisor))
    ),
    minLakeSize: Math.max(config.mapLakeMinSizeFloor, Math.round(targetActiveCount / config.mapLakeMinSizeDivisor)),
    maxLakeSize: Math.max(config.mapLakeMaxSizeFloor, Math.round(targetActiveCount / config.mapLakeMaxSizeDivisor)),
  };
}

/**
 * Generates a rectangular hex map: one connected landmass shaped from
 * Voronoi regions (grown region-by-region from a central point, so the
 * border follows natural cell boundaries instead of single-hex jagged
 * noise), kept clear of the true grid edge by a hard margin, with a
 * handful of interior lakes carved in afterward (each checked to ensure
 * it doesn't sever the landmass into separate islands).
 *
 * Supersedes the original pure-flood-fill version, which produced
 * connected, landPercent-accurate maps but visually ugly ones: uniform-
 * random frontier selection grew thin tendrils rather than filling in
 * compact shapes, and land routinely touched every edge since growth had
 * no awareness of distance-from-center at all.
 *
 * Takes the full GameConfig (rather than a narrower options type) since
 * every tuning knob below — padding, margin, region count, lake sizing —
 * lives on GameConfig now so it can be overridden from Firestore without
 * a redeploy. See the mapPaddingFactor, mapEdgeMargin-prefixed,
 * mapRegionCount-prefixed, and mapLake-prefixed field comments on
 * GameConfig for what each one does and the empirical reasoning behind
 * its default.
 */
export function generateMap(config: GameConfig, seed: number): Tile[] {
  const { mapWidth: width, mapHeight: height, mapLandPercent: landPercent } = config;
  const rng = createRng(seed);

  const paddedWidth = Math.round(width * config.mapPaddingFactor);
  const paddedHeight = Math.round(height * config.mapPaddingFactor);
  const margin = Math.max(
    config.mapEdgeMarginMin,
    Math.round(Math.min(paddedWidth, paddedHeight) * config.mapEdgeMarginFraction)
  );

  const allCoords: HexCoord[] = [];
  const edgeMarginKeys = new Set<string>();
  for (let row = 0; row < paddedHeight; row++) {
    for (let col = 0; col < paddedWidth; col++) {
      const coord = offsetToAxial(col, row);
      allCoords.push(coord);
      if (col < margin || col >= paddedWidth - margin || row < margin || row >= paddedHeight - margin) {
        edgeMarginKeys.add(hexKey(coord));
      }
    }
  }

  const tileMap = new Map<string, Tile>();
  for (const coord of allCoords) {
    tileMap.set(hexKey(coord), { coord, active: false, influence: {} });
  }

  const numRegions = pickRegionCount(allCoords.length, config);
  const regions = buildVoronoiRegions(allCoords, numRegions, rng);

  const centerCoord = offsetToAxial(Math.floor(paddedWidth / 2), Math.floor(paddedHeight / 2));
  // Target is based on the ORIGINAL (unpadded) width/height — landPercent
  // describes density relative to the configured map size; padding exists
  // purely to make room for the margin, not to inflate the land target.
  const targetActiveCount = Math.round(width * height * landPercent);
  const landRegions = selectLandRegions(regions, targetActiveCount, centerCoord, rng);

  for (const coord of allCoords) {
    const key = hexKey(coord);
    const region = regions.regionOf.get(key);
    const tile = tileMap.get(key);
    if (!tile || region === undefined) continue;
    tile.active = landRegions.has(region) && !edgeMarginKeys.has(key);
  }

  // Cheap insurance: edge-margin clipping happens per-tile, independent
  // of region boundaries, so it's theoretically possible (if unlikely
  // given selection is center-biased and the margin only strips the
  // outermost ring) for it to sever a selected region's connection to its
  // neighbor. Keep only the largest connected piece if so, rather than
  // ever risking two separate islands — the rest of the game assumes a
  // single connected landmass.
  const activeKeysBeforeRepair = new Set<string>();
  for (const tile of tileMap.values()) {
    if (tile.active) activeKeysBeforeRepair.add(hexKey(tile.coord));
  }
  const largest = largestConnectedComponent(activeKeysBeforeRepair);
  if (largest.size < activeKeysBeforeRepair.size) {
    for (const tile of tileMap.values()) {
      if (tile.active && !largest.has(hexKey(tile.coord))) tile.active = false;
    }
  }

  carveLakes(tileMap, pickLakeOptions(targetActiveCount, config), rng);

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
