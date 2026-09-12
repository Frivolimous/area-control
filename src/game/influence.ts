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
 * focus tiles. Likewise focusTiles is resolved by the caller from the
 * actions log (see game/actions.ts resolveFocusTiles) rather than read
 * off player.focusTiles directly — that field is only the initial value
 * from game start, not the live one during Active play.
 *
 * First pass — the distribution/randomness heuristics (esp. spend curve
 * along the line in rule 3) will need tuning once there's something
 * playable to test against further.
 */
export function spreadInfluence(
  player: Player,
  focusTiles: HexCoord[],
  earnedInfluence: number,
  tiles: Map<string, Tile>,
  config: GameConfig,
  rng: Rng,
  controlledTiles: Tile[]
): void {
  if (!player.startTile || focusTiles.length === 0) return; // hasn't picked a start location yet — nothing to spread from.

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
      spendLeftover(player, controlledTiles, leftover, tiles, config, rng);
    }
  } else {
    // Rule 3: walk a straight line toward the focus, fully saturating each
    // tile before moving to the next — a paced "laying track" advance
    // along the line, mirroring spendLeftover's reinforce-then-advance
    // pattern for the frontier case.
    //
    // Originally divided budget evenly across the WHOLE path and always
    // restarted from index 0 every turn. That never actually made
    // progress: the early tiles reach max within a turn or two, and
    // addInfluence silently clamps at max without signaling the spend had
    // no effect — so every subsequent turn's budget kept getting wasted
    // re-topping-up already-full tiles near the start, and the path never
    // advanced. Confirmed via simulation: a focus set on a far tile made
    // zero progress after 60 turns under the old approach.
    const path = hexLine(startTile, focus).filter((c) => tiles.has(hexKey(c)));
    let remaining = budget;
    for (const coord of path) {
      if (remaining <= 0) break;
      const tile = tiles.get(hexKey(coord));
      if (!tile || !tile.active) continue;
      const current = tile.influence[player.id] ?? 0;
      const toMax = Math.max(0, config.maxInfluencePerTile - current);
      if (toMax === 0) continue; // already maxed — move on to the next tile along the path
      const spend = Math.min(remaining, toMax);
      addInfluence(tile, player.id, spend, config);
      remaining -= spend;
    }
  }
}

/**
 * Spends leftover budget in two phases:
 *
 * 1. Reinforce the player's own controlled-but-submax tiles toward max.
 *    This is NOT in the brief's literal rules but is load-bearing: once a
 *    tile gets even 1 point of influence it's immediately "controlled"
 *    (control is about exclusivity, not magnitude), which makes it
 *    ineligible for phase 2's frontier-expansion targeting — but nothing
 *    else was topping it up toward max. Confirmed via simulation: without
 *    this phase, every newly-claimed tile gets stuck forever at whatever
 *    tiny amount first claimed it, and territory growth freezes almost
 *    immediately (a handful of tiles per player, permanently) since
 *    nothing can ever reach max to unlock the next ring.
 * 2. Once everything the player controls is maxed (or there's simply
 *    nothing left to reinforce), expand into new frontier — active,
 *    unclaimed tiles adjacent to something they control at max influence.
 *    Requiring the source tile to be maxed (not just controlled) means a
 *    newly-claimed ring has to fully solidify before it can spawn the
 *    next ring — a paced wavefront rather than instant unlimited-depth
 *    spread.
 *
 * Both phases pick randomly among their eligible set each point, so
 * growth is organic rather than uniform. If there's nowhere eligible for
 * either phase (fully boxed in by ocean or others' maxed territory, with
 * nothing of the player's own left to reinforce), the leftover goes
 * unspent for this call — an expected pacing lull, not a bug.
 */
function spendLeftover(
  player: Player,
  controlledTiles: Tile[],
  budget: number,
  tiles: Map<string, Tile>,
  config: GameConfig,
  rng: Rng
): void {
  let remaining = budget;

  // Phase 1: reinforce submax territory.
  const submax = controlledTiles.filter((t) => (t.influence[player.id] ?? 0) < config.maxInfluencePerTile);
  while (remaining > 0 && submax.length > 0) {
    const idx = Math.floor(rng() * submax.length);
    const tile = submax[idx];
    addInfluence(tile, player.id, 1, config);
    remaining -= 1;
    if ((tile.influence[player.id] ?? 0) >= config.maxInfluencePerTile) {
      submax.splice(idx, 1); // fully topped up — remove from the pool
    }
  }
  if (remaining <= 0) return;

  // Phase 2: expand into new frontier.
  const frontierKeys = new Set<string>();
  const frontier: HexCoord[] = [];
  for (const owned of controlledTiles) {
    if ((owned.influence[player.id] ?? 0) < config.maxInfluencePerTile) continue; // not maxed — can't push outward from here yet
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
