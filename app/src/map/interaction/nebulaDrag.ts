import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import type { Camera } from "../Camera";
import { nebulaPreview, type NebulaGeometry, type NebulaPreview } from "../nebulaPreview";
import { SettlingPreview } from "./settlingPreview";
import { counted } from "../../lib/text";

/** Where the nebula previews are drawn. */
export interface NebulaSink {
  setNebulaPreview(preview: NebulaPreview | null): void;
}

/** What the cursor says while a nebula drag is open: its members, and the swing either way. */
function readout(preview: NebulaPreview): string {
  return `${counted(preview.total, "system")} (+${preview.joining.length} −${preview.leaving.length})`;
}

function centreOf(index: number): NebulaGeometry {
  const n = useGalaxyStore.getState().nebulae[index];
  return { x: n?.x ?? 0, y: n?.y ?? 0, radius: n?.radius ?? 0 };
}

function radiusTo(index: number, x: number, y: number): NebulaGeometry {
  const c = centreOf(index);
  return { ...c, radius: Math.hypot(x - c.x, y - c.y) };
}

/**
 * The nebula side of `MapIntent`: a ring moved by its centre or resized from a handle, with the
 * systems it would take in and let go, until the edit it sends settles.
 */
export class NebulaDrag {
  private readonly preview: SettlingPreview;

  constructor(
    private readonly cam: Camera,
    private readonly sink: NebulaSink,
  ) {
    this.preview = new SettlingPreview(() => sink.setNebulaPreview(null));
  }

  /** The ring's centre at (x, y); the pointer at (px, py) carries the readout. */
  move(index: number, x: number, y: number, px: number, py: number): void {
    this.show(index, { ...centreOf(index), x, y }, px, py);
  }

  commitMove(index: number, x: number, y: number): void {
    this.preview.settle(useEditorStore.getState().moveNebula(index, x, y));
  }

  /** The pointer's world point, read as a radius about the fixed centre. */
  resize(index: number, x: number, y: number): void {
    this.show(index, radiusTo(index, x, y), x, y);
  }

  commitResize(index: number, x: number, y: number): void {
    const { radius } = radiusTo(index, x, y);
    if (radius > 0) this.preview.settle(useEditorStore.getState().setNebulaRadius(index, radius));
    else this.end();
  }

  end(): void {
    this.preview.drop();
  }

  private show(index: number, geometry: NebulaGeometry, px: number, py: number): void {
    const { systems, grid, nebulae } = useGalaxyStore.getState();
    const preview = nebulaPreview(systems, grid, nebulae, index, geometry);
    this.sink.setNebulaPreview(preview);
    const at = this.cam.worldToScreen(px, py);
    this.preview.update({ x: at.x, y: at.y, title: readout(preview), lines: [] });
  }
}
