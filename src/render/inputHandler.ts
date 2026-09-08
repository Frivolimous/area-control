import * as PIXI from 'pixi.js';
import { HexCoord } from '../types/game';

/**
 * TODO: wire up pixi's interaction events (pointerdown on the stage or on
 * individual tile graphics) and convert the pointer position back to a hex
 * coordinate via the inverse of hexToPixel. Needed for:
 * - start location selection during Joining
 * - focus tile selection during Active phase
 */
export function onTileClick(stage: PIXI.Container, callback: (coord: HexCoord) => void): void {
  // Placeholder
}
