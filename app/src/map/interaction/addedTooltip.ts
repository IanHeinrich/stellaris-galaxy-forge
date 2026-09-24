import { ADDED_THIS_SESSION } from "../../lib/addSystem";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore, type MapTooltip } from "../../store/mapChromeStore";

/** The tooltip on a save system added this session while the pointer rests on its star. */
export class AddedTooltip {
  private tip: MapTooltip | null = null;

  /** Follows the pointer: `system` is the star under it, at (sx, sy) in map-area pixels. */
  update(system: number | null, sx: number, sy: number): void {
    const galaxy = useGalaxyStore.getState();
    const node = system === null ? undefined : galaxy.systems.get(system);
    if (!node?.added) {
      this.drop();
      return;
    }
    this.tip = {
      x: sx,
      y: sy,
      title: `${galaxy.systemName(node.id)} #${node.id}`,
      lines: [ADDED_THIS_SESSION],
    };
    useMapChromeStore.getState().showTooltip(this.tip);
  }

  /** Takes the tooltip down, if it is still the one showing. */
  drop(): void {
    const chrome = useMapChromeStore.getState();
    if (this.tip && chrome.tooltip === this.tip) chrome.hideTooltip();
    this.tip = null;
  }
}
