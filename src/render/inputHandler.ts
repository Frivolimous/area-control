import * as PIXI from 'pixi.js';
import { HexCoord } from '../types/game';
import { pixelToHex } from '../game/hexGrid';

/**
 * Wires a pointerdown listener on the pixi app's stage and reports the hex
 * coordinate under the click. Takes mapContainer explicitly (rather than
 * assuming it's at the origin) because mapScreen.ts scales/positions it to
 * fit the viewport — event.getLocalPosition accounts for that transform.
 */
export function onTileClick(
  app: PIXI.Application,
  mapContainer: PIXI.Container,
  hexSize: number,
  callback: (coord: HexCoord) => void
): void {
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
    const local = event.getLocalPosition(mapContainer);
    callback(pixelToHex(local.x, local.y, hexSize));
  });
}
