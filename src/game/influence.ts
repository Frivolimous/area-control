import { GameConfig, HexCoord, Player, PlayerId, Tile } from '../types/game';
import { hexKey, hexLine, hexRing, hexDistance } from './hexGrid';
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
 * 5. Leftover after topping up a controlled focus spreads around it.
 *
 * Both controlled (rules 4-5) and uncontrolled (rule 3) foci ultimately
 * spend through ringExpand — see its docstring for the radius-by-radius
 * mechanic. focusTiles is resolved by the caller from the actions log
 * (see game/actions.ts resolveFocusTiles) rather than read off
 * player.focusTiles directly — that field is only the initial value from
 * game start, not the live one during Active play.
 *
 * controlledTiles is passed in (computed once per player per turn in
 * turnEngine.ts, already needed there for the earn-per-tile calculation)
 * rather than recomputed here — rule 3 uses it to find the player's
 * nearest controlled tile to a given uncontrolled focus, see spendOnFocus.
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

/** Nearest (by hex distance) of a player's controlled tiles to `target`, or null if they control nothing. Ties broken by iteration order — deterministic, since controlledTiles' order derives from the deterministic tile map. */
function findNearestControlledTile(controlledTiles: Tile[], target: HexCoord): HexCoord | null {
  let nearest: HexCoord | null = null;
  let bestDist = Infinity;
  for (const tile of controlledTiles) {
    const d = hexDistance(tile.coord, target);
    if (d < bestDist) {
      bestDist = d;
      nearest = tile.coord;
    }
  }
  return nearest;
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
    // Rules 4-5: ring-expand outward from the focus itself. Radius 0 (the
    // focus tile) is naturally prioritized first as the smallest ring, so
    // this covers "pump the focus to max" and "spread the leftover
    // around it" as one mechanic rather than two separate steps.
    ringExpand(player, focus, budget, tiles, config, rng);
  } else {
    // Rule 3: walk a straight line toward the focus, fully saturating
    // each tile before advancing to the next — starting from the
    // player's NEAREST controlled tile to the focus, not always the
    // original start tile. Previously always started from startTile
    // regardless of how far the player's territory had since grown in
    // some other direction — needlessly long once expanded, and could
    // hit an unrelated gap near the original start point even when the
    // player's actual nearest territory had a clean path.
    //
    // Also STOPS at the first gap (an inactive tile, or one that doesn't
    // exist on the grid at all) rather than skipping past it and
    // continuing to spend on tiles on the far side — otherwise influence
    // could "cross" open water or the edge of the generated grid
    // instantly in a single turn, without ever actually reaching there
    // via contiguous land.
    //
    // Whatever's left over once the walk is blocked by a gap, or
    // finishes (reaches the focus, or the whole reachable path is
    // already maxed), ring-expands from whichever tile the walk actually
    // reached — that tile effectively becomes the focus for the
    // leftover, exactly as if it had been a controlled focus there.
    const origin = findNearestControlledTile(controlledTiles, focus) ?? startTile;
    const path = hexLine(origin, focus);
    let remaining = budget;
    let lastReached: HexCoord = origin;

    for (const coord of path) {
      if (remaining <= 0) break;
      const tile = tiles.get(hexKey(coord));
      if (!tile || !tile.active) break; // gap — stop here, don't cross it
      lastReached = coord;

      const current = tile.influence[player.id] ?? 0;
      const toMax = config.maxInfluencePerTile - current;
      if (toMax <= 0) continue; // already maxed — move on to the next tile along the path

      const spend = Math.min(remaining, toMax);
      addInfluence(tile, player.id, spend, config);
      remaining -= spend;
    }

    if (remaining > 0) {
      ringExpand(player, lastReached, remaining, tiles, config, rng);
    }
  }
}

// Generous safety cap on ring radius — guarantees ringExpand terminates
// even if budget is huge and rings keep coming up empty (e.g. running off
// the edge of the generated grid in every direction). Cheap regardless:
// checking every radius up to this cap is at most a few tens of
// thousands of hex-distance comparisons, negligible next to a turn's
// other costs.
const MAX_RING_RADIUS = 300;

/**
 * Expands outward from `center` in expanding rings — radius 0 (just the
 * center tile), then 1, then 2, 3... — splitting the available budget as
 * evenly as possible among all eligible tiles in each ring before moving
 * to a wider one. A tile is eligible if it's active and this player
 * hasn't already maxed it out; that deliberately includes both the
 * player's own partially-filled nearby tiles and unclaimed/contested/
 * enemy tiles alike — proximity to the center is what decides priority
 * here, not current ownership.
 *
 * A ring only gets skipped (moving straight to the next radius) if it has
 * no eligible tiles at all. Otherwise the ring's budget share is
 * distributed via a per-tile base amount plus the remainder, given out to
 * a shuffled subset so it's not always the same tiles (by hexRing's fixed
 * generation order) getting the +1 — this shuffle is a plain loop, not a
 * sort comparator, so calling rng() here doesn't have the engine-
 * dependent-invocation-order problem a sort would (see
 * game/voronoiRegions.ts for that pitfall). If a ring's per-tile share
 * exceeds what some tiles can still absorb (already close to max), the
 * excess correctly carries over to the next radius rather than being
 * wasted, since spend is capped at each tile's own remaining room and the
 * unspent difference stays in `remaining`.
 *
 * Terminates once budget runs out, or MAX_RING_RADIUS is reached with
 * nothing having been spent for a while (a ring coming up transiently
 * empty doesn't mean a wider one will too — e.g. it could be a lake — so
 * this doesn't stop at the first empty ring).
 */
function ringExpand(
  player: Player,
  center: HexCoord,
  budget: number,
  tiles: Map<string, Tile>,
  config: GameConfig,
  rng: Rng
): void {
  let remaining = budget;
  let radius = 0;

  while (remaining > 0 && radius <= MAX_RING_RADIUS) {
    const ring = hexRing(center, radius).filter((coord) => {
      const tile = tiles.get(hexKey(coord));
      if (!tile || !tile.active) return false;
      const current = tile.influence[player.id] ?? 0;
      return current < config.maxInfluencePerTile;
    });

    if (ring.length === 0) {
      radius++;
      continue;
    }

    const perTile = Math.floor(remaining / ring.length);
    let remainder = remaining - perTile * ring.length;

    const order = ring.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    for (const idx of order) {
      const tile = tiles.get(hexKey(ring[idx]));
      if (!tile) continue;

      const current = tile.influence[player.id] ?? 0;
      const toMax = config.maxInfluencePerTile - current;
      let share = perTile;
      if (remainder > 0) {
        share += 1;
        remainder -= 1;
      }
      const spend = Math.min(share, toMax, remaining);
      if (spend <= 0) continue;

      addInfluence(tile, player.id, spend, config);
      remaining -= spend;
    }

    radius++;
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
