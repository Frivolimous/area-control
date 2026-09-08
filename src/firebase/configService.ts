import { doc, getDoc } from 'firebase/firestore';
import { firestore } from './firebase';
import { GameConfig } from '../types/game';

// TODO: point this at wherever configs actually live once the Firebase
// project is set up — this is a guess at a reasonable path.
const CONFIG_DOC_PATH = 'config/gameConfig';

export async function fetchGameConfig(): Promise<Partial<GameConfig>> {
  const snap = await getDoc(doc(firestore, CONFIG_DOC_PATH));
  if (!snap.exists()) return {};
  return snap.data() as Partial<GameConfig>;
}
