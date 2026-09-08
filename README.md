# Mass Battle

Hex-grid, turn-based, multiplayer influence game. TypeScript + webpack + Pixi.js for rendering, Firebase for backend/sync.

## Setup

```
npm install
npm start      # webpack-dev-server
npm run build  # production build to dist/
```

Fill in `src/config/firebaseConfig.ts` with your Firebase project's credentials before running.

## Project structure

```
src/
  index.html          entry HTML (injected by html-webpack-plugin)
  index.ts             entry point
  styles/main.css       base layout
  config/               firebase project config + game config loader
  types/game.ts          core types (GameState, Player, Tile, GameConfig)
  firebase/              room lifecycle + config fetching
  game/                  pure game logic: hex math, map gen, influence, turns
  render/                Pixi setup, hex tile rendering, input handling
  ui/                    DOM overlay screens (lobby, setup, HUD)
  state/gameStore.ts     simple pub/sub for the synced GameState
  utils/color.ts          color blending + player palette
```

## Open questions / assumptions to revisit

These came up while scaffolding and affect real implementation, not just file layout:

1. **Map scale.** `mapWidth`/`mapHeight` = 1024 each in the brief implies 1,048,576 tiles if literal. That's too big for a single Firestore document (1MB limit) and likely too much data to push every `turnDurationMs` tick. `mapGenerator.ts` and `roomService.ts` both flag this — worth confirming whether those numbers are tile counts, pixel dimensions, or something else before building the real map algorithm and finalizing the Firebase data model.

2. **Where turns are computed.** The brief says turns auto-advance on a timer. `game/turnEngine.ts` is written as pure functions so it can run either in a Cloud Function on a schedule, or in a client-designated "host" that ticks locally and writes results. Not yet decided which.

3. **Firestore vs Realtime Database.** Both are initialized in `firebase/firebase.ts`. Firestore fits room/lobby metadata; RTDB is usually better for high-frequency tile updates. Should converge on one as the source of truth for live game state.

4. **Map generation algorithm.** Currently a random placeholder — does not guarantee a single connected landmass or hit `mapLandPercent` accurately. Needs a real algorithm (flood-fill growth, cellular automata + connectivity pass, etc.).

5. **Influence spread heuristics.** The "spend evenly along the line toward a focus" and "spread randomly around a topped-up focus" behaviors in `game/influence.ts` are first-pass interpretations of the brief's rules 3–6 — probably need tuning once there's something playable.

6. **Not yet scaffolded:** auth/player identity (brief doesn't specify sign-in vs anonymous), mid-game spectate/join-late progress boost (marked optional in the brief), and the input handler for actually clicking tiles.
