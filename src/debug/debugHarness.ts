import { DEFAULT_GAME_CONFIG, GamePhase, GameState, Player, Tile } from '../types/game';
import { generateMap, tileMapFromArray } from '../game/mapGenerator';
import { processTurn, checkVictory } from '../game/turnEngine';
import { getControlledTileCount } from '../game/influence';
import { PLAYER_COLOR_PALETTE } from '../utils/color';

/**
 * Dev-only harness for exercising map generation and the turn engine
 * without Firebase or the lobby UI. Not part of the real game flow —
 * delete or gate behind a build flag before shipping.
 *
 * Usage from the browser console (after `npm start`):
 *   const game = debugHarness.createTestGame(4)    // 4 players
 *   debugHarness.logMap(game)
 *   const next = debugHarness.runTurns(game, 10)    // advance 10 turns
 *   debugHarness.logLeaderboard(next)
 */

export interface TestGame {
  state: GameState;
  tiles: Tile[];
}

export function createTestGame(numPlayers: number, config = DEFAULT_GAME_CONFIG): TestGame {
  const seed = Math.floor(Math.random() * 0xffffffff);
  const tiles = generateMap({
    width: config.mapWidth,
    height: config.mapHeight,
    landPercent: config.mapLandPercent,
    seed,
  });

  const activeTiles = tiles.filter((t) => t.active);
  if (activeTiles.length < numPlayers) {
    throw new Error(
      `Not enough active tiles (${activeTiles.length}) for ${numPlayers} players — try a smaller map or higher landPercent.`
    );
  }

  const players: Record<string, Player> = {};
  const usedStarts = new Set<string>();

  for (let i = 0; i < numPlayers; i++) {
    let tile;
    do {
      tile = activeTiles[Math.floor(Math.random() * activeTiles.length)];
    } while (usedStarts.has(`${tile.coord.q},${tile.coord.r}`));
    usedStarts.add(`${tile.coord.q},${tile.coord.r}`);

    const id = `player-${i}`;
    players[id] = {
      id,
      name: `Player ${i + 1}`,
      color: PLAYER_COLOR_PALETTE[i % PLAYER_COLOR_PALETTE.length],
      startTile: tile.coord,
      focusTiles: [tile.coord],
      joinedAtTurn: 0,
      isSpectator: false,
    };
    // Seed each player's start tile with some influence so turn 1 has something to work with.
    tile.influence[id] = 20;
  }

  const state: GameState = {
    roomId: 'debug-room',
    hostId: 'player-0',
    phase: GamePhase.Active,
    config,
    seed,
    turn: 0,
    players,
    createdAt: Date.now(),
  };

  return { state, tiles };
}

export function runTurns(game: TestGame, count: number): TestGame {
  let { state, tiles } = game;
  for (let i = 0; i < count; i++) {
    const result = processTurn(state, tiles);
    state = result.state;
    tiles = result.tiles;
    const winner = checkVictory(state, tiles);
    if (winner) {
      console.log(`[debugHarness] Victory for ${winner.name} at turn ${state.turn}`);
      break;
    }
  }
  return { state, tiles };
}

export function logLeaderboard(game: TestGame): void {
  const tileMap = tileMapFromArray(game.tiles);
  const rows = Object.values(game.state.players)
    .map((p) => ({ name: p.name, tiles: getControlledTileCount(tileMap, p.id) }))
    .sort((a, b) => b.tiles - a.tiles);
  console.table(rows);
}

export function logMap(game: TestGame): void {
  const activeCount = game.tiles.filter((t) => t.active).length;
  console.log(
    `[debugHarness] ${game.tiles.length} tiles total, ${activeCount} active (${(
      (activeCount / game.tiles.length) *
      100
    ).toFixed(1)}%)`
  );
}

// Expose on window for console access during dev.
const debugHarness = { createTestGame, runTurns, logLeaderboard, logMap };

declare global {
  interface Window {
    debugHarness: typeof debugHarness;
  }
}
if (typeof window !== 'undefined') {
  window.debugHarness = debugHarness;
}
