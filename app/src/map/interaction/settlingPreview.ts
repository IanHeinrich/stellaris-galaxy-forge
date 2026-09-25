import type { MapTooltip } from "../../store/mapChromeStore";
import { OwnedTooltip } from "../ownedTooltip";

/**
 * A drag's preview, and the readout tooltip that goes with it, kept up until the edit it shows
 * has settled so the map never shows the edit gone before it arrives. A newer preview takes
 * over from an edit still settling, and only this preview's own tooltip is ever taken down.
 */
export class SettlingPreview {
  private seq = 0;
  private readonly tip = new OwnedTooltip();

  /** `clear` takes the drawn preview down. */
  constructor(private readonly clear: () => void) {}

  /** A new preview is drawn, with `tip` as its readout, or none when not given. */
  update(tip?: MapTooltip): void {
    this.seq++;
    if (tip) this.tip.show(tip);
    else this.tip.hide();
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
    this.tip.hide();
  }
}
