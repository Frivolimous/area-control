import { doc, setDoc, getDoc, onSnapshot, updateDoc, runTransaction, arrayUnion } from 'firebase/firestore';
import { firestore } from './firebase';
import { FocusChangedAction, GameConfig, GameState, GamePhase, HexCoord, Player, PlayerId, RoomId } from '../types/game';
import { getGameConfig } from '../config/gameConfig';
import { hexEquals } from '../game/hexGrid';
import { PLAYER_COLOR_PALETTE } from '../utils/color';

// Room documents no longer carry a `tiles` array — the map is generated
// deterministically on each client from `seed` (see types/game.ts,
// game/mapGenerator.ts), so there's nothing map-shaped to sync at all.
// This is what resolves the original map-scale-vs-Firestore-doc-size
// concern flagged early on.

function roomDocRef(roomId: RoomId) {
  return doc(firestore, 'rooms', roomId);
}

function generateRoomCode(): string {
  // TODO: swap for a friendlier word-based code generator if desired.
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

export async function createRoom(hostId: PlayerId): Promise<RoomId> {
  const roomId = generateRoomCode();
  const config = await getGameConfig();
  // The one place true randomness enters the system — everything
  // downstream (map shape, turn resolution) is deterministic from this
  // single seed, stored once and read by every client. Not part of the
  // "remove all Math.random()" rule, since there's nothing to keep in
  // sync here: it's generated once, by whoever creates the room.
  const seed = Math.floor(Math.random() * 0xffffffff);

  const initialState: GameState = {
    roomId,
    hostId,
    phase: GamePhase.Setup,
    config,
    seed,
    gameStartTimestamp: null,
    turn: 0,
    players: {},
    actions: [],
    createdAt: Date.now(),
  };
  await setDoc(roomDocRef(roomId), initialState);
  return roomId;
}

/**
 * Joins a room, auto-assigning the first color in PLAYER_COLOR_PALETTE not
 * already taken by another player — done inside the same transaction as
 * the join itself so two players joining at nearly the same moment can't
 * both land on the same color. (Falls back to a possibly-non-unique color
 * once the whole palette is exhausted — a known limitation for a room
 * with more players than the palette has colors, not handled beyond this
 * fallback.) Start tile and focus stay unset — chosen afterward on the
 * map itself. Name/color can both be changed later (updatePlayerName,
 * selectColor).
 */
export async function joinRoom(roomId: RoomId, playerId: PlayerId, name: string): Promise<void> {
  const ref = roomDocRef(roomId);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Room ${roomId} does not exist`);
    const state = snap.data() as GameState;

    const usedColors = new Set(Object.values(state.players).map((p) => p.color));
    const color =
      PLAYER_COLOR_PALETTE.find((c) => !usedColors.has(c)) ??
      PLAYER_COLOR_PALETTE[Object.keys(state.players).length % PLAYER_COLOR_PALETTE.length];

    const player: Player = {
      id: playerId,
      name,
      color,
      startTile: null,
      focusTiles: [],
      joinedAtTurn: 0,
      isSpectator: false,
    };
    tx.update(ref, { [`players.${playerId}`]: player });
  });
}

/** Renames a player. No uniqueness constraint (unlike color) — the brief doesn't ask for unique names. */
export async function updatePlayerName(roomId: RoomId, playerId: PlayerId, name: string): Promise<void> {
  await updateDoc(roomDocRef(roomId), { [`players.${playerId}.name`]: name });
}

/**
 * Changes a player's color, atomically checking no one else already has
 * it — same transaction pattern as selectStartTile, for the same reason
 * (two players can't both land on the same color even if they click at
 * nearly the same moment).
 */
export async function selectColor(roomId: RoomId, playerId: PlayerId, color: string): Promise<void> {
  const ref = roomDocRef(roomId);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Room ${roomId} does not exist`);
    const state = snap.data() as GameState;

    const taken = Object.values(state.players).some((p) => p.id !== playerId && p.color === color);
    if (taken) throw new Error('That color is already taken by another player.');

    tx.update(ref, { [`players.${playerId}.color`]: color });
  });
}

/**
 * Host-only (gated client-side only, same as startGame — no server-side
 * enforcement exists yet for any host-only action in this app). Picks a
 * fresh random seed and clears every player's start tile/focus, since
 * their old picks are coordinates on a map that no longer exists. Known
 * gap: a player mid-click on the old map in the instant before their
 * client receives this update could have selectStartTile accept a
 * coordinate that isn't valid land on the new map — selectStartTile only
 * checks "is this tile currently taken," not "is this tile currently
 * active on the current map." Narrow window, not handled.
 */
