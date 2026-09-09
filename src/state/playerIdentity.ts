const STORAGE_KEY = 'mass-battle:playerId';

/**
 * Returns a stable id for this browser, creating and persisting one on
 * first use. This is NOT authentication — anyone can clear localStorage
 * and get a new identity, or edit it to claim someone else's. Fine for a
 * happy-hour party game; revisit if that ever matters (Firebase Auth
 * anonymous sign-in would be the natural upgrade).
 */
export function getOrCreatePlayerId(): string {
  if (typeof localStorage === 'undefined') {
    return crypto.randomUUID();
  }
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
