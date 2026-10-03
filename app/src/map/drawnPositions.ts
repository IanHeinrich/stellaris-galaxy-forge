import type { SystemNode } from "../generated/SystemNode";
import type { SweptGround } from "../lib/brush/brushStroke";
import { SAVE_Y_SIGN } from "../lib/geometry/geometry";
import type { Pt } from "../lib/geometry/pt";
import { isFlat, NO_HEIGHT_PREVIEW, relativeHeight, type HeightPreview } from "../lib/height";
import { SpatialGrid } from "../lib/spatialGrid";
import { useGalaxyStore } from "../store/galaxyStore";
import { Camera } from "./Camera";
import type { Systems } from "./RenderContext";
import type { Tilt } from "./tilt";

/** The game's own scale: it lifts a star by half its visual_height. */
export const LIFT_SCALE = 0.5;

/** What one change of the lean or of the previewed heights did to where systems draw. */
export interface DrawnChange {
  /** Systems that draw somewhere else now. */
  readonly moved: ReadonlySet<number>;
  /** Systems whose shown height changed, whether or not that moved them. */
  readonly heights: ReadonlySet<number>;
  /** Whether the lean changed, which moves every system as the pointer finds it. */
  readonly leaned: boolean;
}

const NONE: ReadonlySet<number> = new Set();

/** Whether any of `ids` is among `moved`. */
export function movedAny(moved: ReadonlySet<number>, ids: Iterable<number>): boolean {
  if (moved.size === 0) return false;
  for (const id of ids) if (moved.has(id)) return true;
  return false;
}

/** The systems whose shown height differs between two previews, ended previews included. */
function previewChanges(from: HeightPreview, to: HeightPreview): Set<number> {
  const changed = new Set<number>();
  for (const [id, height] of to) if (from.get(id) !== height) changed.add(id);
  for (const id of from.keys()) if (!to.has(id)) changed.add(id);
  return changed;
}

/**
 * The galaxy's systems copied to where `place` puts them, and a grid over the copies, kept in
 * step with the galaxy store: the latest edit is applied, anything older rebuilds.
 */
class PlacedGrid implements SweptGround {
  readonly systems = new Map<number, SystemNode>();
  readonly grid = new SpatialGrid();
  private galaxy: unknown = null;
  private version = -1;

  constructor(private readonly place: (s: SystemNode) => SystemNode) {}

  current(): this {
    const { galaxy, version, lastDelta, systems } = useGalaxyStore.getState();
    if (galaxy === this.galaxy && version === this.version) return this;
    if (galaxy === this.galaxy && version === this.version + 1 && lastDelta) {
      for (const id of lastDelta.removed ?? []) {
        this.systems.delete(id);
        this.grid.remove(id);
      }
      this.moved(lastDelta.systems.map((s) => s.id));
    } else {
      this.systems.clear();
      for (const s of systems.values()) this.systems.set(s.id, this.place(s));
      this.grid.build(this.systems.values());
    }
    this.galaxy = galaxy;
    this.version = version;
    return this;
  }

  /** Places `ids` again, unless nothing has asked for the grid since it was last dropped. */
  moved(ids: Iterable<number>): void {
    if (this.version < 0) return;
    const { systems } = useGalaxyStore.getState();
    for (const id of ids) {
      const s = systems.get(id);
      if (!s) continue;
      const placed = this.place(s);
      this.systems.set(id, placed);
      this.grid.update(placed);
    }
  }

  forget(): void {
    this.galaxy = null;
    this.version = -1;
  }
}

/**
 * Where every system of the galaxy map draws: on the plane while the map lies flat, and lifted
 * by its height, or the height the map previews for it, while the map leans. The lift is a
 * constant per star, `height · LIFT_SCALE · tan θ` up the world container, which the camera
 * squashes in y by `cos θ` so the star rises `height · LIFT_SCALE · sin θ` on screen.
 *
 * Layers draw systems where `at` says, and redraw what a `DrawnChange` names. The pointer finds
 * systems and lanes in pick space, the world container with y squashed as the screen squashes
 * it, so a pick radius in pixels stays round. A brush sweeps the systems where they draw.
 */
export class DrawnPositions {
  private tilt: Tilt;
  private shown: HeightPreview = NO_HEIGHT_PREVIEW;
  /** World-container y a system moves per unit of shown height: 0 while the map lies flat. */
  private rise = 0;
  /** How much the screen squashes world y. */
  private squash = 1;
  private readonly listeners = new Set<(change: DrawnChange) => void>();
  private readonly picked = new PlacedGrid((s) => ({ ...s, y: this.y(s) * this.squash }));
  private readonly swept = new PlacedGrid((s) => ({ ...s, y: this.y(s) }));
  private highest: { systems: Systems; preview: HeightPreview; height: number } | null = null;

