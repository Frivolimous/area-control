import * as PIXI from 'pixi.js';
import { GameConfig, GameState, HexCoord, Player, Tile } from '../types/game';
import { generateMap, MapGenOptions } from '../game/mapGenerator';
import { hexEquals, hexKey, hexToPixel } from '../game/hexGrid';
import { hexStringToNumber, influenceFillColor, lerpColorNumeric } from '../utils/color';
import { MapRenderer, HEX_SIZE } from './mapRenderer';
import { onTileClick } from './inputHandler';
import { getPixiApp, initPixiApp } from './pixiApp';
import { selectStartTile, changeFocus } from '../firebase/roomService';
import { processTurn, checkVictory } from '../game/turnEngine';
import { resolveFocusTiles, toggleFocusTile } from '../game/actions';
import { tileMapFromArray } from '../game/mapGenerator';

const NEUTRAL_LAND_COLOR = hexStringToNumber('#3a3a4e');

// Safety cap on how many turns a single tick will replay synchronously —
// guards against a long tab-backgrounded gap producing a huge catch-up
// loop that freezes the UI thread. Remaining turns just get picked up on
// the next tick instead.
const MAX_CATCHUP_TURNS_PER_TICK = 500;
// How often we check whether enough real time has passed to advance a
// turn. Cheap to poll frequently now that render/onTick only fire when a
// turn actually advances (see tick() below) — this just bounds the worst-
// case latency between a turn boundary and it showing up on screen. Should
// stay comfortably below whatever turnDurationMs you configure; 30ms
// supports turnDurationMs down to roughly 200-300ms (see the clock-skew
// note in README.md) before that becomes the limiting factor instead.
const TICK_INTERVAL_MS = 30;
// Delay between a turn's wall-clock boundary and a client actually
// computing that turn — gives Firestore's realtime listener time to
// deliver any focus-change action meant for that turn before we commit to
// computing it. Without this, a client could compute turn N locally
// before another player's same-turn action has arrived, producing a
// permanent fork (localTiles advances incrementally, not recomputed from
// scratch, so a missed action doesn't self-heal). Conservative default —
// tune down once real Firestore listener latency has been measured in
// practice; see the tuning note in README.md.
const BUFFER_MS = 250;

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
let myPlayerId: string | null = null;
let myRoomId: string | null = null;

// Color-fade animation state. Turns advance in discrete jumps (every
// turnDurationMs, or faster during catch-up), which looks stuttery if the
// displayed color just snaps to the new value. Instead, each turn's color
// change fades in smoothly over the following turnDurationMs, on a
// requestAnimationFrame loop decoupled from the turn-advancing setInterval
// above. Only tiles that actually changed color that turn are touched per
// frame (see beginColorFade/animateFade) — typically a small fraction of
// the map near contested frontiers — rather than redrawing everything at
// 60fps, which would undo the "only redraw on change" optimization done
// for the turnDurationMs speed question.
let prevFillColors: Map<string, number> = new Map();
let targetFillColors: Map<string, number> = new Map();
let fadingTileKeys: Set<string> = new Set();
let fadeTileLookup: Map<string, Tile> = new Map();
let turnAdvanceTime = 0;
let rafHandle: number | null = null;

// The local player's own click is the source of truth for the highlight
// immediately, ahead of Firestore round-tripping the action back and the
// next turn actually processing it — resolveFocusTiles from the actions
// log would otherwise show the PREVIOUS focus set until that catches up,
// which could be a full turnDurationMs + BUFFER_MS away. Cleared on the
// next real turn advance, by which point the action has taken effect
// (effectiveTurn is always "the next turn"), so resolveFocusTiles agrees
// again and there's nothing left for this to override.
let optimisticFocusTiles: HexCoord[] | null = null;

export interface GameLoopCallbacks {
  onTick: (state: GameState, tiles: Tile[]) => void;
  onVictory: (winner: Player) => void;
}

/**
 * Boots the pixi app, generates the map deterministically from the room's
 * seed, and wires clicks — to claiming a start tile during Setup, or to
 * toggling focus tiles during Active play. Call once per room — the map
 * only needs generating once per client since it's a pure function of
 * (config, seed), both fixed for the room's lifetime.
 */
export function initMapScreen(
  container: HTMLElement,
  roomId: string,
  playerId: string,
  config: GameConfig,
  seed: number
): void {
  myRoomId = roomId;
  myPlayerId = playerId;

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
      handleSetupClick(roomId, playerId, coord);
    } else {
      handleGameClick(coord);
    }
  });
}

function handleSetupClick(roomId: string, playerId: string, coord: HexCoord): void {
  const tile = currentTiles.find((t) => hexEquals(t.coord, coord));
  if (!tile || !tile.active) return; // clicked water or off the grid — ignore

  selectStartTile(roomId, playerId, coord).catch((err) => {
    // Most likely cause: someone else claimed this tile a moment earlier
    // (the transaction in roomService.ts is what actually prevents the
    // conflict — this just surfaces the rejection to the user).
    console.error('Failed to select start tile', err);
    alert(err instanceof Error ? err.message : 'Could not select that tile.');
  });
}

