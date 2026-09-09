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
  types/global.d.ts      ambient module declarations (CSS imports)
  firebase/              room lifecycle (create/join/select tile) + config fetching
  game/                  pure game logic: hex math, seeded rng, map gen, influence, turns
  render/                Pixi setup, hex tile rendering, click input, map screen orchestration
  ui/                    DOM overlay screens (lobby, setup, HUD)
  state/                 player identity (localStorage) + pub/sub GameState store
  utils/color.ts          color blending + player palette
  debug/debugHarness.ts  dev-only console harness for map gen / turn engine, no Firebase needed
```

## Open questions / known issues

1. **Map generation looks ugly.** Connectivity and `mapLandPercent` are both correct (flood-fill from a seeded point guarantees a single connected landmass), but uniform-random frontier selection grows thin tendrils outward rather than filling in a compact shape, so coastlines end up spiky/splotchy. See the ideas listed in `mapGenerator.ts`'s docstring (weighted frontier selection, noise-based generation, or a smoothing pass) — flagged for later, not urgent.

2. **Contested borders can stalemate.** Verified via simulation (not hypothetical): once two players' territories meet and neither has open neutral land left to expand into, contested border tiles can reach a stable equilibrium where `influenceEarnedPerTile`-driven income and `influenceDecayPerTurn` cancel out turn after turn, and nobody ever crosses `controlPercentTarget`. Reproduced on 3 of 20 seed/player-count combinations tested, mostly at low player counts. `maxTurns` (see below) guarantees the game still ends, but doesn't address *why* it stalemates. Possible directions: bias frontier-spending toward genuinely neutral tiles before contested ones, tune the earn/decay ratio, or try the overflow/diffusion mechanic below.

3. **Overflow/diffusion — alternative to the current "spend on frontier" mechanic.** Instead of capping influence at `maxInfluencePerTile` and spending leftover on random frontier tiles, tiles could accumulate above the cap and "overflow" downhill to neighbors with less influence — closer to a diffusion/erosion simulation, likely producing more organic, wave-like expansion. Not implemented: it's a bigger structural change (redefines what "max" means, needs careful deterministic ordering for cascading overflow across a whole map in one turn) and might independently help or hurt the stalemate issue above. Worth an experiment once the current mechanic has been playtested.

4. **Where turns are computed — diverges from the earlier "host computes" decision.** What's actually built: every client computes turns locally and identically, anchored to a single shared `gameStartTimestamp` (see `types/game.ts`, `render/mapScreen.ts`). No client is more authoritative than another. This was a deliberate deviation — host-broadcast would mean writing the full `tiles` array to Firestore every tick, which is exactly the problem the seed-based architecture was built to avoid. This stops being sufficient the moment focus-tile changes exist mid-game (see #5) — at that point "who's authoritative" becomes a real question again, needing the actions/`effectiveTurn` log discussed earlier but not yet built.

5. **Not yet wired up:** focus-tile selection during Active phase (currently only start-tile selection during Setup is wired — `player.focusTiles` is fixed at whatever was set during Setup for the whole game), spectating, mid-game join, and auth beyond a localStorage-persisted id.

## Resolved

- ~~Map scale vs. Firestore document size~~ — resolved by moving to a seed + deterministic generation model: every client generates the identical map locally from `GameState.seed` + `GameState.config`, so no tile data is ever stored or synced. See `game/mapGenerator.ts`, `types/game.ts`.
- ~~Firestore vs Realtime Database~~ — Firestore, given the above (write volume is now sparse — occasional focus changes, not per-tile state).
- ~~Determinism / `Math.random()`~~ — removed from all game logic (`mapGenerator.ts`, `influence.ts`) in favor of the seeded PRNG in `game/rng.ts`. The one exception, by design: the room's `seed` value itself is generated with `Math.random()` once at room creation — that's the single entropy source everything else derives from deterministically.
- ~~Territory expansion capped at 7 tiles forever~~ — found via simulation, not inspection: the original "spread leftover around the focus" only ever targeted the focus tile's 6 immediate neighbors, so once those filled, nothing could ever expand further. Fixed by spending leftover on the frontier of the player's whole territory (any active, unclaimed tile adjacent to something they control) instead — confirmed by simulation to converge to a winner. See `game/influence.ts` `spreadToFrontier`.
- ~~Cross-client determinism risk from Firestore map field ordering~~ — `Object.values(state.players)` iteration order isn't guaranteed identical across clients (Firestore doesn't publish a field-ordering guarantee for map data), and since players are processed sequentially within a turn, a different order could mean different clients computing different results from the same seed. Fixed by sorting players by id before iterating. See `game/turnEngine.ts`.
- ~~Games that never end~~ — added `GameConfig.maxTurns` (default 500) as a safety net: if nobody hits `controlPercentTarget` by then, the game force-ends and ranks by tiles controlled. Doesn't fix the underlying stalemate mechanism (#2 above), just guarantees termination.