  constructor(private readonly cam: Camera = new Camera()) {
    this.tilt = cam.tilt;
    this.readTilt();
  }

  /** Whether the map leans, so a height moves where a system draws. */
  get leans(): boolean {
    return this.rise !== 0;
  }

  /** The heights shown for systems before they are an edit. */
  get preview(): HeightPreview {
    return this.shown;
  }

  /** Leans the camera and the systems `degrees` away from the viewer; 0 lays the map flat. */
  setTilt(degrees: number): void {
    this.cam.setTilt(degrees);
    if (this.cam.tilt === this.tilt) return;
    const moved = this.offPlane();
    this.tilt = this.cam.tilt;
    this.readTilt();
    this.picked.forget();
    this.swept.forget();
    this.emit({ moved, heights: NONE, leaned: true });
  }

  /** Shows `preview`'s heights in place of the stored ones of its systems. */
  setPreview(preview: HeightPreview): void {
    if (preview === this.shown) return;
    const heights = previewChanges(this.shown, preview);
    this.shown = preview;
    if (heights.size === 0) return;
    if (this.leans) {
      this.picked.moved(heights);
      this.swept.moved(heights);
    }
    this.emit({ moved: this.leans ? heights : NONE, heights, leaned: false });
  }

  /** Calls `listener` with every change until the returned call. */
  onChange(listener: (change: DrawnChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** System `s`'s height above the game's default plane, or the one previewed for it. */
  height(s: SystemNode): number {
    return this.shown.get(s.id) ?? relativeHeight(s.height);
  }

  /** The world-container y at which system `s` draws. */
  y(s: SystemNode): number {
    return this.rise === 0 ? s.y : s.y - this.rise * this.height(s);
  }

  /** Where system `s` draws in the world container: `s` itself while it draws on the plane. */
  readonly at = (s: SystemNode): Pt => {
    const y = this.y(s);
    return y === s.y ? s : { x: s.x, y };
  };

  /** Where system `s` would draw standing at `p` on the plane, as a dragged ghost does. */
  atPoint(s: SystemNode, p: Pt): Pt {
    return { x: p.x, y: p.y + this.y(s) - s.y };
  }

  /** How far from its own y any system may draw, for a layer culling by the view. */
  reach(): number {
    if (!this.leans) return 0;
    const { systems } = useGalaxyStore.getState();
    let held = this.highest;
    if (!held || held.systems !== systems || held.preview !== this.shown) {
      let height = 0;
      for (const s of systems.values()) {
        height = Math.max(height, Math.abs(relativeHeight(s.height)));
      }
      for (const h of this.shown.values()) height = Math.max(height, Math.abs(h));
      held = { systems, preview: this.shown, height };
      this.highest = held;
    }
    return Math.abs(this.rise) * held.height;
  }

  /** A world-container point in pick space. */
  toPick(p: Pt, out: Pt = { x: 0, y: 0 }): Pt {
    out.x = p.x;
    out.y = p.y * this.squash;
    return out;
  }

  /** Where the pointer finds system `s`, in pick space. */
  readonly pickAt = (s: SystemNode): Pt => {
    const y = this.y(s) * this.squash;
    return y === s.y ? s : { x: s.x, y };
  };

  /** The systems in pick space, to pick from; null before a galaxy is open. */
  pickGrid(): SpatialGrid | null {
    const { grid } = useGalaxyStore.getState();
    if (!grid || this.squash === 1) return grid;
    return this.picked.current().grid;
  }

  /** The systems where they draw, which a brush sweeps; null before a galaxy is open. */
  sweptSystems(): SweptGround | null {
    const { systems, grid } = useGalaxyStore.getState();
    if (!grid) return null;
    return this.leans ? this.swept.current() : { systems, grid };
  }

  private readTilt(): void {
    const { sin, cos } = this.tilt;
    this.rise = sin === 0 ? 0 : (SAVE_Y_SIGN * LIFT_SCALE * sin) / cos;
    this.squash = cos;
  }

  /** The systems drawn off the plane now, which a change of lean moves. */
  private offPlane(): Set<number> {
    const ids = new Set<number>();
    for (const s of useGalaxyStore.getState().systems.values()) {
      if (!isFlat(this.height(s))) ids.add(s.id);
    }
    return ids;
  }

  private emit(change: DrawnChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
