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

## Tuning notes

**`turnDurationMs`** — no network round-trip limits this (turns are computed locally per client, nothing per-turn touches Firebase), so it's not bounded by latency the way you might expect for multiplayer. What actually limits it:
- **Clock skew between players' devices is the real floor.** Every client computes `currentTurn` from its own `Date.now() - gameStartTimestamp`, with no server correction. Consumer devices can differ by 100-300ms without careful NTP sync. Below ~200-300ms, that skew becomes a full turn or more, and players persistently see different turn numbers (self-corrects over time, not a real desync in final outcome — just visually confusing). Treat ~200-300ms as a practical floor for casual play across assorted phones/laptops.
- **Game-logic compute is cheap at the current map size** — benchmarked at ~6-8ms/turn for 100x100 with up to 20 players (Node, server-grade hardware; expect a few times slower on a phone, still well under any reasonable turn budget). This would NOT hold at the brief's original 1024x1024 default — that benchmarked at ~814ms/turn, nearly consuming a full 1-second turn by itself.
- **Pixi redraw cost hasn't been benchmarked** — happens in-browser, not measurable from this environment. Likely the real bottleneck on lower-end devices, separate from turn-logic speed. `render/mapScreen.ts`'s `tick()` only redraws when a turn actually advanced (not on every poll), which helps, but the redraw itself (thousands of hex `Graphics` objects) is unmeasured.
- Lowering `turnDurationMs` also shortens real-world game length proportionally, since `maxTurns` stays in turn-count terms — e.g. 500 turns at 300ms/turn is ~2.5 minutes vs. ~8.3 minutes at the default 1000ms.

## Open questions / known issues

1. **Map generation looks ugly.** Connectivity and `mapLandPercent` are both correct (flood-fill from a seeded point guarantees a single connected landmass), but uniform-random frontier selection grows thin tendrils outward rather than filling in a compact shape, so coastlines end up spiky/splotchy. See the ideas listed in `mapGenerator.ts`'s docstring (weighted frontier selection, noise-based generation, or a smoothing pass) — flagged for later, not urgent.

2. **Contested borders can stalemate.** Verified via simulation (not hypothetical): once players' territories meet and neither has open neutral land left to expand into, contested border tiles can reach a stable equilibrium where income and decay cancel out turn after turn, and nobody ever crosses `controlPercentTarget`. `maxTurns` guarantees the game still ends, but doesn't address *why* it stalemates. Worth knowing: since start tiles now begin at max and expansion requires full saturation per ring (see Resolved below), typical games now take ~300–500 turns to resolve, up from ~20–80 before — `maxTurns: 500` is no longer comfortably above the natural range, it's close to where some games land. Worth revisiting once real playtesting (not just simulation) gives a feel for actual pacing.

3. **Overflow/diffusion — alternative to the current "spend on frontier" mechanic.** Instead of capping influence at `maxInfluencePerTile` and spending leftover on random frontier tiles, tiles could accumulate above the cap and "overflow" downhill to neighbors with less influence — closer to a diffusion/erosion simulation, likely producing more organic, wave-like expansion. Not implemented: it's a bigger structural change (redefines what "max" means, needs careful deterministic ordering for cascading overflow across a whole map in one turn) and might independently help or hurt the stalemate issue above. Worth an experiment once the current mechanic has been playtested.

4. **Contested-tile tinting is an extrapolation, not a spec'd rule.** `influenceFillColor` tints a single-influencer tile toward neutral by percent-of-max, as directly requested — but for a *contested* tile (multiple influencers), it blends their colors weighted by relative share and tints the whole thing by total fullness. That multi-player treatment was my own call, not explicitly specified. Flagging in case a different treatment is wanted once it's actually visible in-game.

5. **`BUFFER_MS` (250ms default) is an educated guess, not a measurement.** It exists to give Firestore's realtime listener time to deliver a same-turn focus-change action before a client commits to computing that turn — without it, a fast enough `turnDurationMs` could let a client race ahead of an action still in flight, and since `localTiles` advances incrementally rather than being recomputed from scratch, a missed action means a permanent fork, not a one-frame glitch. I don't have real-world Firestore listener latency data to size this properly; it needs field-testing with actual players on real connections, then tuning down (`render/mapScreen.ts`).

6. **Not yet wired up:** spectating, mid-game join, and auth beyond a localStorage-persisted id.

## Resolved

