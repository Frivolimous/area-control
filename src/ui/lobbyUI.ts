import { PLAYER_COLOR_PALETTE } from '../utils/color';
import { GameState } from '../types/game';

/**
 * Renders the lobby's static shell: player panel top-left (name, color
 * picker, host-only new-map/edit-config buttons), room panel top-right
 * (room code, player list, host-only start button). Data-driven bits
 * (room code, player list, color taken/selected state, host visibility)
 * get filled in by updateLobbyScreen on every room update — this only
 * needs to run once.
 */
export function renderLobbyScreen(root: HTMLElement): void {
  root.innerHTML = `
    <div class="panel panel-top-left" id="player-panel">
      <input id="player-name-input" placeholder="Your name" maxlength="20" />
      <div id="color-picker"></div>
      <div id="host-map-controls" class="hidden">
        <button id="regenerate-map-btn">New Map</button>
        <button id="edit-config-btn">Edit Config</button>
      </div>
    </div>
    <div class="panel panel-top-right" id="room-panel">
      <h2 id="room-code-display"></h2>
      <p class="setup-hint">Click a tile on the map to claim your starting location.</p>
      <div id="player-list"></div>
      <button id="start-game-btn" class="hidden">Start Game</button>
    </div>
  `;

  const colorPicker = root.querySelector('#color-picker');
  if (colorPicker) {
    colorPicker.innerHTML = PLAYER_COLOR_PALETTE.map(
      (c) => `<button class="color-swatch" data-color="${c}" style="background:${c}"></button>`
    ).join('');
  }
}

export interface LobbyCallbacks {
  onNameChange: (name: string) => void;
  onColorSelect: (color: string) => void;
  onRegenerateMap: () => void;
  onEditConfig: () => void;
  onStartGame: () => void;
}

/** Wires the lobby screen's interactive behavior. Call once, right after renderLobbyScreen. */
export function attachLobbyHandlers(root: HTMLElement, callbacks: LobbyCallbacks): void {
  const nameInput = root.querySelector<HTMLInputElement>('#player-name-input');
  const commitName = () => {
    const name = nameInput?.value.trim();
    if (name) callbacks.onNameChange(name);
  };
  // Commits on blur/Enter rather than every keystroke — avoids a Firestore
  // write per character typed.
  nameInput?.addEventListener('blur', commitName);
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commitName();
      nameInput.blur();
    }
  });

  root.querySelector('#color-picker')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('color-swatch') || target.hasAttribute('disabled')) return;
    const color = target.dataset.color;
    if (color) callbacks.onColorSelect(color);
  });

  root.querySelector('#regenerate-map-btn')?.addEventListener('click', () => callbacks.onRegenerateMap());
  root.querySelector('#edit-config-btn')?.addEventListener('click', () => callbacks.onEditConfig());
  root.querySelector('#start-game-btn')?.addEventListener('click', () => callbacks.onStartGame());
}

/**
 * Re-renders the lobby's data-driven bits from the latest room state:
 * room code, player list, color-picker taken/selected state, the name
 * input's current value (skipped while the player has it focused, so we
 * don't clobber what they're mid-typing), and host-only controls'
 * visibility.
 */
export function updateLobbyScreen(
  root: HTMLElement,
  state: GameState,
  myPlayerId: string,
  isHost: boolean,
  roomCode: string
): void {
  const roomCodeDisplay = root.querySelector('#room-code-display');
  if (roomCodeDisplay) roomCodeDisplay.textContent = `Room: ${roomCode}`;

  const players = Object.values(state.players);
  const playerList = root.querySelector('#player-list');
  if (playerList) {
    playerList.innerHTML = players
      .map(
        (p) =>
          `<div class="player-row"><span style="color:${p.color}">●</span> ${p.name}${p.id === myPlayerId ? ' (you)' : ''}</div>`
      )
      .join('');
  }

  const me = state.players[myPlayerId];
  const nameInput = root.querySelector<HTMLInputElement>('#player-name-input');
  if (nameInput && me && document.activeElement !== nameInput) {
    nameInput.value = me.name;
  }

  const takenColors = new Set(players.filter((p) => p.id !== myPlayerId).map((p) => p.color));
  root.querySelectorAll<HTMLButtonElement>('.color-swatch').forEach((el) => {
    const color = el.dataset.color;
    const isTaken = color ? takenColors.has(color) : false;
    el.classList.toggle('taken', isTaken);
    el.classList.toggle('selected', color === me?.color);
    el.disabled = isTaken;
  });

  root.querySelector('#host-map-controls')?.classList.toggle('hidden', !isHost);
  root.querySelector('#start-game-btn')?.classList.toggle('hidden', !isHost);
}
