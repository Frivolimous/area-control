import * as PIXI from 'pixi.js';

let app: PIXI.Application | null = null;

export function initPixiApp(container: HTMLElement): PIXI.Application {
  app = new PIXI.Application({
    resizeTo: container,
    backgroundColor: 0x1a1a2e,
    antialias: true,
  });
  container.appendChild(app.view as unknown as HTMLCanvasElement);
  return app;
}

export function getPixiApp(): PIXI.Application {
  if (!app) throw new Error('Pixi app not initialized — call initPixiApp first.');
  return app;
}
