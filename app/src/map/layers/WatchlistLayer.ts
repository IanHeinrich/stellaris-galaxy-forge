import { Container } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import { WATCH_COLOURS, type WatchRings } from "../../lib/watchlist";
import type { Camera } from "../Camera";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { pointsOf, RingBatch, type RingSpec } from "./highlights/RingBatch";
import { markerScale, type MapLayer } from "./MapLayer";

/** Outside the issue rings; each entry down the list sits a step further out than the one before. */
const WATCH_RING = { radius: 21, step: 3, width: 2, alpha: 0.85 };

function specOf(rings: WatchRings): RingSpec {
  const step = rings.slot % WATCH_COLOURS.length;
  return {
    color: rings.colour,
    radius: WATCH_RING.radius + WATCH_RING.step * step,
    width: WATCH_RING.width,
    alpha: WATCH_RING.alpha,
  };
}

function batchKey(rings: WatchRings): string {
  return `${rings.colour}:${rings.slot % WATCH_COLOURS.length}`;
}

/** A ring in its entry's colour around every system a shown watchlist entry finds. */
export class WatchlistLayer implements MapLayer {
  readonly id = "watchlist" as const;
  readonly container = new Container();
  private readonly batches = new Map<string, RingBatch>();
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private rings: readonly WatchRings[] = [];
  private readonly scale = { x: 1, y: 1 };

  rebuild(ctx: RenderContext): void {
    const loaded = ctx.galaxy !== this.galaxy;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    if (loaded) this.place();
  }

  applyDelta(d: GalaxyDelta): void {
    const moved = new Set([...d.systems.map((s) => s.id), ...(d.removed ?? [])]);
    if (this.rings.some((r) => r.systems.some((id) => moved.has(id)))) this.place();
  }

  setWatchlist(rings: readonly WatchRings[]): void {
    this.rings = rings;
    this.place();
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    for (const batch of this.batches.values()) batch.setScale(this.scale);
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    for (const batch of this.batches.values()) batch.destroy();
  }

  private place(): void {
    const wanted = new Map(this.rings.map((rings) => [batchKey(rings), rings]));
    for (const [key, batch] of this.batches) {
      if (wanted.has(key)) continue;
      this.container.removeChild(batch.container);
      batch.container.destroy({ children: true });
      batch.destroy();
      this.batches.delete(key);
    }
    for (const [key, rings] of wanted) {
      let batch = this.batches.get(key);
      if (!batch) {
        batch = new RingBatch(specOf(rings), `watch.${key}`);
        batch.setScale(this.scale);
        this.batches.set(key, batch);
        this.container.addChild(batch.container);
      }
      batch.place(pointsOf(this.systems, rings.systems));
    }
  }
}
