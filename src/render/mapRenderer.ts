import * as PIXI from 'pixi.js';
import { Tile } from '../types/game';
import { hexToPixel, hexKey } from '../game/hexGrid';

// Pixels; tune once real map scale / zoom behavior is settled.
export const HEX_SIZE = 12;
export const HEX_DRAW_SIZE = HEX_SIZE / 2 / Math.cos(Math.PI / 6);


export class MapRenderer {
  /** Exposed so callers (mapScreen.ts) can position/scale/hit-test against it. */
  readonly container: PIXI.Container;
  private tileGraphics: Map<string, PIXI.Graphics> = new Map();

  constructor(stage: PIXI.Container) {
    this.container = new PIXI.Container();
    stage.addChild(this.container);
  }

  /**
   * Renders active tiles, colored by whatever getFillColor decides —
   * decoupled from any particular game phase so this same renderer works
   * for both the pre-game "claim a start tile" view and in-game influence
   * rendering later. isHighlighted, if given, draws a border on matching
   * tiles — used for showing a player's own focus tiles (never anyone
   * else's, per the brief's "only your focus is visible to you" rule;
   * that's enforced by what the caller passes here, not by this renderer).
   */
  render(tiles: Tile[], getFillColor: (tile: Tile) => number, isHighlighted?: (tile: Tile) => boolean): void {
    for (const tile of tiles) {
      if (!tile.active) continue;
      const key = hexKey(tile.coord);
      let g = this.tileGraphics.get(key);
      if (!g) {
        g = new PIXI.Graphics();
        this.tileGraphics.set(key, g);
        this.container.addChild(g);
      }
      this.drawHex(g, tile, getFillColor(tile), isHighlighted ? isHighlighted(tile) : false);
    }
  }

  private drawHex(g: PIXI.Graphics, tile: Tile, fillColor: number, highlighted: boolean): void {
    const { x, y } = hexToPixel(tile.coord, HEX_SIZE);
    g.clear();
    if (highlighted) g.lineStyle(2, 0xffffff, 1);
    g.beginFill(fillColor);
    g.drawPolygon(hexCorners(x, y, HEX_DRAW_SIZE));
    g.endFill();
    if (highlighted) g.lineStyle(0);
  }

  /**
   * Updates a single already-rendered tile's color/highlight, without
   * touching any other tile's Graphics object. Used for the per-frame fade
   * animation (render/mapScreen.ts) so only the handful of tiles that
   * actually changed color this turn get redrawn each frame, rather than
   * the whole map — full render() is still what creates each tile's
   * Graphics object in the first place, this just updates one.
   */
  updateTileColor(tile: Tile, fillColor: number, highlighted: boolean): void {
    if (!tile.active) return;
    const g = this.tileGraphics.get(hexKey(tile.coord));
    if (g) this.drawHex(g, tile, fillColor, highlighted);
  }

  /**
   * Destroys every existing tile Graphics object, so this same renderer
   * (and the pixi Application/container it's attached to) can be reused
   * for a completely different tile set — e.g. the host regenerating the
   * map. Deliberately doesn't recreate the Application: re-running
   * initPixiApp would append a second canvas on top of the first rather
   * than replacing it.
   */
  reset(): void {
    for (const g of this.tileGraphics.values()) {
      g.destroy();
    }
    this.tileGraphics.clear();
  }
}

function hexCorners(cx: number, cy: number, size: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push(cx + size * Math.cos(angle), cy + size * Math.sin(angle));
  }
  return points;
}
