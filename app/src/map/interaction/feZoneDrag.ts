import { feDirectionLabel, feZoneRefusal } from "../../lib/feZone";
import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import type { MapTooltip } from "../../store/mapChromeStore";
import type { Camera } from "../Camera";
import { feZonePreview, type FeZonePreview } from "../feZonePreview";
import { SettlingPreview } from "./settlingPreview";

/** Where the zone previews are drawn. */
export interface FeZoneSink {
  setFeZonePreview(preview: FeZonePreview | null): void;
}

/** What the cursor says while a ring is dragged: where it would snap, and what is in the way. */
function zoneReadout(preview: FeZonePreview): MapTooltip["lines"] {
  if (preview.blocked) {
    return [feZoneRefusal(preview.blocked, (s) => useGalaxyStore.getState().systemName(s.id))];
  }
  return preview.offMap ? [feZoneRefusal(null, () => "")] : [];
}

function previewAt(anchor: number, x: number, y: number): FeZonePreview | null {
  return feZonePreview(useGalaxyStore.getState().systems, anchor, { x, y });
}

/**
 * The fallen empire zone side of `MapIntent`: a ring dragged about its anchor, snapped to the
 * mod's grid, until the edit it sends settles.
 */
export class FeZoneDrag {
  private readonly preview: SettlingPreview;

  constructor(
    private readonly cam: Camera,
    private readonly sink: FeZoneSink,
  ) {
    this.preview = new SettlingPreview(() => sink.setFeZonePreview(null));
  }

  move(anchor: number, x: number, y: number): void {
    const preview = previewAt(anchor, x, y);
    this.sink.setFeZonePreview(preview);
    if (!preview) {
      this.preview.update();
      return;
    }
    const at = this.cam.worldToScreen(x, y);
    this.preview.update({
      x: at.x,
      y: at.y,
      title: `${feDirectionLabel(preview.direction)} · ${preview.distance}`,
      lines: zoneReadout(preview),
    });
  }

  commit(anchor: number, x: number, y: number): void {
    const preview = previewAt(anchor, x, y);
    if (!preview) {
      this.end();
      return;
    }
    this.preview.settle(
      useEditorStore.getState().moveFeZone(anchor, preview.direction, preview.distance),
    );
  }

  end(): void {
    this.preview.drop();
  }
}
