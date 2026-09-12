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
  /**
   * Initial focus set at game start (always just [startTile] currently,
   * set by selectStartTile). This is NOT updated during Active play —
   * live focus changes go through the actions log instead (see
   * FocusChangedAction, GameState.actions, game/actions.ts
   * resolveFocusTiles). Only used as the fallback when no action exists
   * for a player yet.
   */
  focusTiles: HexCoord[];
  joinedAtTurn: number;
  isSpectator: boolean;
}

/**
 * A player changing their focus tiles during Active play. Append-only —
 * never edited or removed, so every client can deterministically resolve
 * "what was this player's focus as of turn N" by finding the latest
 * action with effectiveTurn <= N (see game/actions.ts resolveFocusTiles).
 *
 * effectiveTurn is always the turn the action was submitted on, plus one
 * — never the current turn itself — so it doesn't matter whether a
 * client's Firestore listener delivers this before or after it locally
 * crosses that turn boundary; every client applies it starting from the
 * same turn regardless of network timing. See render/mapScreen.ts's
 * BUFFER_MS for the other half of this: a small delay between a turn's
 * wall-clock boundary and a client actually computing it, giving
 * Firestore's listener time to deliver same-turn actions first.
 *
 * Stored as an array field on the room doc (not a subcollection) since
 * focus changes are rare, player-initiated events — not a per-tick
 * write — so this doesn't reintroduce the write-volume problem the
 * seed-based architecture was built to avoid. Wouldn't scale to a
 * very-long-running game or very frequent changes; fine for a
 * happy-hour session.
 */
export interface FocusChangedAction {
  playerId: PlayerId;
  /** Full replacement focus set, not a delta — always includes startTile. */
  focusTiles: HexCoord[];
  effectiveTurn: number;
  /** Client's own clock; only used to tie-break same-effectiveTurn actions from the same player. */
  createdAt: number;
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
  /**
   * Safety net, not in the brief: force-ends the game and ranks by tiles
   * controlled if nobody hits controlPercentTarget by this turn. Added
   * after simulation showed the current rules can reach a genuine
   * stalemate — contested border tiles where income and decay reach
   * equilibrium, so nobody ever crosses the threshold. See
   * game/turnEngine.ts checkVictory.
   */
  maxTurns: number;
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
  /**
   * Set once, when the host clicks Start (see firebase/roomService.ts
   * startGame). Every client computes its own current turn as
   * floor((Date.now() - gameStartTimestamp) / config.turnDurationMs) and
   * replays turns locally from this anchor — no per-tick sync needed.
   * Null until the game actually starts.
   */
  gameStartTimestamp: number | null;
  turn: number;
  players: Record<PlayerId, Player>;
  /** Append-only log of focus changes during Active play. See FocusChangedAction. */
  actions: FocusChangedAction[];
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
  maxTurns: 500,
};
