import { GameState, Player, Tile } from '../types/game';
import { tileMapFromArray } from './mapGenerator';
import {
  calculateInfluenceEarned,
  getControlledTiles,
  spreadInfluence,
  applyDecay,
} from './influence';
import { createRng, deriveSeed } from './rng';

export interface TurnResult {
  state: GameState;
  tiles: Tile[];
}

/**
 * Advances game state by one turn. Pure function — where this actually
 * runs (a Cloud Function on a schedule, vs a client-authoritative host
 * ticking locally and pushing state) is still an open decision; see the
 * note in firebase/roomService.ts about write volume at scale.
 *
 * `tiles` is passed in rather than read off `state` because it's no
 * longer synced — every client generates it locally from `state.seed`
 * (see game/mapGenerator.ts) and replays actions/turns against its own
 * copy.
 */
export function processTurn(state: GameState, tiles: Tile[]): TurnResult {
  const tileMap = tileMapFromArray(tiles);

  // Sorted by id rather than iterating Object.values() directly: players
  // are processed sequentially within a turn (an earlier player's spend
  // can contest a tile a later player would otherwise control), and
  // Firestore doesn't guarantee map-field order is preserved identically
  // across every client's read. Without a stable sort here, two clients
  // could legitimately compute different results from the same seed.
  const players = Object.values(state.players)
    .filter((p) => !p.isSpectator)
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const player of players) {
    const controlledTiles = getControlledTiles(tileMap, player.id);
    const earned = calculateInfluenceEarned(state.config, controlledTiles.length);
    // Each player gets an independent-looking but fully deterministic RNG
    // stream for this turn, derived from the room seed — every client
    // computes the identical result without syncing anything beyond seed
    // + actions.
    const rng = createRng(deriveSeed(state.seed, `turn:${state.turn}:player:${player.id}`));
    spreadInfluence(player, earned, tileMap, state.config, rng, controlledTiles);
  }

  applyDecay(tileMap, state.config);

  return {
    state: { ...state, turn: state.turn + 1 },
    tiles: Array.from(tileMap.values()),
  };
}

/** Returns the winning player if anyone exclusively controls more than controlPercentTarget, else null. */
export function checkVictory(state: GameState, tiles: Tile[]): Player | null {
  const activeTiles = tiles.filter((t) => t.active);
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

  // Safety net: simulation showed the current rules can reach a genuine
  // stalemate at contested borders (income vs. decay in equilibrium) with
  // nobody ever crossing controlPercentTarget. Force-end at maxTurns and
  // rank by tiles controlled — the same metric the brief already
  // specifies for the leaderboard — rather than let a room run forever.
  if (state.turn >= state.config.maxTurns) {
    let bestId: string | null = null;
    let bestCount = -1;
    for (const [playerId, count] of Object.entries(counts)) {
      if (count > bestCount) {
        bestCount = count;
        bestId = playerId;
      }
    }
    if (bestId) return state.players[bestId] ?? null;
    // Nobody controls anything at all (extreme edge case) — still need a
    // deterministic, guaranteed-terminating fallback.
    const ids = Object.keys(state.players).sort();
    return ids.length > 0 ? (state.players[ids[0]] ?? null) : null;
  }

  return null;
}
