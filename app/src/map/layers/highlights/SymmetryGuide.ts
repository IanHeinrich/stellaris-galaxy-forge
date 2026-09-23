import { Graphics } from "pixi.js";
import { guideLines, type Symmetry } from "../../../lib/geometry/symmetry";
import { ACCENT_COLOR } from "../../../lib/visual/style";

/** The brush accent, faint enough to paint over. */
const STYLE = { color: ACCENT_COLOR, alpha: 0.3 };

/** Symmetry's axis or spokes, out to `reach` from the galaxy's centre. */
export class SymmetryGuide {
  readonly graphics = new Graphics({ label: "symmetryGuide" });
  private symmetry: Symmetry | null = null;

  constructor(private reach: number) {}

  /** The symmetry edits repeat under; null hides the guide. */
  set(symmetry: Symmetry | null): void {
    this.symmetry = symmetry;
    this.draw();
  }

  setReach(reach: number): void {
    if (reach === this.reach) return;
    this.reach = reach;
    this.draw();
  }

  private draw(): void {
    const g = this.graphics;
    g.clear();
    if (!this.symmetry) return;
    const lines = guideLines(this.symmetry, this.reach);
    for (const [a, b] of lines) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    if (lines.length > 0) g.stroke({ ...STYLE, pixelLine: true });
  }
}
