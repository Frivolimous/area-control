import { HexCoord, Tile } from '../types/game';
import { hexKey, largestConnectedComponent } from './hexGrid';
import { createRng } from './rng';
import { buildVoronoiRegions, selectLandRegions } from './voronoiRegions';
import { carveLakes } from './lakes';

export interface MapGenOptions {
  width: number;
  height: number;
  landPercent: number;
  /** Same seed always produces the same map on every client. */
  seed: number;
  edgeMarginFraction: number;
  edgeMarginMin: number;
  paddingFactor: number;
  regionOptions: {
    minRegions: number;
    maxRegions: number;
    regionDensity: number;
  };
  lakeOptions: {
    numLakesDenominator: number;
    numLakesMin: number;
    minLakeSize: number;
    maxLakeSizeDenominator: number;
    maxLakeSizeMin: number;
  };
}

// How close to the true grid boundary land is never allowed, regardless
// of region selection — a hard guarantee of ocean margin around the
// landmass, so the border is never "obviously" the map's rectangular
// edge. Expressed as a fraction of the smaller grid dimension.
// const EDGE_MARGIN_FRACTION = 0.08;
// const EDGE_MARGIN_MIN = 2;

// Generate on a grid larger than the configured width/height so the edge
// margin comes out of genuine extra space rather than competing with the
// land target for the same fixed area. Without this, high landPercent
// values leave barely enough usable interior after the margin for the
// shape to be anything but a nearly-maximal, forced-to-the-edge fill —
// confirmed empirically: with no padding, only 83-88% of the target land
// count survived margin clipping even after tuning region count; 1.4x
// padding gets that to ~100%+. config.mapWidth/mapHeight effectively
// describe the target LAND area size from here on, not a literal grid
// rectangle — rendering already auto-fits to whatever tiles come back
// (render/mapScreen.ts fitAndCenter), so this doesn't break anything
// downstream, but it's a real semantic shift worth knowing about.
// const PADDING_FACTOR = 1.4;

// Voronoi cell count — the "grain size" of the region-based landmass,
// scaled off the padded grid's total area (what's actually being
// partitioned). Too few and the border looks like a handful of giant
// polygon edges (and, empirically, loses a lot of area to margin
// clipping since each region is too large to shape around it precisely);
// too many and it starts looking noisy again, defeating the point of
// generating at the region level instead of the hex level. The constant
// (2.75) was fit by averaging post-margin-clip land survival across 10
// seeds at two map sizes (60x40 and the real 100x100 config) and picking
// what kept the average near 100% of target with a tight range across
// both — not derived from anything principled, revisit if a very
// different map size makes it look wrong.
function pickRegionCount(options: MapGenOptions, paddedTotalTiles: number): number {
  return Math.max(options.regionOptions.minRegions, Math.min(options.regionOptions.maxRegions, Math.round(Math.sqrt(paddedTotalTiles) / options.regionOptions.regionDensity)));
}

// Lake sizing, relative to the landmass. Also tuned by eye — see
// game/lakes.ts for why placement is deliberately simple for now.
function pickLakeOptions(options: MapGenOptions, targetActiveCount: number) {
  return {
    numLakes: Math.max(options.lakeOptions.numLakesMin, Math.round(targetActiveCount / options.lakeOptions.numLakesDenominator)),
    minLakeSize: options.lakeOptions.minLakeSize,
    maxLakeSize: Math.max(options.lakeOptions.maxLakeSizeMin, Math.round(targetActiveCount / options.lakeOptions.maxLakeSizeDenominator)),
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
 */
export function generateMap(_options: Partial<MapGenOptions>): Tile[] {
  _options.regionOptions ??= {
    minRegions: 8,
    maxRegions: 32,
    regionDensity: 2.75,
  };
  _options.edgeMarginFraction ??= 0.08;
  _options.edgeMarginMin ??= 2;
  _options.paddingFactor ??= 1.4;
  _options.lakeOptions ??= {
    numLakesDenominator: 100,
    numLakesMin: 1,
    minLakeSize: 3,
    maxLakeSizeDenominator: 50,
    maxLakeSizeMin: 5,
  };

  const options = _options as MapGenOptions; // after defaults, all required fields are present

  const { width, height, landPercent, seed } = options;
  const rng = createRng(seed);

  const paddedWidth = Math.round(width * options.paddingFactor);
  const paddedHeight = Math.round(height * options.paddingFactor);
  const margin = Math.max(options.edgeMarginMin, Math.round(Math.min(paddedWidth, paddedHeight) * options.edgeMarginFraction));

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

  const numRegions = pickRegionCount(options, allCoords.length);
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

  carveLakes(tileMap, pickLakeOptions(options, targetActiveCount), rng);

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
