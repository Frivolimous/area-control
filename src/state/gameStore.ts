import { GameState } from '../types/game';

type Listener = (state: GameState) => void;

class GameStore {
  private state: GameState | null = null;
  private listeners: Set<Listener> = new Set();

  setState(state: GameState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }

  getState(): GameState | null {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const gameStore = new GameStore();
