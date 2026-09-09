import * as PIXI from 'pixi.js';
import { GameConfig, HexCoord, Player, Tile } from '../types/game';
import { generateMap } from '../game/mapGenerator';
import { hexEquals, hexToPixel } from '../game/hexGrid';
import { hexStringToNumber } from '../utils/color';
import { MapRenderer, HEX_SIZE } from './mapRenderer';
import { onTileClick } from './inputHandler';
import { initPixiApp } from './pixiApp';
import { selectStartTile } from '../firebase/roomService';

const NEUTRAL_LAND_COLOR = hexStringToNumber('#3a3a4e');

let mapRenderer: MapRenderer | null = null;
let currentTiles: Tile[] = [];

/**
 * Boots the pixi app, generates the map deterministically from the room's
 * seed, and wires clicks to claiming a start tile. Call once per room —
 * the map only needs generating once per client since it's a pure
 * function of (config, seed), both fixed for the room's lifetime.
 */
export function initMapScreen(
  container: HTMLElement,
  roomId: string,
  myPlayerId: string,
  config: GameConfig,
  seed: number
): void {
  const app = initPixiApp(container);

  currentTiles = generateMap({
    width: config.mapWidth,
    height: config.mapHeight,
    landPercent: config.mapLandPercent,
    seed,
  });

  mapRenderer = new MapRenderer(app.stage);
  fitAndCenter(app, mapRenderer.container, currentTiles);

  onTileClick(app, mapRenderer.container, HEX_SIZE, (coord) => {
    handleTileClick(roomId, myPlayerId, coord);
  });
}

function handleTileClick(roomId: string, myPlayerId: string, coord: HexCoord): void {
  const tile = currentTiles.find((t) => hexEquals(t.coord, coord));
  if (!tile || !tile.active) return; // clicked water or off the grid — ignore

  selectStartTile(roomId, myPlayerId, coord).catch((err) => {
    // Most likely cause: someone else claimed this tile a moment earlier
    // (the transaction in roomService.ts is what actually prevents the
    // conflict — this just surfaces the rejection to the user).
    console.error('Failed to select start tile', err);
    alert(err instanceof Error ? err.message : 'Could not select that tile.');
  });
}

/**
 * Re-renders tile colors from the latest room state — call from the
 * subscribeToRoom callback whenever players change. Unclaimed tiles render
 * as neutral land; claimed tiles render in that player's color, so
 * everyone sees selections live, per the brief.
 */
export function updateMapScreen(players: Player[]): void {
  if (!mapRenderer) return;
  mapRenderer.render(currentTiles, (tile) => {
    const owner = players.find((p) => p.startTile && hexEquals(p.startTile, tile.coord));
    return owner ? hexStringToNumber(owner.color) : NEUTRAL_LAND_COLOR;
  });
}

/** Scales and centers the map container to fit the current viewport. No pan/zoom yet — just an initial fit. */
function fitAndCenter(app: PIXI.Application, container: PIXI.Container, tiles: Tile[]): void {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  for (const tile of tiles) {
    const { x, y } = hexToPixel(tile.coord, HEX_SIZE);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const pad = HEX_SIZE * 2;
  const mapW = maxX - minX + pad * 2;
  const mapH = maxY - minY + pad * 2;
  const scale = Math.min(app.screen.width / mapW, app.screen.height / mapH, 1);

  container.scale.set(scale);
  container.position.set(
    (app.screen.width - mapW * scale) / 2 - (minX - pad) * scale,
    (app.screen.height - mapH * scale) / 2 - (minY - pad) * scale
  );
}
