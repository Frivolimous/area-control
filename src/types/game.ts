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
  startTile: HexCoord;
  /** Always includes startTile (rule: start location can never be unfocused). */
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
  turn: number;
  players: Record<PlayerId, Player>;
  tiles: Tile[];
  createdAt: number;
}

/**
 * Defaults straight from the project brief. These are meant to be
 * overridden by whatever's stored in Firebase (see config/gameConfig.ts).
 *
 * OPEN QUESTION: mapWidth/mapHeight = 1024 each implies 1,048,576 tiles if
 * these are literal tile-grid dimensions. That's too large for a single
 * Firestore document and probably too large to push over the wire every
 * TurnDurationMS tick. Confirm intent before mapGenerator.ts is treated as
 * more than a placeholder — see the note in that file.
 */
export const DEFAULT_GAME_CONFIG: GameConfig = {
  mapWidth: 100,
  mapHeight: 100,
  mapLandPercent: 0.7,
  turnDurationMs: 1000,
  maxInfluencePerTile: 100,
  influenceEarnedBase: 10,
  influenceEarnedPerTile: 1,
  influenceDecayPerTurn: 5,
  controlPercentTarget: 0.5,
};
