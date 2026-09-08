import * as PIXI from 'pixi.js';
import { Tile } from '../types/game';
import { hexToPixel, hexKey } from '../game/hexGrid';
import { blendColors, hexStringToNumber } from '../utils/color';

// Pixels; tune once real map scale / zoom behavior is settled.
const HEX_SIZE = 12;

export class MapRenderer {
  private container: PIXI.Container;
  private tileGraphics: Map<string, PIXI.Graphics> = new Map();

  constructor(stage: PIXI.Container) {
    this.container = new PIXI.Container();
    stage.addChild(this.container);
  }

  render(tiles: Tile[], playerColors: Record<string, string>): void {
    for (const tile of tiles) {
      if (!tile.active) continue;
      const key = hexKey(tile.coord);
      let g = this.tileGraphics.get(key);
      if (!g) {
        g = new PIXI.Graphics();
        this.tileGraphics.set(key, g);
        this.container.addChild(g);
      }
      this.drawHex(g, tile, playerColors);
    }
  }

  private drawHex(g: PIXI.Graphics, tile: Tile, playerColors: Record<string, string>): void {
    const { x, y } = hexToPixel(tile.coord, HEX_SIZE);
    const influencers = Object.keys(tile.influence).filter((id) => (tile.influence[id] ?? 0) > 0);
    const colors = influencers.map((id) => playerColors[id] ?? '#888888');
    const fill = colors.length > 0 ? blendColors(colors) : '#3a3a4e';

    g.clear();
    g.beginFill(hexStringToNumber(fill));
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
