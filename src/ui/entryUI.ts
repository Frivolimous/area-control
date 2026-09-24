export interface EntryCallbacks {
  onHost: () => Promise<void>;
  onJoin: (code: string) => Promise<void>;
}

export function renderEntryScreen(root: HTMLElement): void {
  root.innerHTML = `
    <div class="entry-card">
      <h1>Area Control</h1>
      <p class="entry-subtitle">Multiplayer Online Live Action Turn Based Strategy Game</p>
      <div class="entry-actions">
        <button id="host-btn">Host</button>
        <button id="join-btn">Join</button>
      </div>
      <div id="join-row" class="join-row hidden">
        <input id="room-code-input" placeholder="Room code" maxlength="6" />
        <button id="join-confirm-btn">Go</button>
      </div>
      <div class="entry-instructions">
        <h2>How to Play</h2>
        <p>1. Select a single starting tile on the map to begin.</p>
        <p>2. Control tiles on the map to earn influence. The more tiles you control, the more influence you earn.</p>
        <p>3. Click tiles to set your focus. Your influence will be evenly distributed between each focussed tile.</p>
        <p>4. The game ends when a player controls most of the map, or when the maximum number of turns is reached.</p>
        <br><p>Good luck!</p>
      </div>
    </div>
    <div class="entry-footer">
      <p>Created by Jeremy Moshe for Bring it On! Happy Hour Games, 24/09/2026</p>
    </div>
  `;
}

/**
 * Wires the entry screen. Both callbacks are awaited so this can reset
 * button disabled-state on failure — the callbacks themselves (in
 * index.ts) handle alerting the user and rethrow so that reset actually
 * fires.
 */
export function attachEntryHandlers(root: HTMLElement, callbacks: EntryCallbacks): void {
  const hostBtn = root.querySelector<HTMLButtonElement>('#host-btn');
  const joinBtn = root.querySelector<HTMLButtonElement>('#join-btn');
  const joinRow = root.querySelector<HTMLElement>('#join-row');
  const roomCodeInput = root.querySelector<HTMLInputElement>('#room-code-input');
  const joinConfirmBtn = root.querySelector<HTMLButtonElement>('#join-confirm-btn');

  hostBtn?.addEventListener('click', async () => {
    hostBtn.disabled = true;
    try {
      await callbacks.onHost();
    } catch {
      hostBtn.disabled = false;
    }
  });

  joinBtn?.addEventListener('click', () => {
    joinRow?.classList.remove('hidden');
    roomCodeInput?.focus();
  });

  const submitJoin = async () => {
    const code = roomCodeInput?.value.trim().toUpperCase();
    if (!code) {
      alert('Enter a room code first.');
      return;
    }
    if (joinConfirmBtn) joinConfirmBtn.disabled = true;
    try {
      await callbacks.onJoin(code);
    } catch {
      if (joinConfirmBtn) joinConfirmBtn.disabled = false;
    }
  };

  joinConfirmBtn?.addEventListener('click', submitJoin);
  roomCodeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitJoin();
  });
}
