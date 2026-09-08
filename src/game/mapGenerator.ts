import { HexCoord, Tile } from '../types/game';
import { hexKey } from './hexGrid';

export interface MapGenOptions {
  width: number;
  height: number;
  landPercent: number;
  seed?: number;
}

/**
 * Generates a rectangular hex map.
 *
 * PLACEHOLDER: tiles are marked active purely at random, which will NOT
 * produce "one continuous landmass" as the brief requires, and won't hit
 * landPercent precisely either. Replace with a real algorithm — e.g. flood
 * fill / random walk growth from a seed point, or cellular automata with a
 * connectivity pass — once map scale is confirmed (see the note in
 * types/game.ts about mapWidth/mapHeight = 1024).
 */
export function generateMap(options: MapGenOptions): Tile[] {
  const { width, height, landPercent } = options;

  const allCoords: HexCoord[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      allCoords.push(offsetToAxial(col, row));
    }
  }

  return allCoords.map((coord) => ({
    coord,
    active: Math.random() < landPercent,
    influence: {},
  }));
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
