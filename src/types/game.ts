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
  influenceEarnedExponent: number;
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

  // --- Map generation tuning (game/mapGenerator.ts, game/lakes.ts) ---
  // All hand-tuned by averaging results across many seeds at a couple of
  // map sizes, not derived from anything principled — see the comments at
  // each constant's original definition in mapGenerator.ts for the
  // reasoning and the empirical numbers behind each default.

  /**
   * Generation happens on a grid mapWidth/mapHeight * this factor, with
   * the land tile target still based on the UNPADDED mapWidth/mapHeight —
   * the padding exists purely to give mapEdgeMargin room to work without
   * competing with the land target for the same fixed area. Below ~1.2,
   * high mapLandPercent values can leave barely enough usable interior
   * after the margin for the shape to be anything but a near-maximal,
   * edge-forced fill.
   */
  mapPaddingFactor: number;
  /** Margin width as a fraction of the padded grid's smaller dimension — land is never placed within this distance of the true grid edge. */
  mapEdgeMarginFraction: number;
  /** Floor on margin width in tiles, regardless of mapEdgeMarginFraction — matters on small maps where the fraction alone would round to nothing. */
  mapEdgeMarginMin: number;

  /**
   * Voronoi region count = clamp(round(sqrt(paddedTotalTiles) / divisor), min, max).
   * Fewer/larger regions (higher divisor) look blockier and lose more
   * area to margin clipping (each region is too coarse to shape around
   * the margin precisely); more/smaller regions (lower divisor) start
   * looking noisy again, undoing the point of generating at region
   * granularity instead of per-hex.
   */
  mapRegionCountDivisor: number;
  mapRegionCountMin: number;
  mapRegionCountMax: number;

  /** Lake count = clamp(round(targetLandTiles / divisor), min, max). */
  mapLakeCountDivisor: number;
  mapLakeCountMin: number;
  mapLakeCountMax: number;
  /** Per-lake minimum size (tiles) = max(floor, round(targetLandTiles / divisor)). */
  mapLakeMinSizeDivisor: number;
  mapLakeMinSizeFloor: number;
  /** Per-lake maximum size (tiles) = max(floor, round(targetLandTiles / divisor)). */
  mapLakeMaxSizeDivisor: number;
  mapLakeMaxSizeFloor: number;
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
  influenceEarnedExponent: 1.0,
  influenceDecayPerTurn: 5,
  controlPercentTarget: 0.5,
  maxTurns: 500,

  mapPaddingFactor: 1.4,
  mapEdgeMarginFraction: 0.08,
  mapEdgeMarginMin: 2,

  mapRegionCountDivisor: 2.75,
  mapRegionCountMin: 10,
  mapRegionCountMax: 200,

  mapLakeCountDivisor: 2500,
  mapLakeCountMin: 1,
  mapLakeCountMax: 5,
  mapLakeMinSizeDivisor: 150,
  mapLakeMinSizeFloor: 20,
  mapLakeMaxSizeDivisor: 40,
  mapLakeMaxSizeFloor: 40,
};
