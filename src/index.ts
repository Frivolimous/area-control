import './styles/main.css';
import { renderEntryScreen, attachEntryHandlers } from './ui/entryUI';
import { renderLobbyScreen, attachLobbyHandlers, updateLobbyScreen } from './ui/lobbyUI';
import { renderConfigModal, attachConfigModalHandlers, openConfigModal } from './ui/configModal';
import { renderHud } from './ui/hudUI';
import {
  createRoom,
  joinRoom,
  subscribeToRoom,
  startGame,
  selectColor,
  updatePlayerName,
  regenerateMap,
  updateRoomConfig,
} from './firebase/roomService';
import { getOrCreatePlayerId } from './state/playerIdentity';
import { initMapScreen, updateMapScreen, startGameLoop, applyRoomActions, regenerateMapScreen } from './render/mapScreen';
import { GamePhase, GameState } from './types/game';

// Entry point. Entry screen (Host/Join) -> lobby (name/color/map-select,
// host-only new-map/config-edit/start) -> active game, all wired to real
// Firestore. See firebase/roomService.ts, render/mapScreen.ts, and the
// ui/ modules for each screen.

if (process.env.NODE_ENV !== 'production') {
  // Exposes window.debugHarness for testing map gen / turn logic from the
  // browser console without needing Firebase or the lobby UI wired up.
  import('./debug/debugHarness');
}

document.addEventListener('DOMContentLoaded', () => {
  const entryScreenEl = document.getElementById('entry-screen');
  const lobbyScreenEl = document.getElementById('lobby-screen');
  const configModalEl = document.getElementById('config-modal');
  const canvasContainerEl = document.getElementById('canvas-container');
  const hudEl = document.getElementById('hud');
  if (!entryScreenEl || !lobbyScreenEl || !configModalEl || !canvasContainerEl || !hudEl) return;

  // Re-bound to explicitly non-null types: TS's control-flow narrowing
  // above doesn't carry into enterRoom below, since it's a separate named
  // function declaration rather than code inline in this same block.
  const entryScreen: HTMLElement = entryScreenEl;
  const lobbyScreen: HTMLElement = lobbyScreenEl;
  const configModal: HTMLElement = configModalEl;
  const canvasContainer: HTMLElement = canvasContainerEl;
  const hud: HTMLElement = hudEl;

  renderEntryScreen(entryScreen);
  renderLobbyScreen(lobbyScreen);
  renderConfigModal(configModal);

  const myPlayerId = getOrCreatePlayerId();
  let latestState: GameState | null = null;
  let roomId: string | null = null;

  attachConfigModalHandlers(configModal, {
    onSave: (newConfig) => {
      if (!roomId) return;
      updateRoomConfig(roomId, newConfig).catch((err) => {
        console.error('Failed to update config', err);
        alert('Could not save config — check the console (likely an invalid shape).');
      });
    },
  });

  attachLobbyHandlers(lobbyScreen, {
    onNameChange: (name) => {
      if (roomId) {
        updatePlayerName(roomId, myPlayerId, name).catch((err) => console.error('Failed to update name', err));
      }
    },
    onColorSelect: (color) => {
      if (!roomId) return;
      selectColor(roomId, myPlayerId, color).catch((err) => {
        console.error('Failed to select color', err);
        alert(err instanceof Error ? err.message : 'Could not select that color.');
      });
    },
    onRegenerateMap: () => {
      if (roomId) {
        regenerateMap(roomId).catch((err) => console.error('Failed to regenerate map', err));
      }
    },
    onEditConfig: () => {
      if (latestState) openConfigModal(configModal, latestState.config);
    },
    onStartGame: () => {
      if (!roomId) return;
      startGame(roomId).catch((err) => {
        console.error('Failed to start game', err);
        alert(err instanceof Error ? err.message : 'Could not start the game.');
      });
    },
  });

  function enterRoom(id: string): void {
    roomId = id;
    entryScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');

    let mapInitialized = false;
    // Tracks seed + config together — a config-only edit (mapWidth,
    // mapLandPercent, etc.) changes what generateMap produces even with
    // the same seed, so seed alone isn't enough to detect "the map needs
    // regenerating."
    let lastMapSignature: string | null = null;
    let gameLoopStarted = false;

    subscribeToRoom(id, (state: GameState) => {
      latestState = state;

      if (state.phase === GamePhase.Active) {
        if (!mapInitialized) {
          // Covers a client that lands here after the game already
          // started (e.g. a page reload) — it still needs the map
          // generated once before the loop can render anything.
          initMapScreen(canvasContainer, id, myPlayerId, state.config, state.seed);
          mapInitialized = true;
        }
        if (!gameLoopStarted) {
          lobbyScreen.classList.add('hidden');
          hud.classList.remove('hidden');
          gameLoopStarted = true;
          startGameLoop(state, {
            onTick: (tickState, tiles) => renderHud(hud, tickState, tiles, myPlayerId),
            onVictory: (winner) => alert(`${winner.name} wins!`),
          });
        } else {
          // The game loop owns localState.turn/tiles from here — this
          // only needs to hand over freshly-arrived focus-change actions
          // from other players, not the whole snapshot.
          applyRoomActions(state.actions);
        }
        return;
      }

      // Setup phase.
      const isHost = state.hostId === myPlayerId;
      updateLobbyScreen(lobbyScreen, state, myPlayerId, isHost, id);

      const signature = `${state.seed}|${JSON.stringify(state.config)}`;
      if (!mapInitialized) {
        initMapScreen(canvasContainer, id, myPlayerId, state.config, state.seed);
        mapInitialized = true;
        lastMapSignature = signature;
      } else if (signature !== lastMapSignature) {
        // Host hit "New Map" or saved an edited config — regenerate
        // locally rather than re-running the one-time pixi bootstrap.
        regenerateMapScreen(state.config, state.seed);
        lastMapSignature = signature;
      }
      updateMapScreen(Object.values(state.players));
    });
  }

  attachEntryHandlers(entryScreen, {
    onHost: async () => {
      try {
        const id = await createRoom(myPlayerId);
        await joinRoom(id, myPlayerId, 'Player');
        enterRoom(id);
      } catch (err) {
        console.error('Failed to create room', err);
        alert('Could not create room — see console for details.');
        throw err;
      }
    },
    onJoin: async (code) => {
      try {
        await joinRoom(code, myPlayerId, 'Player');
        enterRoom(code);
      } catch (err) {
        console.error('Failed to join room', err);
        alert('Could not join that room — check the code and try again.');
        throw err;
      }
    },
  });
});
