import { GameConfig, DEFAULT_GAME_CONFIG } from '../types/game';
import { fetchGameConfig } from '../firebase/configService';

let cachedConfig: GameConfig | null = null;

/**
 * Returns the live game config, merging whatever's stored in Firebase over
 * the brief's defaults. Cached after first fetch for the session — call
 * clearGameConfigCache() if you need to pick up a config change mid-session.
 */
export async function getGameConfig(): Promise<GameConfig> {
  if (cachedConfig) return cachedConfig;
  const remote = await fetchGameConfig();
  cachedConfig = { ...DEFAULT_GAME_CONFIG, ...remote };
  return cachedConfig;
}

export function clearGameConfigCache(): void {
  cachedConfig = null;
}
