import { useMapChromeStore, type MapTooltip } from "../../store/mapChromeStore";

/**
 * A drag's preview, and the readout tooltip that goes with it, kept up until the edit it shows
 * has settled so the map never shows the edit gone before it arrives. A newer preview takes
 * over from an edit still settling, and only this preview's own tooltip is ever taken down.
 */
export class SettlingPreview {
  private seq = 0;
  private tip: MapTooltip | null = null;

  /** `clear` takes the drawn preview down. */
  constructor(private readonly clear: () => void) {}

  /** A new preview is drawn, with `tip` as its readout when given. */
  update(tip?: MapTooltip): void {
    this.seq++;
    if (!tip) return;
    this.tip = tip;
    useMapChromeStore.getState().showTooltip(tip);
  }

  /** Keeps the preview until `applied` settles, unless a newer one has taken over by then. */
  settle(applied: Promise<unknown>): void {
    const seq = ++this.seq;
    void applied.finally(() => {
      if (this.seq === seq) this.drop();
    });
  }

  /** Takes the preview down now, with its tooltip if that is still showing. */
  drop(): void {
    this.seq++;
    this.clear();
    const chrome = useMapChromeStore.getState();
    if (this.tip && chrome.tooltip === this.tip) chrome.hideTooltip();
    this.tip = null;
  }
}
