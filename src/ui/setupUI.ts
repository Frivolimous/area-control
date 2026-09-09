import { Player } from '../types/game';

// TODO: wire start-game-btn to processTurn/mapGenerator kickoff and flip
// phase to Active via roomService.updateRoomState.

export function renderSetupScreen(root: HTMLElement, roomCode: string): void {
  root.innerHTML = `
    <div class="setup-card">
      <h2>Room: ${roomCode}</h2>
      <p class="setup-hint">Click a tile on the map to claim your starting location.</p>
      <div id="player-list"></div>
      <button id="start-game-btn">Start Game</button>
    </div>
  `;
}

export function renderPlayerList(root: HTMLElement, players: Player[]): void {
  const list = root.querySelector('#player-list');
  if (!list) return;
  list.innerHTML = players
    .map((p) => `<div class="player-row"><span style="color:${p.color}">●</span> ${p.name}</div>`)
    .join('');
}
