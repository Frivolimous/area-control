import './styles/main.css';
import { renderLobbyScreen } from './ui/lobbyUI';

// Entry point. For now this just boots the lobby screen — wiring up
// room creation/joining (firebase/roomService.ts), pixi init
// (render/pixiApp.ts), and the turn loop (game/turnEngine.ts) is next.

document.addEventListener('DOMContentLoaded', () => {
  const lobbyScreen = document.getElementById('lobby-screen');
  if (lobbyScreen) {
    renderLobbyScreen(lobbyScreen);
  }
});
