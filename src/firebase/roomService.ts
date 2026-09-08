import { doc, setDoc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { firestore } from './firebase';
import { GameState, GamePhase, Player, PlayerId, RoomId, DEFAULT_GAME_CONFIG } from '../types/game';

// NOTE: this whole file assumes Firestore-as-source-of-truth and writes the
// full `tiles` array into the room document. That's fine for small/medium
// maps, but will hit Firestore's 1MB document limit fast at the map sizes
// implied by DEFAULT_GAME_CONFIG (see types/game.ts). If that's the real
// target scale, tiles likely need to move to a subcollection (chunked by
// region) or to Realtime Database instead, with only per-turn deltas
// written rather than the whole tile array.

function roomDocRef(roomId: RoomId) {
  return doc(firestore, 'rooms', roomId);
}

function generateRoomCode(): string {
  // TODO: swap for a friendlier word-based code generator if desired.
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

export async function createRoom(hostId: PlayerId): Promise<RoomId> {
  const roomId = generateRoomCode();
  const initialState: GameState = {
    roomId,
    hostId,
    phase: GamePhase.Setup,
    config: DEFAULT_GAME_CONFIG,
    turn: 0,
    players: {},
    tiles: [], // generated when the host starts the game
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

export function subscribeToRoom(
  roomId: RoomId,
  onUpdate: (state: GameState) => void
): () => void {
  return onSnapshot(roomDocRef(roomId), (snap) => {
    if (snap.exists()) onUpdate(snap.data() as GameState);
  });
}

export async function updateRoomState(
  roomId: RoomId,
  partial: Partial<GameState>
): Promise<void> {
  await updateDoc(roomDocRef(roomId), partial as Record<string, unknown>);
}
