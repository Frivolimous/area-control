import * as PIXI from 'pixi.js';
import { Tile } from '../types/game';
import { hexToPixel, hexKey } from '../game/hexGrid';

// Pixels; tune once real map scale / zoom behavior is settled.
export const HEX_SIZE = 12;

export class MapRenderer {
  /** Exposed so callers (mapScreen.ts) can position/scale/hit-test against it. */
  readonly container: PIXI.Container;
  private tileGraphics: Map<string, PIXI.Graphics> = new Map();

  constructor(stage: PIXI.Container) {
    this.container = new PIXI.Container();
    stage.addChild(this.container);
  }

  clear(): void {
    for (const g of this.tileGraphics.values()) {
      g.destroy();
    }
    this.tileGraphics.clear();
  }

  /**
   * Renders active tiles, colored by whatever getFillColor decides —
   * decoupled from any particular game phase so this same renderer works
   * for both the pre-game "claim a start tile" view and in-game influence
   * rendering later.
   */
  render(tiles: Tile[], getFillColor: (tile: Tile) => number): void {
    for (const tile of tiles) {
      if (!tile.active) continue;
      const key = hexKey(tile.coord);
      let g = this.tileGraphics.get(key);
      if (!g) {
        g = new PIXI.Graphics();
        this.tileGraphics.set(key, g);
        this.container.addChild(g);
      }
      this.drawHex(g, tile, getFillColor(tile));
    }
  }

  private drawHex(g: PIXI.Graphics, tile: Tile, fillColor: number): void {
    const { x, y } = hexToPixel(tile.coord, HEX_SIZE);
    g.clear();
    g.beginFill(fillColor);
    g.drawPolygon(hexCorners(x, y, HEX_SIZE));
    g.endFill();
  }
}

function hexCorners(cx: number, cy: number, size: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    points.push(cx + size * Math.cos(angle), cy + size * Math.sin(angle));
  }
  return points;
}
