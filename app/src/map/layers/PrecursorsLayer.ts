import { Container } from "pixi.js";
import type { Pt } from "../../lib/geometry/pt";
import { NO_PRECURSOR } from "../../lib/precursors";
import { NO_PRECURSOR_COLOR, precursorColor } from "../../lib/visual/precursorColors";
import { RING_RADIUS } from "../../lib/visual/style";
import type { Camera } from "../Camera";
import { EMPTY_CONTEXT, type RenderContext } from "../RenderContext";
import { DrawnPositions, type DrawnChange } from "../drawnPositions";
import { RingBatches, type RingSpec } from "./highlights/RingBatch";
import { markerScale, type MapLayer } from "./MapLayer";

const RING = { width: 2.5, alpha: 0.9 };
const NONE_RING: RingSpec = {
  color: NO_PRECURSOR_COLOR,
  radius: RING_RADIUS.precursor,
  width: 1,
  alpha: 0.6,
};

/** Where the first arc of a split ring starts: the top of the ring. */
const SPLIT_START = -Math.PI / 2;
/** The angle left clear between two arcs of a split ring, so neighbouring colours stay apart. */
const SPLIT_GAP = 0.14;

/** The `slot`-th of `of` equal arcs, or the whole ring for a system in one region. */
function arcOf(slot: number, of: number): RingSpec["arc"] {
  if (of < 2) return undefined;
  const span = (2 * Math.PI) / of;
  const start = SPLIT_START + slot * span + SPLIT_GAP / 2;
  return { start, end: start + span - SPLIT_GAP };
}

function specOf(color: number, slot: number, of: number): RingSpec {
  return { color, radius: RING_RADIUS.precursor, ...RING, arc: arcOf(slot, of) };
}

/**
 * A ring in its precursor's colour round every system in a precursor region, split into one arc
 * per shown precursor where regions overlap, and a thin grey ring round the systems in none.
 */
export class PrecursorsLayer implements MapLayer {
  readonly id = "precursors" as const;
  readonly container = new Container();
  private readonly batches = new RingBatches(this.container, "precursor.");
  private ctx: RenderContext = EMPTY_CONTEXT;
  private readonly scale = { x: 1, y: 1 };

  constructor(private readonly drawn: DrawnPositions) {}

  rebuild(ctx: RenderContext): void {
    const previous = this.ctx;
    this.ctx = ctx;
    if (
      ctx.galaxy !== previous.galaxy ||
      ctx.systems !== previous.systems ||
      ctx.precursors !== previous.precursors ||
      ctx.hiddenPrecursors !== previous.hiddenPrecursors
    ) {
      this.place();
    }
  }

  applyDelta(): void {
    // A delta comes with a fresh context, and `rebuild` reads the systems from that.
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    this.batches.setScale(this.scale);
  }

  onDrawn({ moved }: DrawnChange): void {
    if (moved.size > 0) this.place();
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.batches.destroy();
  }

  /** The points each ring kind goes round, by batch key, with the spec it draws. */
  private wanted(): Map<string, { spec: RingSpec; points: Pt[] }> {
    const { precursors, hiddenPrecursors: hidden, systems } = this.ctx;
    const wanted = new Map<string, { spec: RingSpec; points: Pt[] }>();
    if (precursors.legend.length === 0 && precursors.none === 0) return wanted;
    const colors = new Map(precursors.legend.map((region) => [region.key, region.index]));
    const add = (key: string, spec: () => RingSpec, at: Pt) => {
      let entry = wanted.get(key);
      if (!entry) {
        entry = { spec: spec(), points: [] };
        wanted.set(key, entry);
      }
      entry.points.push(at);
    };
    for (const system of systems.values()) {
      const keys = precursors.bySystem.get(system.id);
      if (!keys) {
        if (!hidden.has(NO_PRECURSOR)) add("none", () => NONE_RING, this.drawn.at(system));
        continue;
      }
      const shown = keys.filter((key) => !hidden.has(key));
      shown.forEach((key, slot) => {
        const color = precursorColor(colors.get(key) ?? 0);
        const batchKey = `${key}:${color}:${slot}/${shown.length}`;
        add(batchKey, () => specOf(color, slot, shown.length), this.drawn.at(system));
      });
    }
    return wanted;
  }

  private place(): void {
    this.batches.sync(this.wanted());
  }
}
