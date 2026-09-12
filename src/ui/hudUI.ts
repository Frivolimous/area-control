import { GameState, Tile } from '../types/game';
import { getControlledTileCount } from '../game/influence';
import { tileMapFromArray } from '../game/mapGenerator';
import { resolveFocusTiles } from '../game/actions';

export function renderHud(root: HTMLElement, state: GameState, tiles: Tile[], myPlayerId: string): void {
  const turnCounter = root.querySelector('#turn-counter');
  if (turnCounter) turnCounter.textContent = `Turn ${state.turn}`;

  const leaderboard = root.querySelector('#leaderboard');
  if (leaderboard) {
    const tileMap = tileMapFromArray(tiles);
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

  // Only ever shows the LOCAL player's own focus — never anyone else's,
  // per the brief. The actual add/remove affordance is clicking tiles on
  // the map itself (render/mapScreen.ts); this is just a readout of the
  // current selection, since the map doesn't have room for a legend.
  const focusControls = root.querySelector('#focus-controls');
  if (focusControls) {
    const me = state.players[myPlayerId];
    const focusCount = me ? resolveFocusTiles(me, state.actions, state.turn).length : 0;
    focusControls.innerHTML = `<div class="focus-hint">Click tiles to set focus (${focusCount} selected)</div>`;
  }
}
