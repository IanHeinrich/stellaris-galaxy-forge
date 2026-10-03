import type { SystemNode } from "../../generated/SystemNode";
import type { Pt } from "../../lib/geometry/pt";
import { NO_HEIGHT_PREVIEW, type HeightPreview } from "../../lib/height";
import { SpatialGrid } from "../../lib/spatialGrid";
import { useGalaxyStore } from "../../store/galaxyStore";
import { FLAT_TILT, isTilted, systemY, type Tilt } from "../tilt";

/**
 * The systems where a tilted map draws them, for picking: each lifted by its height, or the one
 * previewed, with y squashed as the screen squashes it so a pick radius stays round on screen.
 * Built when first asked after the galaxy or the tilt changed; a preview moves only its systems.
 */
export class LiftedGrid {
  private readonly grid = new SpatialGrid();
  private tilt: Tilt = FLAT_TILT;
  private preview: HeightPreview = NO_HEIGHT_PREVIEW;
  private stale = true;
  private readonly unsubscribe: () => void;

  constructor() {
    this.unsubscribe = useGalaxyStore.subscribe((state, previous) => {
      if (state.version !== previous.version || state.galaxy !== previous.galaxy) this.stale = true;
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  setTilt(tilt: Tilt): void {
    if (tilt === this.tilt) return;
    this.tilt = tilt;
    this.stale = true;
  }

  setPreview(preview: HeightPreview, changed: ReadonlySet<number>): void {
    this.preview = preview;
    if (this.stale || !isTilted(this.tilt)) return;
    const { systems } = useGalaxyStore.getState();
    for (const id of changed) {
      const s = systems.get(id);
      if (s) this.grid.update(this.lifted(s));
    }
  }

  /** The grid to pick from, and where a world point lands in it. */
  query(at: Pt, out: Pt): SpatialGrid {
    if (this.stale) {
      this.grid.build([...useGalaxyStore.getState().systems.values()].map((s) => this.lifted(s)));
      this.stale = false;
    }
    out.x = at.x;
    out.y = at.y * this.tilt.cos;
    return this.grid;
  }

  /** Whether system `s` draws inside the world rectangle, lifted as the map leans. */
  drawsIn(s: SystemNode, x0: number, y0: number, x1: number, y1: number): boolean {
    const y = systemY(s, this.tilt, this.preview);
    return s.x >= x0 && s.x <= x1 && y >= y0 && y <= y1;
  }

  private lifted(s: SystemNode): SystemNode {
    return { ...s, y: systemY(s, this.tilt, this.preview) * this.tilt.cos };
  }
}
