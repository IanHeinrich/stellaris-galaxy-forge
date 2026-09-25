import { useMapChromeStore, type MapTooltip } from "../store/mapChromeStore";

/** A tooltip one part of the map puts up, and takes down only while it is still the one showing. */
export class OwnedTooltip {
  private tip: MapTooltip | null = null;

  show(tip: MapTooltip): void {
    this.tip = tip;
    useMapChromeStore.getState().showTooltip(tip);
  }

  hide(): void {
    const chrome = useMapChromeStore.getState();
    if (this.tip && chrome.tooltip === this.tip) chrome.hideTooltip();
    this.tip = null;
  }
}
