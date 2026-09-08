import { GameConfig, HexCoord, Player, PlayerId, Tile } from '../types/game';
import { hexKey, hexNeighbors, hexLine } from './hexGrid';

export function calculateInfluenceEarned(config: GameConfig, numControlledTiles: number): number {
  // Brief's formula, flagged there as still needing work.
  return config.influenceEarnedBase + config.influenceEarnedPerTile * numControlledTiles;
}

export function isControlledBy(tile: Tile, playerId: PlayerId): boolean {
  const influencers = Object.keys(tile.influence).filter((id) => (tile.influence[id] ?? 0) > 0);
  return influencers.length === 1 && influencers[0] === playerId;
}

export function getControlledTileCount(tiles: Map<string, Tile>, playerId: PlayerId): number {
  let count = 0;
  for (const tile of tiles.values()) {
    if (isControlledBy(tile, playerId)) count++;
  }
  return count;
}

/**
 * Spends a player's earned influence for the turn, per the brief's rules:
 * 1. Start tile is always a focus.
 * 2. Influence splits evenly across focus tiles, remainder spent randomly.
 * 3. Focus not controlled by the player -> spread in a straight line toward it.
 * 4. Focus controlled by the player -> pump the tile itself to max.
 * 5. Leftover after topping up a controlled focus spreads randomly around it.
 *
 * First pass — the distribution/randomness heuristics (esp. spend curve
 * along the line in rule 3, and "random" in rules 2 & 5) will need tuning
 * once there's something playable to test against.
 */
export function spreadInfluence(
  player: Player,
  earnedInfluence: number,
  tiles: Map<string, Tile>,
  config: GameConfig
): void {
  const focusTiles = player.focusTiles.length > 0 ? player.focusTiles : [player.startTile];
  const perFocus = Math.floor(earnedInfluence / focusTiles.length);
  let remainder = earnedInfluence - perFocus * focusTiles.length;

  for (const focus of focusTiles) {
    let budget = perFocus;
    if (remainder > 0) {
      budget += 1;
      remainder -= 1;
    }
    spendOnFocus(player, focus, budget, tiles, config);
  }
}

function spendOnFocus(
  player: Player,
  focus: HexCoord,
  budget: number,
  tiles: Map<string, Tile>,
  config: GameConfig
): void {
  const focusTile = tiles.get(hexKey(focus));
  if (!focusTile || budget <= 0) return;

  if (isControlledBy(focusTile, player.id)) {
    // Rule 4: pump the focus tile itself toward max, spill leftover nearby.
    const current = focusTile.influence[player.id] ?? 0;
    const toMax = Math.max(0, config.maxInfluencePerTile - current);
    const spend = Math.min(budget, toMax);
    addInfluence(focusTile, player.id, spend, config);
    const leftover = budget - spend;
    if (leftover > 0) {
      spreadRandomlyAround(player, focus, leftover, tiles, config);
    }
  } else {
    // Rule 3: walk a straight line toward the focus, spending along the way.
    // TODO: decide the exact spend curve (front-loaded vs even vs weighted
    // toward the far end) — currently spends evenly across the path.
    const path = hexLine(player.startTile, focus).filter((c) => tiles.has(hexKey(c)));
    const perTile = Math.max(1, Math.floor(budget / Math.max(1, path.length)));
    let remaining = budget;
    for (const coord of path) {
      if (remaining <= 0) break;
      const tile = tiles.get(hexKey(coord));
      if (!tile || !tile.active) continue;
      const spend = Math.min(perTile, remaining);
      addInfluence(tile, player.id, spend, config);
      remaining -= spend;
    }
  }
}

function spreadRandomlyAround(
  player: Player,
  center: HexCoord,
  budget: number,
  tiles: Map<string, Tile>,
  config: GameConfig
): void {
  const neighbors = hexNeighbors(center).filter((c) => {
    const t = tiles.get(hexKey(c));
    return t && t.active;
  });
  if (neighbors.length === 0) return;

  let remaining = budget;
  while (remaining > 0) {
    const coord = neighbors[Math.floor(Math.random() * neighbors.length)];
    const tile = tiles.get(hexKey(coord));
    if (tile) addInfluence(tile, player.id, 1, config);
    remaining -= 1;
  }
}

function addInfluence(tile: Tile, playerId: PlayerId, amount: number, config: GameConfig): void {
  const current = tile.influence[playerId] ?? 0;
  tile.influence[playerId] = Math.min(config.maxInfluencePerTile, current + amount);
}

/** End-of-turn decay: any tile with more than one influencing player decays for all of them. */
export function applyDecay(tiles: Map<string, Tile>, config: GameConfig): void {
  for (const tile of tiles.values()) {
    const influencers = Object.keys(tile.influence).filter((id) => (tile.influence[id] ?? 0) > 0);
    if (influencers.length <= 1) continue;

    for (const id of influencers) {
      const current = tile.influence[id] ?? 0;
      const decayed = Math.max(0, current - config.influenceDecayPerTurn);
      if (decayed === 0) {
        delete tile.influence[id];
      } else {
        tile.influence[id] = decayed;
      }
    }
  }
}