- ~~Map scale vs. Firestore document size~~ — resolved by moving to a seed + deterministic generation model: every client generates the identical map locally from `GameState.seed` + `GameState.config`, so no tile data is ever stored or synced. See `game/mapGenerator.ts`, `types/game.ts`.
- ~~Firestore vs Realtime Database~~ — Firestore, given the above (write volume is now sparse — occasional focus changes, not per-tile state).
- ~~Determinism / `Math.random()`~~ — removed from all game logic (`mapGenerator.ts`, `influence.ts`) in favor of the seeded PRNG in `game/rng.ts`. The one exception, by design: the room's `seed` value itself is generated with `Math.random()` once at room creation — that's the single entropy source everything else derives from deterministically.
- ~~Territory expansion capped at 7 tiles forever~~ — the original "spread leftover around the focus" only ever targeted the focus tile's 6 immediate neighbors. Superseded twice since: first fixed by spending leftover on the frontier of the player's whole territory; then tightened per clarified brief intent so a tile can only spawn expansion once it's at max influence (a proper paced wavefront) — which in turn surfaced a second deadlock (newly-claimed tiles had no path to ever reach max, since nothing but the literal focus tile was ever topped up), fixed by adding a reinforcement phase that tops up the player's own submax territory before spending on new frontier. See `game/influence.ts` `spendLeftover`. Both issues found via actual simulation, not code review.
- ~~Start tiles building up from zero~~ — start tiles now begin at max influence when the game actually starts (`render/mapScreen.ts` `startGameLoop`, `debug/debugHarness.ts`), so players can push outward from turn 0 rather than spending the first several turns just filling their own start tile.
- ~~Tile color didn't reflect influence magnitude~~ — `influenceFillColor` now tints toward neutral by percent-of-max rather than snapping to a flat solid color at any nonzero influence. See `utils/color.ts`.
- ~~Cross-client determinism risk from Firestore map field ordering~~ — `Object.values(state.players)` iteration order isn't guaranteed identical across clients (Firestore doesn't publish a field-ordering guarantee for map data), and since players are processed sequentially within a turn, a different order could mean different clients computing different results from the same seed. Fixed by sorting players by id before iterating. See `game/turnEngine.ts`.
- ~~Games that never end~~ — added `GameConfig.maxTurns` (default 500) as a safety net: if nobody hits `controlPercentTarget` by then, the game force-ends and ranks by tiles controlled. Doesn't fix the underlying stalemate mechanism (#2 above), just guarantees termination.
- ~~Tick loop redrew the whole map every poll regardless of whether a turn advanced~~ — `render/mapScreen.ts`'s `tick()` now only calls `renderGameTiles`/`onTick` when the catch-up loop actually advanced at least one turn. Poll interval (`TICK_INTERVAL_MS`) tightened from 100ms to 30ms now that polling more often doesn't cost wasted redraws — this sets a practical floor on `turnDurationMs` responsiveness; see the note on `turnDurationMs` above.
- ~~Focus-tile selection during Active play, and the "host computes turns" authority question it raised~~ — implemented via an append-only `FocusChangedAction` log on `GameState` (rare, player-initiated events, not per-tick data — doesn't reintroduce the write-volume problem) plus `BUFFER_MS` (see Open Questions #5). Click a tile during Active play to toggle it in/out of your focus set; the start tile can't be removed (brief rule 1). Actions apply at `effectiveTurn = submittedTurn + 1`, never immediately, so it doesn't matter whether a client's Firestore listener delivers an action before or after it locally crosses that turn boundary — only that it arrives before the client actually *computes* that turn, which `BUFFER_MS` protects. Every client still computes every turn locally (the "host computes" divergence noted earlier stands), it's just now provably safe to do so with live player input in the mix. "Only your focus is visible to you" (brief) is enforced at render time (`render/mapScreen.ts` `renderGameTiles` only ever highlights the local player's own resolved focus tiles) rather than by withholding data — every client needs everyone's focus data to compute turns correctly regardless.
- ~~Rule 3 (focus not controlled by player -> line toward it) never actually made progress~~ — found via simulation while testing the newly-wired focus selection: the original approach divided budget evenly across the whole path every turn and always restarted from index 0. Early tiles reached max within a turn or two and then silently absorbed (wasted) every future turn's budget for that focus, since `addInfluence` clamps at max without signaling the spend had no effect — a focus set on a tile 14 hexes away made exactly zero progress after 60 simulated turns. Fixed to walk the path sequentially, fully saturating each tile before advancing to the next (confirmed by simulation to reach a 14-hex-distant target by turn ~250-300). See `game/influence.ts` `spendOnFocus`.
