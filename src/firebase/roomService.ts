import { doc, setDoc, getDoc, onSnapshot, updateDoc, runTransaction } from 'firebase/firestore';
import { firestore } from './firebase';
import { GameState, GamePhase, HexCoord, Player, PlayerId, RoomId } from '../types/game';
import { getGameConfig } from '../config/gameConfig';
import { hexEquals } from '../game/hexGrid';

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
    turn: 0,
    players: {},
    createdAt: Date.now(),
  };
  await setDoc(roomDocRef(roomId), initialState);
  return roomId;
}

export async function joinRoom(roomId: RoomId, player: Player): Promise<void> {
  const ref = roomDocRef(roomId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(`Room ${roomId} does not exist`);
  await updateDoc(ref, { [`players.${player.id}`]: player });
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
