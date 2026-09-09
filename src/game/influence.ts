import { GameConfig, HexCoord, Player, PlayerId, Tile } from '../types/game';
import { hexKey, hexNeighbors, hexLine } from './hexGrid';
import { Rng } from './rng';

export function calculateInfluenceEarned(config: GameConfig, numControlledTiles: number): number {
  // Brief's formula, flagged there as still needing work.
  return config.influenceEarnedBase + config.influenceEarnedPerTile * numControlledTiles;
}

export function isControlledBy(tile: Tile, playerId: PlayerId): boolean {
  const influencers = Object.keys(tile.influence).filter((id) => (tile.influence[id] ?? 0) > 0);
  return influencers.length === 1 && influencers[0] === playerId;
}

/** All tiles a player currently exclusively controls. */
export function getControlledTiles(tiles: Map<string, Tile>, playerId: PlayerId): Tile[] {
  const result: Tile[] = [];
  for (const tile of tiles.values()) {
    if (isControlledBy(tile, playerId)) result.push(tile);
  }
  return result;
}

export function getControlledTileCount(tiles: Map<string, Tile>, playerId: PlayerId): number {
  return getControlledTiles(tiles, playerId).length;
}

/**
 * Spends a player's earned influence for the turn, per the brief's rules:
 * 1. Start tile is always a focus.
 * 2. Influence splits evenly across focus tiles, remainder spent randomly.
 * 3. Focus not controlled by the player -> spread in a straight line toward it.
 * 4. Focus controlled by the player -> pump the tile itself to max.
 * 5. Leftover after topping up a controlled focus spreads randomly around it.
 *
 * "Around" in rule 5 means the frontier of the player's territory (any
 * active, not-yet-theirs tile adjacent to something they control) — not
 * literally just the focus tile's 6 neighbors. That distinction matters:
 * the earlier neighbors-only version capped every player's expansion at 7
 * tiles forever, since once those 6 neighbors were claimed there was
 * nowhere left to spend leftover influence. The frontier grows outward
 * turn by turn as newly-claimed tiles become part of the territory whose
 * neighbors count as frontier next turn — confirmed by simulation to
 * actually converge to a winner (see turnEngine.ts).
 *
 * controlledTiles is passed in (computed once per player per turn in
 * turnEngine.ts) rather than recomputed here, since a full scan of the
 * tile map is not cheap to repeat per-focus for a player with multiple
 * focus tiles.
 *
 * First pass — the distribution/randomness heuristics (esp. spend curve
 * along the line in rule 3) will need tuning once there's something
 * playable to test against further.
 */
export function spreadInfluence(
  player: Player,
  earnedInfluence: number,
  tiles: Map<string, Tile>,
  config: GameConfig,
  rng: Rng,
  controlledTiles: Tile[]
): void {
  if (!player.startTile) return; // hasn't picked a start location yet — nothing to spread from.

  const focusTiles = player.focusTiles.length > 0 ? player.focusTiles : [player.startTile];
  const perFocus = Math.floor(earnedInfluence / focusTiles.length);
  let remainder = earnedInfluence - perFocus * focusTiles.length;

  for (const focus of focusTiles) {
    let budget = perFocus;
    if (remainder > 0) {
      budget += 1;
      remainder -= 1;
    }
    spendOnFocus(player, player.startTile, focus, budget, tiles, config, rng, controlledTiles);
  }
}

function spendOnFocus(
  player: Player,
  startTile: HexCoord,
  focus: HexCoord,
  budget: number,
  tiles: Map<string, Tile>,
  config: GameConfig,
  rng: Rng,
  controlledTiles: Tile[]
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
      spreadToFrontier(player, controlledTiles, leftover, tiles, config, rng);
    }
  } else {
    // Rule 3: walk a straight line toward the focus, spending along the way.
    // TODO: decide the exact spend curve (front-loaded vs even vs weighted
    // toward the far end) — currently spends evenly across the path.
    const path = hexLine(startTile, focus).filter((c) => tiles.has(hexKey(c)));
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

/**
 * Spends leftover budget on the frontier of the player's territory: active
 * tiles adjacent to something they already control, that aren't already
 * exclusively theirs. Picks randomly among that frontier each point, so
 * growth is organic rather than uniform. If the player is fully boxed in
 * (no frontier left — e.g. surrounded by ocean or other players' maxed
 * territory), the leftover just goes unspent for this call; that's a rare
 * edge case, not a bug to work around.
 */
function spreadToFrontier(
  player: Player,
  controlledTiles: Tile[],
  budget: number,
  tiles: Map<string, Tile>,
  config: GameConfig,
  rng: Rng
): void {
  const frontierKeys = new Set<string>();
  const frontier: HexCoord[] = [];

  for (const owned of controlledTiles) {
    for (const n of hexNeighbors(owned.coord)) {
      const key = hexKey(n);
      if (frontierKeys.has(key)) continue;
      const t = tiles.get(key);
      if (!t || !t.active || isControlledBy(t, player.id)) continue;
      frontierKeys.add(key);
      frontier.push(n);
    }
  }
  if (frontier.length === 0) return;

  let remaining = budget;
  while (remaining > 0) {
    const coord = frontier[Math.floor(rng() * frontier.length)];
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
