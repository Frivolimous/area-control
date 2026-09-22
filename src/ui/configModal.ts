import { GameConfig } from '../types/game';

export function renderConfigModal(root: HTMLElement): void {
  root.innerHTML = `
    <div class="modal-card">
      <h2>Edit Config (JSON)</h2>
      <textarea id="config-textarea" rows="20" spellcheck="false"></textarea>
      <div class="modal-actions">
        <button id="config-cancel-btn">Cancel</button>
        <button id="config-save-btn">Save</button>
      </div>
    </div>
  `;
}

export interface ConfigModalCallbacks {
  onSave: (newConfig: GameConfig) => void;
}

/**
 * Wires the modal's Cancel/Save buttons. Save does only the validation
 * JSON.parse gives for free (valid syntax) — no check that the parsed
 * object actually has GameConfig's shape (right fields, right types).
 * Deliberately rough for now, per how this was asked for; a config
 * missing fields or with wrong types is passed straight through to
 * updateRoomConfig and could produce NaN/crashes downstream.
 */
export function attachConfigModalHandlers(root: HTMLElement, callbacks: ConfigModalCallbacks): void {
  root.querySelector('#config-cancel-btn')?.addEventListener('click', () => {
    root.classList.add('hidden');
  });

  root.querySelector('#config-save-btn')?.addEventListener('click', () => {
    const textarea = root.querySelector<HTMLTextAreaElement>('#config-textarea');
    if (!textarea) return;

    let parsed: GameConfig;
    try {
      parsed = JSON.parse(textarea.value);
    } catch {
      alert('Invalid JSON — please fix and try again.');
      return;
    }

    callbacks.onSave(parsed);
    root.classList.add('hidden');
  });
}

/** Opens the modal, pre-filling the textarea with the room's current config. */
export function openConfigModal(root: HTMLElement, currentConfig: GameConfig): void {
  const textarea = root.querySelector<HTMLTextAreaElement>('#config-textarea');
  if (textarea) textarea.value = JSON.stringify(currentConfig, null, 2);
  root.classList.remove('hidden');
}
