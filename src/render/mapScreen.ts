import * as PIXI from 'pixi.js';
import { GameConfig, GameState, HexCoord, Player, Tile } from '../types/game';
import { generateMap } from '../game/mapGenerator';
import { hexEquals, hexToPixel } from '../game/hexGrid';
import { hexStringToNumber, influenceFillColor } from '../utils/color';
import { MapRenderer, HEX_SIZE } from './mapRenderer';
import { onTileClick } from './inputHandler';
import { initPixiApp } from './pixiApp';
import { selectStartTile } from '../firebase/roomService';
import { processTurn, checkVictory } from '../game/turnEngine';

const NEUTRAL_LAND_COLOR = hexStringToNumber('#3a3a4e');

// Safety cap on how many turns a single tick will replay synchronously —
// guards against a long tab-backgrounded gap producing a huge catch-up
// loop that freezes the UI thread. Remaining turns just get picked up on
// the next tick instead.
const MAX_CATCHUP_TURNS_PER_TICK = 500;
const TICK_INTERVAL_MS = 100;

type Mode = 'lobby' | 'game';

let mode: Mode = 'lobby';
let mapRenderer: MapRenderer | null = null;
let currentTiles: Tile[] = [];

// Game-mode-only local state — each client runs its own copy of this,
// computed identically from the shared seed + gameStartTimestamp. See the
// comment on GameState.gameStartTimestamp for why no host broadcast is
// needed here.
let localState: GameState | null = null;
let localTiles: Tile[] = [];
let tickHandle: number | null = null;
let gameEnded = false;

export interface GameLoopCallbacks {
  onTick: (state: GameState, tiles: Tile[]) => void;
  onVictory: (winner: Player) => void;
}

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
    if (mode === 'lobby') {
      handleTileClick(roomId, myPlayerId, coord);
    }
    // TODO: game-mode click -> focus tile selection, not built yet.
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
 * subscribeToRoom callback whenever players change, during Setup. Unclaimed
 * tiles render as neutral land; claimed tiles render in that player's
 * color, so everyone sees selections live, per the brief. No-ops once the
 * game has actually started (see startGameLoop).
 */
export function updateMapScreen(players: Player[]): void {
  if (!mapRenderer || mode !== 'lobby') return;
  mapRenderer.render(currentTiles, (tile) => {
    const owner = players.find((p) => p.startTile && hexEquals(p.startTile, tile.coord));
    return owner ? hexStringToNumber(owner.color) : NEUTRAL_LAND_COLOR;
  });
}

/**
 * Switches from tile-claiming to actual gameplay. Every client that calls
 * this runs the identical simulation locally — no client is more
 * authoritative than another, since the whole point of the seed +
 * gameStartTimestamp anchor is that everyone converges on the same result
 * without needing to sync per-turn state over the network. Call once, when
 * a room's phase flips to Active.
 *
 * roomState is the snapshot as of game start — its `players` (with each
 * player's startTile/focusTiles as set during Setup) are frozen for the
 * rest of the game, since there's no live focus-change UI yet.
 */
export function startGameLoop(roomState: GameState, callbacks: GameLoopCallbacks): void {
  if (roomState.gameStartTimestamp == null) {
    console.error('startGameLoop called without gameStartTimestamp set');
    return;
  }

  mode = 'game';
  gameEnded = false;
  localState = { ...roomState, turn: 0 };
  // Deep-ish copy so game-mode mutation never touches the lobby's tile
  // array (which updateMapScreen still reads, defensively, even though it
  // no-ops outside lobby mode).
  localTiles = currentTiles.map((t) => ({ ...t, influence: { ...t.influence } }));

  tickHandle = window.setInterval(() => tick(callbacks), TICK_INTERVAL_MS);
  tick(callbacks); // render turn 0 immediately rather than waiting for the first interval
}

export function stopGameLoop(): void {
  if (tickHandle != null) {
    window.clearInterval(tickHandle);
    tickHandle = null;
  }
}

function tick(callbacks: GameLoopCallbacks): void {
  if (!localState || !mapRenderer || gameEnded || localState.gameStartTimestamp == null) return;

  const elapsed = Date.now() - localState.gameStartTimestamp;
  const targetTurn = Math.floor(elapsed / localState.config.turnDurationMs);

  let caughtUp = 0;
  while (localState.turn < targetTurn && caughtUp < MAX_CATCHUP_TURNS_PER_TICK) {
    const result = processTurn(localState, localTiles);
    localState = result.state;
    localTiles = result.tiles;
    caughtUp++;

    const winner = checkVictory(localState, localTiles);
    if (winner) {
      gameEnded = true;
      stopGameLoop();
      renderGameTiles();
      callbacks.onTick(localState, localTiles);
      callbacks.onVictory(winner);
      return;
    }
  }

  renderGameTiles();
  callbacks.onTick(localState, localTiles);
}

function renderGameTiles(): void {
  if (!mapRenderer || !localState) return;
  const playerColors: Record<string, string> = {};
  for (const p of Object.values(localState.players)) playerColors[p.id] = p.color;
  mapRenderer.render(localTiles, (tile) => influenceFillColor(tile, playerColors));
}

export function regenerateMapScreen(seed: number=-1, landPercent = 0.7): void {
  if (seed === -1) seed = Math.floor(Math.random() * 0xffffffff);
  if (!mapRenderer) return;
  currentTiles = generateMap({
    width: 100,
    height: 100,
    landPercent,
    seed,
  });
  mapRenderer.clear();
  mapRenderer.render(currentTiles, () => NEUTRAL_LAND_COLOR);
}

(window as any).regenerateMapScreen = regenerateMapScreen; // for debugging in console

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
