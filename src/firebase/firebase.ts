import { initializeApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { firebaseConfig } from '../config/firebaseConfig';

export const app: FirebaseApp = initializeApp(firebaseConfig);

// Firestore chosen over Realtime Database: with the seed+action-log model
// (turns are replayed from a seed rather than syncing full tile state),
// write volume is low and sparse, so Firestore's structured queries fit
// better than RTDB's strengths around high-frequency writes.
//
// Talks directly to the real project (area-control-ff713) — no emulator.
// Be mindful during dev that reads/writes count against real quotas.
export const firestore: Firestore = getFirestore(app);
