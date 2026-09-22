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
