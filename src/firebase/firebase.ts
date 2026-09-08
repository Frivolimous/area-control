import { initializeApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getDatabase, Database } from 'firebase/database';
import { firebaseConfig } from '../config/firebaseConfig';

export const app: FirebaseApp = initializeApp(firebaseConfig);

// Both are wired up since it's not yet decided which fits better:
// - Firestore: good fit for room/lobby metadata, one-off config docs.
// - Realtime Database: usually the better fit for frequent turn-tick
//   writes (every TurnDurationMS), especially at larger player/tile counts.
//
// Pick one as the source of truth for live game state once map scale
// (see types/game.ts) is settled, and drop the other import.
export const firestore: Firestore = getFirestore(app);
export const rtdb: Database = getDatabase(app);
