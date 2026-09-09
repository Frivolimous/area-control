import { PLAYER_COLOR_PALETTE } from '../utils/color';
import { createRoom, joinRoom } from '../firebase/roomService';
import { getOrCreatePlayerId } from '../state/playerIdentity';
import { Player } from '../types/game';

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
      (c, i) =>
        `<button class="color-swatch${i === 0 ? ' selected' : ''}" data-color="${c}" style="background:${c}"></button>`
    ).join('');
  }
}

export interface LobbyCallbacks {
  /** Fired once a room has been created or joined, so the caller can switch screens. */
  onRoomReady: (roomId: string, isHost: boolean) => void;
}

/**
 * Wires up the lobby screen's interactive behavior. Call once, right after
 * renderLobbyScreen, against the same root element.
 *
 * NOTE: Tile selection (choosing a start location) isn't wired up yet —
 * players join with startTile: null and pick it once the map/pixi layer
 * is hooked up (see render/inputHandler.ts).
 */
export function attachLobbyHandlers(root: HTMLElement, callbacks: LobbyCallbacks): void {
  let selectedColor = PLAYER_COLOR_PALETTE[0];

  const colorPicker = root.querySelector('#color-picker');
  colorPicker?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const color = target.dataset.color;
    if (!color) return;
    selectedColor = color;
    colorPicker.querySelectorAll('.color-swatch').forEach((el) => el.classList.remove('selected'));
    target.classList.add('selected');
  });

  const nameInput = root.querySelector<HTMLInputElement>('#player-name-input');
  const roomCodeInput = root.querySelector<HTMLInputElement>('#room-code-input');
  const createBtn = root.querySelector<HTMLButtonElement>('#create-room-btn');
  const joinBtn = root.querySelector<HTMLButtonElement>('#join-room-btn');

  function buildPlayer(): Player {
    return {
      id: getOrCreatePlayerId(),
      name: nameInput?.value.trim() || 'Player',
      color: selectedColor,
      startTile: null,
      focusTiles: [],
      joinedAtTurn: 0,
      isSpectator: false,
    };
  }

  createBtn?.addEventListener('click', async () => {
    createBtn.disabled = true;
    try {
      const player = buildPlayer();
      const roomId = await createRoom(player.id);
      await joinRoom(roomId, player);
      callbacks.onRoomReady(roomId, true);
    } catch (err) {
      console.error('Failed to create room', err);
      alert('Could not create room — see console for details.');
      createBtn.disabled = false;
    }
  });

  joinBtn?.addEventListener('click', async () => {
    const code = roomCodeInput?.value.trim().toUpperCase();
    if (!code) {
      alert('Enter a room code first.');
      return;
    }
    joinBtn.disabled = true;
    try {
      const player = buildPlayer();
      await joinRoom(code, player);
      callbacks.onRoomReady(code, false);
    } catch (err) {
      console.error('Failed to join room', err);
      alert('Could not join that room — check the code and try again.');
      joinBtn.disabled = false;
    }
  });
}
