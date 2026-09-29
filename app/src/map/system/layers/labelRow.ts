import { PickedTips, type Tip } from "../../layers/details/Hover";
import { Row } from "../../layers/details/Row";

/**
 * A galaxy details row drawn inside a body's label. The scene picks by hand what the pointer is
 * over, so the row's tooltips are looked up by point rather than raised by PixiJS's events.
 */
export class LabelRow {
  private readonly tips = new PickedTips();
  readonly row = new Row(this.tips);
  readonly root = this.row.root;

  constructor(label: string) {
    this.root.label = label;
    this.root.eventMode = "none";
  }

  /** The tooltip of what the row draws at (x, y) in the label's unscaled pixels; null for none. */
  tipAt(x: number, y: number): Tip | null {
    const { position, scale } = this.root;
    return this.tips.at((x - position.x) / scale.x, (y - position.y) / scale.y);
  }
}