/** The local player's current focus tiles for rendering purposes — prefers the optimistic click override, see optimisticFocusTiles. */
function getMyFocusTiles(): HexCoord[] {
  if (optimisticFocusTiles) return optimisticFocusTiles;
  if (!localState || !myPlayerId) return [];
  const me = localState.players[myPlayerId];
  return me ? resolveFocusTiles(me, localState.actions, localState.turn) : [];
}

/**
 * Toggles a tile in/out of the current player's own focus set. The start
 * tile can never be removed (brief rule 1) — toggleFocusTile is a no-op
 * for it. The change takes effect at the next turn boundary (never
 * immediately), which is what makes it safe regardless of exactly when
 * other clients' Firestore listeners deliver it — see BUFFER_MS and
 * types/game.ts FocusChangedAction. The highlight itself, though, updates
 * right away (see optimisticFocusTiles) — no reason to make the player
 * wait a full turn just to see their own click register.
 */
function handleGameClick(coord: HexCoord): void {
  if (!localState || !myRoomId || !myPlayerId) return;
  const me = localState.players[myPlayerId];
  if (!me || !me.startTile) return;

  const tile = localTiles.find((t) => hexEquals(t.coord, coord));
  if (!tile || !tile.active) return;

  const currentFocus = getMyFocusTiles();
  const newFocus = toggleFocusTile(currentFocus, me.startTile, coord);
  if (newFocus === currentFocus) return; // no-op toggle (clicked the start tile)

  optimisticFocusTiles = newFocus;
  if (mapRenderer) {
    const key = hexKey(coord);
    const fillColor = targetFillColors.get(key) ?? NEUTRAL_LAND_COLOR;
    const willBeFocused = newFocus.some((c) => hexEquals(c, coord));
    mapRenderer.updateTileColor(tile, fillColor, willBeFocused);
  }

  const effectiveTurn = getCurrentBufferedTurn() + 1;
  changeFocus(myRoomId, myPlayerId, newFocus, effectiveTurn).catch((err) => {
    console.error('Failed to change focus', err);
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
 * Feeds freshly-arrived Firestore state into the running game loop —
 * specifically, new focus-change actions from any player. Call this from
 * every subscribeToRoom callback once the game is Active (harmless to
 * call before that too). Wholesale-replaces localState.actions rather
 * than merging/deduping: actions are immutable once created and Firestore
 * always delivers the full current array, so a plain replace is safe and
 * simpler than diffing.
 */
export function applyRoomActions(actions: GameState['actions']): void {
  if (!localState) return;
  localState = { ...localState, actions };
}

/**
 * Switches from tile-claiming to actual gameplay. Every client that calls
 * this runs the identical simulation locally — no client is more
 * authoritative than another, since the whole point of the seed +
 * gameStartTimestamp anchor is that everyone converges on the same result
 * without needing to sync per-turn state over the network. Call once, when
 * a room's phase flips to Active.
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

  // Reset fade state in case a previous game ran in this same session —
  // otherwise turn 0 could try to fade FROM stale colors left over from a
  // prior game rather than from neutral.
  prevFillColors = new Map();
  targetFillColors = new Map();
  fadingTileKeys = new Set();
  optimisticFocusTiles = null;

  // Start tiles begin fully entrenched (max influence) rather than
  // building up from zero — players can push outward from turn 0 instead
  // of spending the first several turns just filling their own start
  // tile. See game/influence.ts spreadToFrontier for why this also
  // matters mechanically: only maxed tiles can spawn frontier expansion.
  const tileByKey = new Map(localTiles.map((t) => [hexKey(t.coord), t] as const));
  for (const player of Object.values(localState.players)) {
    if (player.isSpectator || !player.startTile) continue;
    const tile = tileByKey.get(hexKey(player.startTile));
    if (tile) tile.influence[player.id] = localState.config.maxInfluencePerTile;
  }

  tickHandle = window.setInterval(() => tick(callbacks), TICK_INTERVAL_MS);
  tick(callbacks); // compute + begin fading in turn 0 immediately rather than waiting for the first interval

  startAnimationLoop();
}

export function stopGameLoop(): void {
  if (tickHandle != null) {
    window.clearInterval(tickHandle);
    tickHandle = null;
  }
  stopAnimationLoop();
}

/** The turn this client is confident is safe to compute right now — see BUFFER_MS. */
function getCurrentBufferedTurn(): number {
  if (!localState || localState.gameStartTimestamp == null) return 0;
  const elapsed = Date.now() - localState.gameStartTimestamp;
  const safeElapsed = Math.max(0, elapsed - BUFFER_MS);
  return Math.floor(safeElapsed / localState.config.turnDurationMs);
}

function tick(callbacks: GameLoopCallbacks): void {
  if (!localState || !mapRenderer || gameEnded || localState.gameStartTimestamp == null) return;

  const targetTurn = getCurrentBufferedTurn();

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
      renderGameTiles(); // full accurate snap at game end, not a partial fade-in-progress
      callbacks.onTick(localState, localTiles);
      callbacks.onVictory(winner);
      return;
    }
  }

  // Nothing to do if no turn actually advanced this poll — avoids
  // recomputing fade targets and re-rendering the HUD on every single
  // poll interval regardless of whether the game state changed.
  if (caughtUp === 0) return;

  beginColorFade();
  callbacks.onTick(localState, localTiles);
}

/**
 * Captures the color each active tile should fade TO this turn, and what
 * it should fade FROM (wherever the previous fade was heading — not
 * necessarily where the animation had visually gotten to if interrupted
 * mid-fade, e.g. during catch-up after a backgrounded tab; that's fine,
 * since catch-up intentionally skips animating through skipped turns and
 * only fades in the final resulting state). Only tiles whose color
 * actually changed get added to fadingTileKeys — animateFade() only
 * touches those, not the whole map, every frame.
 */
function beginColorFade(): void {
  if (!localState) return;
  const playerColors: Record<string, string> = {};
  for (const p of Object.values(localState.players)) playerColors[p.id] = p.color;
  const maxInfluencePerTile = localState.config.maxInfluencePerTile;

  const newTargets = new Map<string, number>();
  const changed = new Set<string>();
  for (const tile of localTiles) {
    if (!tile.active) continue;
    const key = hexKey(tile.coord);
    const color = influenceFillColor(tile, playerColors, maxInfluencePerTile);
    newTargets.set(key, color);
    if (targetFillColors.get(key) !== color) changed.add(key);
  }

  prevFillColors = targetFillColors; // wherever we were fading TOWARD becomes the new fade-FROM point
  targetFillColors = newTargets;
  fadingTileKeys = changed;
  fadeTileLookup = tileMapFromArray(localTiles);
  turnAdvanceTime = Date.now();

  // Any focus change submitted before this turn boundary has now taken
  // effect (effectiveTurn is always "the next turn processed"), so
  // resolveFocusTiles agrees with whatever was shown optimistically —
  // nothing left to override.
  optimisticFocusTiles = null;
}

function startAnimationLoop(): void {
  const loop = () => {
    animateFade();
    rafHandle = mode === 'game' && !gameEnded ? requestAnimationFrame(loop) : null;
  };
  rafHandle = requestAnimationFrame(loop);
}

function stopAnimationLoop(): void {
  if (rafHandle != null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

function animateFade(): void {
  if (!localState || !mapRenderer || fadingTileKeys.size === 0) return;

  const t = Math.min(1, (Date.now() - turnAdvanceTime) / localState.config.turnDurationMs);
  const myFocus = getMyFocusTiles();

  for (const key of fadingTileKeys) {
    const tile = fadeTileLookup.get(key);
    if (!tile) continue;
    const prevColor = prevFillColors.get(key) ?? NEUTRAL_LAND_COLOR;
    const targetColor = targetFillColors.get(key) ?? NEUTRAL_LAND_COLOR;
    const color = t >= 1 ? targetColor : lerpColorNumeric(prevColor, targetColor, t);
    const highlighted = myFocus.some((c) => hexEquals(c, tile.coord));
    mapRenderer.updateTileColor(tile, color, highlighted);
  }

  if (t >= 1) fadingTileKeys.clear(); // done — nothing more to update until the next turn advance
}

function renderGameTiles(): void {
  if (!mapRenderer || !localState) return;
  const playerColors: Record<string, string> = {};
  for (const p of Object.values(localState.players)) playerColors[p.id] = p.color;
  const maxInfluencePerTile = localState.config.maxInfluencePerTile;

  // Only ever highlight the LOCAL player's own focus tiles — the brief is
  // explicit that other players' focus is invisible. Every client has all
  // the data (it needs everyone's to compute turns correctly), so this
  // privacy rule is enforced here, at render time, not by withholding data.
  const myFocus = getMyFocusTiles();

  mapRenderer.render(
    localTiles,
    (tile) => influenceFillColor(tile, playerColors, maxInfluencePerTile),
    (tile) => myFocus.some((c) => hexEquals(c, tile.coord))
  );
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

export function regenerateMapScreen(seed: number=-1, options: Partial<MapGenOptions> = {}): void {
  if (seed === -1) seed = Math.floor(Math.random() * 0xffffffff);
  if (!mapRenderer) return;
  options.width ??= 100;
  options.height ??= 100;
  options.landPercent ??= 0.7;
  options.seed = seed;
  options.edgeMarginFraction ??= 0.08;
  options.edgeMarginMin ??= 2;
  options.paddingFactor ??= 1.4;
  options.regionOptions ??= {
    minRegions: 8,
    maxRegions: 32,
    regionDensity: 2.75,
  };
  options.lakeOptions ??= {
    numLakesDenominator: 100,
    numLakesMin: 1,
    minLakeSize: 3,
    maxLakeSizeDenominator: 20,
    maxLakeSizeMin: 5,
  };
  currentTiles = generateMap(options);
  mapRenderer.clear();
  mapRenderer.render(currentTiles, () => NEUTRAL_LAND_COLOR);
  fitAndCenter(getPixiApp(), mapRenderer.container, currentTiles);

}

(window as any).regenerateMapScreen = regenerateMapScreen; // for debugging in console
