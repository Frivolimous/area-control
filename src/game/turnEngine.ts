import { GameState, Player } from '../types/game';
import { tileMapFromArray } from './mapGenerator';
import {
  calculateInfluenceEarned,
  getControlledTileCount,
  spreadInfluence,
  applyDecay,
} from './influence';

/**
 * Advances game state by one turn. Pure function — where this actually
 * runs (a Cloud Function on a schedule, vs a client-authoritative host
 * ticking locally and pushing state) is still an open decision; see the
 * note in firebase/roomService.ts about write volume at scale.
 */
export function processTurn(state: GameState): GameState {
  const tileMap = tileMapFromArray(state.tiles);
  const players = Object.values(state.players).filter((p) => !p.isSpectator);

  for (const player of players) {
    const controlledCount = getControlledTileCount(tileMap, player.id);
    const earned = calculateInfluenceEarned(state.config, controlledCount);
    spreadInfluence(player, earned, tileMap, state.config);
  }

  applyDecay(tileMap, state.config);

  return {
    ...state,
    turn: state.turn + 1,
    tiles: Array.from(tileMap.values()),
  };
}

/** Returns the winning player if anyone exclusively controls more than controlPercentTarget, else null. */
export function checkVictory(state: GameState): Player | null {
  const activeTiles = state.tiles.filter((t) => t.active);
  const totalActive = activeTiles.length;
  if (totalActive === 0) return null;

  const counts: Record<string, number> = {};
  for (const tile of activeTiles) {
    const influencers = Object.keys(tile.influence).filter((id) => (tile.influence[id] ?? 0) > 0);
    if (influencers.length === 1) {
      counts[influencers[0]] = (counts[influencers[0]] ?? 0) + 1;
    }
  }

  for (const [playerId, count] of Object.entries(counts)) {
    if (count / totalActive > state.config.controlPercentTarget) {
      return state.players[playerId] ?? null;
    }
  }
  return null;
}