export async function regenerateMap(roomId: RoomId): Promise<void> {
  const ref = roomDocRef(roomId);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Room ${roomId} does not exist`);
    const state = snap.data() as GameState;

    const newSeed = Math.floor(Math.random() * 0xffffffff);
    const clearedPlayers: Record<string, Player> = {};
    for (const [id, p] of Object.entries(state.players)) {
      clearedPlayers[id] = { ...p, startTile: null, focusTiles: [] };
    }
    tx.update(ref, { seed: newSeed, players: clearedPlayers });
  });
}

/**
 * Host-only. Overwrites the room's config wholesale and clears every
 * player's start tile/focus, same reasoning as regenerateMap — config
 * fields like mapWidth/mapLandPercent change what generateMap produces
 * even with the same seed, so old picks may no longer be valid
 * coordinates. Keeps the existing seed (only regenerateMap's "New Map"
 * picks a fresh one) — editing config reshapes the map deterministically
 * from the same seed rather than also re-rolling it.
 *
 * No validation beyond what JSON.parse already guarantees (the caller —
 * ui/configModal.ts — parses the textarea before this is called): a
 * config with missing fields, wrong types, or nonsensical values (e.g.
 * negative mapWidth) is accepted as-is and could produce NaN/crashes
 * downstream. Deliberately rough for now, per how this was asked for.
 */
export async function updateRoomConfig(roomId: RoomId, newConfig: GameConfig): Promise<void> {
  const ref = roomDocRef(roomId);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Room ${roomId} does not exist`);
    const state = snap.data() as GameState;

    const clearedPlayers: Record<string, Player> = {};
    for (const [id, p] of Object.entries(state.players)) {
      clearedPlayers[id] = { ...p, startTile: null, focusTiles: [] };
    }
    tx.update(ref, { config: newConfig, players: clearedPlayers });
  });
}

/**
 * Transitions a room from Setup to Active and stamps the shared turn-timing
 * anchor. Every client (not just the host) computes its own turn progress
 * from this single timestamp — see the comment on GameState.gameStartTimestamp.
 *
 * Throws if any joined player hasn't picked a start tile yet, since a
 * player with no startTile never earns/spreads influence (see
 * game/influence.ts spreadInfluence's early return) — better to catch that
 * before the game silently starts with a dead player in it.
 */
export async function startGame(roomId: RoomId): Promise<void> {
  const ref = roomDocRef(roomId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(`Room ${roomId} does not exist`);
  const state = snap.data() as GameState;

  const notReady = Object.values(state.players).filter((p) => !p.isSpectator && !p.startTile);
  if (notReady.length > 0) {
    throw new Error(
      `Everyone needs a start tile before starting: ${notReady.map((p) => p.name).join(', ')} haven't picked one yet.`
    );
  }

  await updateDoc(ref, {
    phase: GamePhase.Active,
    gameStartTimestamp: Date.now(),
  });
}

/**
 * Claims a start tile for a player, atomically. Uses a transaction rather
 * than a plain read-then-write so two players clicking the same tile at
 * the same moment can't both succeed — the second one to commit sees the
 * first's write inside the transaction and is rejected.
 */
export async function selectStartTile(
  roomId: RoomId,
  playerId: PlayerId,
  coord: HexCoord
): Promise<void> {
  const ref = roomDocRef(roomId);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Room ${roomId} does not exist`);
    const state = snap.data() as GameState;

    const taken = Object.values(state.players).some(
      (p) => p.id !== playerId && p.startTile && hexEquals(p.startTile, coord)
    );
    if (taken) throw new Error('That tile is already taken by another player.');

    tx.update(ref, {
      [`players.${playerId}.startTile`]: coord,
      [`players.${playerId}.focusTiles`]: [coord],
    });
  });
}

/**
 * Records a focus-tile change during Active play. Just an append via
 * arrayUnion, not a transaction — unlike selectStartTile there's no
 * exclusivity to protect (multiple players' focus tiles can freely
 * overlap, including on tiles the brief's rule 3 says aren't even
 * controlled by them), so two players changing focus at the same moment
 * don't conflict with each other. See types/game.ts FocusChangedAction
 * for why effectiveTurn matters here.
 */
export async function changeFocus(
  roomId: RoomId,
  playerId: PlayerId,
  focusTiles: HexCoord[],
  effectiveTurn: number
): Promise<void> {
  const action: FocusChangedAction = {
    playerId,
    focusTiles,
    effectiveTurn,
    createdAt: Date.now(),
  };
  await updateDoc(roomDocRef(roomId), {
    actions: arrayUnion(action),
  });
}

export function subscribeToRoom(
  roomId: RoomId,
  onUpdate: (state: GameState) => void
): () => void {
  return onSnapshot(roomDocRef(roomId), (snap: { exists: () => boolean; data: () => unknown }) => {
    if (snap.exists()) onUpdate(snap.data() as GameState);
  });
}

export async function updateRoomState(
  roomId: RoomId,
  partial: Partial<GameState>
): Promise<void> {
  await updateDoc(roomDocRef(roomId), partial as Record<string, unknown>);
}
