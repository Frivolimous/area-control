import { FocusChangedAction, HexCoord, Player } from '../types/game';
import { hexEquals } from './hexGrid';

/**
 * What were this player's focus tiles as of `turn`? Finds the latest
 * FocusChangedAction with effectiveTurn <= turn; falls back to the
 * player's initial focusTiles (set at game start), then to just their
 * start tile if even that's empty.
 *
 * Pure function of the full actions log — every client gets the same
 * answer regardless of when it locally received each action, as long as
 * it has the same set of actions with effectiveTurn <= turn. That's the
 * whole point of effectiveTurn: it doesn't matter whether an action
 * arrives before or after a client crosses that turn boundary, only that
 * it arrives before the client actually computes that turn (see
 * render/mapScreen.ts BUFFER_MS).
 */
export function resolveFocusTiles(player: Player, actions: FocusChangedAction[], turn: number): HexCoord[] {
  const relevant = actions
    .filter((a) => a.playerId === player.id && a.effectiveTurn <= turn)
    .sort((a, b) => a.effectiveTurn - b.effectiveTurn || a.createdAt - b.createdAt);

  if (relevant.length > 0) return relevant[relevant.length - 1].focusTiles;
  if (player.focusTiles.length > 0) return player.focusTiles;
  return player.startTile ? [player.startTile] : [];
}

/**
 * Toggles a tile in/out of a player's current focus set — the interaction
 * behind clicking a tile during Active play.
 */
export function toggleFocusTile(currentFocus: HexCoord[], coord: HexCoord): HexCoord[] {
  const alreadyFocused = currentFocus.some((c) => hexEquals(c, coord));
  if (alreadyFocused) {
    return currentFocus.filter((c) => !hexEquals(c, coord));
  }
  return [...currentFocus, coord];
}
