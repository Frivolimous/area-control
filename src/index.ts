import './styles/main.css';
import { renderLobbyScreen, attachLobbyHandlers } from './ui/lobbyUI';
import { renderSetupScreen, renderPlayerList } from './ui/setupUI';
import { subscribeToRoom } from './firebase/roomService';
import { getOrCreatePlayerId } from './state/playerIdentity';
import { initMapScreen, updateMapScreen } from './render/mapScreen';
import { GameState } from './types/game';

// Entry point. Lobby -> setup room flow, and the pre-game map/tile-claim
// view, are wired to real Firestore now (see firebase/roomService.ts,
// render/mapScreen.ts). Still to come: actually starting the game
// (game/mapGenerator.ts + game/turnEngine.ts already support it — just
// needs the Start button wired up) and the in-game HUD (ui/hudUI.ts).

if (process.env.NODE_ENV !== 'production') {
  // Exposes window.debugHarness for testing map gen / turn logic from the
  // browser console without needing Firebase or the lobby UI wired up.
  import('./debug/debugHarness');
}

document.addEventListener('DOMContentLoaded', () => {
  const lobbyScreen = document.getElementById('lobby-screen');
  const setupScreen = document.getElementById('setup-screen');
  const canvasContainer = document.getElementById('canvas-container');
  if (!lobbyScreen || !setupScreen || !canvasContainer) return;

  renderLobbyScreen(lobbyScreen);
  attachLobbyHandlers(lobbyScreen, {
    onRoomReady: (roomId, isHost) => {
      const myPlayerId = getOrCreatePlayerId();

      lobbyScreen.classList.add('hidden');
      setupScreen.classList.remove('hidden');
      renderSetupScreen(setupScreen, roomId);

      const startBtn = setupScreen.querySelector<HTMLButtonElement>('#start-game-btn');
      if (startBtn) {
        // Only the host can start the game. Not wired to anything yet.
        startBtn.style.display = isHost ? '' : 'none';
      }

      let mapInitialized = false;
      subscribeToRoom(roomId, (state: GameState) => {
        renderPlayerList(setupScreen, Object.values(state.players));

        if (!mapInitialized) {
          // config + seed are fixed for the room's lifetime, so this only
          // needs to run once — every subsequent update just re-colors
          // tiles based on the current players' selections.
          initMapScreen(canvasContainer, roomId, myPlayerId, state.config, state.seed);
          mapInitialized = true;
        }
        updateMapScreen(Object.values(state.players));
      });
    },
  });
});


