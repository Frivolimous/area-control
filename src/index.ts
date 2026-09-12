import './styles/main.css';
import { renderLobbyScreen, attachLobbyHandlers } from './ui/lobbyUI';
import { renderSetupScreen, renderPlayerList } from './ui/setupUI';
import { renderHud } from './ui/hudUI';
import { subscribeToRoom, startGame } from './firebase/roomService';
import { getOrCreatePlayerId } from './state/playerIdentity';
import { initMapScreen, updateMapScreen, startGameLoop, applyRoomActions } from './render/mapScreen';
import { GamePhase, GameState } from './types/game';

// Entry point. Lobby -> setup -> active game flow is wired to real
// Firestore now (see firebase/roomService.ts, render/mapScreen.ts),
// including live focus-tile selection during Active play (click a tile
// to toggle it in/out of your focus set). Still to come: spectating and
// mid-game join.

if (process.env.NODE_ENV !== 'production') {
  // Exposes window.debugHarness for testing map gen / turn logic from the
  // browser console without needing Firebase or the lobby UI wired up.
  import('./debug/debugHarness');
}

document.addEventListener('DOMContentLoaded', () => {
  const lobbyScreen = document.getElementById('lobby-screen');
  const setupScreen = document.getElementById('setup-screen');
  const canvasContainer = document.getElementById('canvas-container');
  const hud = document.getElementById('hud');
  if (!lobbyScreen || !setupScreen || !canvasContainer || !hud) return;

  renderLobbyScreen(lobbyScreen);
  attachLobbyHandlers(lobbyScreen, {
    onRoomReady: (roomId, isHost) => {
      const myPlayerId = getOrCreatePlayerId();

      lobbyScreen.classList.add('hidden');
      setupScreen.classList.remove('hidden');
      renderSetupScreen(setupScreen, roomId);

      const startBtn = setupScreen.querySelector<HTMLButtonElement>('#start-game-btn');
      if (startBtn) {
        startBtn.style.display = isHost ? '' : 'none';
        startBtn.addEventListener('click', () => {
          startBtn.disabled = true;
          startGame(roomId).catch((err) => {
            console.error('Failed to start game', err);
            alert(err instanceof Error ? err.message : 'Could not start the game.');
            startBtn.disabled = false;
          });
          // No re-enable on success — subscribeToRoom's phase branch below
          // takes over once Firestore confirms the phase flip.
        });
      }

      let mapInitialized = false;
      let gameLoopStarted = false;

      subscribeToRoom(roomId, (state: GameState) => {
        if (state.phase === GamePhase.Active) {
          if (!mapInitialized) {
            // Covers a client that lands here after the game already
            // started (e.g. a page reload) — it still needs the map
            // generated once before the loop can render anything.
            initMapScreen(canvasContainer, roomId, myPlayerId, state.config, state.seed);
            mapInitialized = true;
          }
          if (!gameLoopStarted) {
            setupScreen.classList.add('hidden');
            hud.classList.remove('hidden');
            gameLoopStarted = true;
            startGameLoop(state, {
              onTick: (tickState, tiles) => renderHud(hud, tickState, tiles, myPlayerId),
              onVictory: (winner) => alert(`${winner.name} wins!`),
            });
          } else {
            // The game loop owns localState.turn/tiles from here — this
            // only needs to hand over freshly-arrived focus-change
            // actions from other players, not the whole snapshot.
            applyRoomActions(state.actions);
          }
          return;
        }

        // Setup phase.
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


