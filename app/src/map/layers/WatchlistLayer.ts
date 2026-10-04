import { Container } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import { WATCH_COLOURS, type WatchRings } from "../../lib/watchlist";
import type { Camera } from "../Camera";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { DrawnPositions, movedAny, type DrawnChange } from "../drawnPositions";
import { pointsOf, RingBatches, type RingSpec, type WantedRings } from "./highlights/RingBatch";
import { markerScale, type MapLayer } from "./MapLayer";
import { RING_RADIUS, WATCH_RING_STEP } from "../../lib/visual/style";

const WATCH_RING = { width: 2, alpha: 0.85 };

function specOf(rings: WatchRings): RingSpec {
  // Past the last colour the rings repeat with the colours, so an entry's ring can hide another's.
  const step = rings.slot % WATCH_COLOURS.length;
  return {
    color: rings.colour,
    radius: RING_RADIUS.watchlist + WATCH_RING_STEP * step,
    width: WATCH_RING.width,
    alpha: WATCH_RING.alpha,
  };
}

/** One batch per entry: two entries share a colour once every colour is taken. */
function batchKey(rings: WatchRings): string {
  return `${rings.slot}:${rings.colour}`;
}

/** A ring in its entry's colour around every system a shown watchlist entry finds. */
export class WatchlistLayer implements MapLayer {
  readonly id = "watchlist" as const;
  readonly container = new Container();
  private readonly batches = new RingBatches(this.container, "watch.");
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private rings: readonly WatchRings[] = [];
  private readonly scale = { x: 1, y: 1 };

  constructor(private readonly drawn: DrawnPositions) {}

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
    this.batches.setScale(this.scale);
  }

  onDrawn({ moved }: DrawnChange): void {
    if (this.rings.some((r) => movedAny(moved, r.systems))) this.place();
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.batches.destroy();
  }

  private place(): void {
    const wanted = new Map<string, WantedRings>();
    for (const rings of this.rings) {
      wanted.set(batchKey(rings), {
        spec: specOf(rings),
        points: pointsOf(this.systems, rings.systems, this.drawn.at),
      });
    }
    this.batches.sync(wanted);
  }
}
