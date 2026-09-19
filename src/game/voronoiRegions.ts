import { HexCoord } from '../types/game';
import { hexKey, hexNeighbors, hexDistance } from './hexGrid';
import { Rng } from './rng';

export interface VoronoiRegions {
  /** Tile key -> region index. Every coord passed to buildVoronoiRegions ends up assigned. */
  regionOf: Map<string, number>;
  /** Which regions border which — two regions are adjacent if any of their tiles are hex-neighbors. */
  regionAdjacency: Map<number, Set<number>>;
  regionSizes: Map<number, number>;
  regionSeeds: HexCoord[];
}

/**
 * Assigns every coord to its nearest of numRegions seed points via
 * multi-source BFS (all seeds start as depth-0 frontier simultaneously) —
 * a hex-grid-native Voronoi partition, using BFS distance rather than
 * Euclidean, which respects hex adjacency exactly.
 *
 * Determinism note: ties (a tile exactly equidistant from two seeds) are
 * broken by insertion order in the shared queue, which is itself fully
 * determined by seed order and hexNeighbors' fixed iteration order — safe
 * across clients. This is also why region selection below never calls rng()
 * inside a sort comparator (see the comment there): the ORDER in which a
 * JS engine invokes a comparator during sort is unspecified, so any
 * randomness read from inside one could give different results on
 * different browsers even from the same seed.
 */
export function buildVoronoiRegions(allCoords: HexCoord[], numRegions: number, rng: Rng): VoronoiRegions {
  const allKeys = new Set(allCoords.map(hexKey));

  const seeds: HexCoord[] = [];
  const usedKeys = new Set<string>();
  while (seeds.length < numRegions && usedKeys.size < allCoords.length) {
    const coord = allCoords[Math.floor(rng() * allCoords.length)];
    const key = hexKey(coord);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    seeds.push(coord);
  }

  const regionOf = new Map<string, number>();
  const queue: HexCoord[] = [];
  for (let i = 0; i < seeds.length; i++) {
    regionOf.set(hexKey(seeds[i]), i);
    queue.push(seeds[i]);
  }

  let head = 0;
  while (head < queue.length) {
    const coord = queue[head++];
    const region = regionOf.get(hexKey(coord));
    if (region === undefined) continue;
    for (const n of hexNeighbors(coord)) {
      const key = hexKey(n);
      if (!allKeys.has(key) || regionOf.has(key)) continue;
      regionOf.set(key, region);
      queue.push(n);
    }
  }

  const regionSizes = new Map<number, number>();
  const regionAdjacency = new Map<number, Set<number>>();
  for (const coord of allCoords) {
    const region = regionOf.get(hexKey(coord));
    if (region === undefined) continue;
    regionSizes.set(region, (regionSizes.get(region) ?? 0) + 1);

    for (const n of hexNeighbors(coord)) {
      const nRegion = regionOf.get(hexKey(n));
      if (nRegion === undefined || nRegion === region) continue;
      if (!regionAdjacency.has(region)) regionAdjacency.set(region, new Set());
      regionAdjacency.get(region)!.add(nRegion);
    }
  }

  return { regionOf, regionAdjacency, regionSizes, regionSeeds: seeds };
}

/**
 * Grows a connected land selection outward from the most central region,
 * region-by-region (a flood-fill one level up from the usual hex-by-hex
 * version), until the selection covers roughly targetActiveCount hexes.
 * Guarantees connectivity by construction — same reasoning as the
 * original hex-level flood-fill, just with whole Voronoi cells as the
 * atoms being added, which is also what gives the border its large-scale
 * coherence instead of single-hex jaggedness.
 *
 * "Central" is jittered (see below) so the result isn't a suspiciously
 * perfect circle — real irregularity, not just Voronoi-cell edges.
 */
export function selectLandRegions(
  regions: VoronoiRegions,
  targetActiveCount: number,
  centerCoord: HexCoord,
  rng: Rng
): Set<number> {
  const { regionAdjacency, regionSizes, regionSeeds } = regions;

  // Precomputed once, in fixed seed order — never call rng() inside the
  // sort/selection comparisons below, since a JS engine's comparator
  // invocation order isn't specified and could differ across browsers.
  const jitter = regionSeeds.map(() => 0.6 + rng() * 0.8);
  const score = (i: number): number => hexDistance(regionSeeds[i], centerCoord) * jitter[i];

  let startRegion = 0;
  for (let i = 1; i < regionSeeds.length; i++) {
    if (score(i) < score(startRegion)) startRegion = i;
  }

  const landRegions = new Set<number>([startRegion]);
  let accumulated = regionSizes.get(startRegion) ?? 0;

  const frontier: number[] = Array.from(regionAdjacency.get(startRegion) ?? []);
  const inFrontier = new Set(frontier);

  while (accumulated < targetActiveCount && frontier.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < frontier.length; i++) {
      if (score(frontier[i]) < score(frontier[bestIdx])) bestIdx = i;
    }
    const region = frontier[bestIdx];
    frontier.splice(bestIdx, 1);
    inFrontier.delete(region);

    if (landRegions.has(region)) continue;
    landRegions.add(region);
    accumulated += regionSizes.get(region) ?? 0;

    for (const neighborRegion of regionAdjacency.get(region) ?? []) {
      if (!landRegions.has(neighborRegion) && !inFrontier.has(neighborRegion)) {
        frontier.push(neighborRegion);
        inFrontier.add(neighborRegion);
      }
    }
  }

  return landRegions;
}
