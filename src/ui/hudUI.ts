import { GameState } from '../types/game';
import { getControlledTileCount } from '../game/influence';
import { tileMapFromArray } from '../game/mapGenerator';

export function renderHud(root: HTMLElement, state: GameState): void {
  const turnCounter = root.querySelector('#turn-counter');
  if (turnCounter) turnCounter.textContent = `Turn ${state.turn}`;

  const leaderboard = root.querySelector('#leaderboard');
  if (leaderboard) {
    const tileMap = tileMapFromArray(state.tiles);
    const rows = Object.values(state.players)
      .filter((p) => !p.isSpectator)
      .map((p) => ({ player: p, count: getControlledTileCount(tileMap, p.id) }))
      .sort((a, b) => b.count - a.count);

    leaderboard.innerHTML = rows
      .map(
        (r) =>
          `<div class="leaderboard-row"><span style="color:${r.player.color}">●</span> ${r.player.name}: ${r.count}</div>`
      )
      .join('');
  }

  // TODO: focus-controls — list the player's own focus tiles (never shown
  // for other players, per the brief) with add/remove affordances.
}
