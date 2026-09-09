export type PlayerId = string;
export type RoomId = string;

export enum GamePhase {
  Setup = 'setup',
  Active = 'active',
  Ended = 'ended',
}

/** Axial hex coordinate. */
export interface HexCoord {
  q: number;
  r: number;
}

export interface Tile {
  coord: HexCoord;
  /** Land vs disabled, per the brief's MapLandPercent generation. */
  active: boolean;
  /** Influence per player currently on this tile. */
  influence: Partial<Record<PlayerId, number>>;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  /** Null until the player picks a start location on the map, post-join. */
  startTile: HexCoord | null;
  /** Always includes startTile once chosen (rule: start location can never be unfocused). */
  focusTiles: HexCoord[];
  joinedAtTurn: number;
  isSpectator: boolean;
}

export interface GameConfig {
  mapWidth: number;
  mapHeight: number;
  mapLandPercent: number;
  turnDurationMs: number;
  maxInfluencePerTile: number;
  influenceEarnedBase: number;
  influenceEarnedPerTile: number;
  influenceDecayPerTurn: number;
  controlPercentTarget: number;
}

export interface GameState {
  roomId: RoomId;
  hostId: PlayerId;
  phase: GamePhase;
  config: GameConfig;
  /**
   * The one piece of true randomness in the whole game — generated once
   * at room creation and stored here. Every client generates the identical
   * map from this seed (see game/mapGenerator.ts) rather than syncing tile
   * data, and it also seeds the deterministic RNG used for turn resolution
   * (see game/rng.ts, game/turnEngine.ts). This is what resolves the
   * earlier map-scale concern — no tile array is ever stored or synced.
   */
  seed: number;
  turn: number;
  players: Record<PlayerId, Player>;
  createdAt: number;
}

/**
 * Defaults straight from the project brief. These are meant to be
 * overridden by whatever's stored in Firebase (see config/gameConfig.ts).
 */
export const DEFAULT_GAME_CONFIG: GameConfig = {
  mapWidth: 1024,
  mapHeight: 1024,
  mapLandPercent: 0.7,
  turnDurationMs: 1000,
  maxInfluencePerTile: 100,
  influenceEarnedBase: 10,
  influenceEarnedPerTile: 1,
  influenceDecayPerTurn: 5,
  controlPercentTarget: 0.5,
};
