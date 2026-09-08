import { PLAYER_COLOR_PALETTE } from '../utils/color';

// TODO: wire button handlers to firebase/roomService.ts (createRoom / joinRoom).

export function renderLobbyScreen(root: HTMLElement): void {
  root.innerHTML = `
    <div class="lobby-card">
      <h1>Mass Battle</h1>
      <input id="player-name-input" placeholder="Your name" maxlength="20" />
      <div id="color-picker"></div>
      <div class="lobby-actions">
        <button id="create-room-btn">Create Room</button>
        <div class="join-row">
          <input id="room-code-input" placeholder="Room code" maxlength="6" />
          <button id="join-room-btn">Join</button>
        </div>
      </div>
    </div>
  `;

  const colorPicker = root.querySelector('#color-picker');
  if (colorPicker) {
    colorPicker.innerHTML = PLAYER_COLOR_PALETTE.map(
      (c) => `<button class="color-swatch" data-color="${c}" style="background:${c}"></button>`
    ).join('');
  }
}
