import { Container, Graphics, GraphicsContext } from "pixi.js";
import type { SystemNode } from "../../../generated/SystemNode";
import type { Pt } from "../../../lib/geometry/pt";
import { ALLOWED_COLOR } from "../../../lib/visual/style";
import type { Systems } from "../../RenderContext";
import { destroyChildren } from "../destroyChildren";

/** Where the plus sits from the star's centre, and its arm, in marker units. */
const OFFSET = { x: 7, y: -7 };
const ARM = 2;

/** A small faint green plus at the upper right of every save system added this session. */
export class AddedMarks {
  readonly container = new Container({ label: "addedMarks", eventMode: "none" });
  private readonly shape = new GraphicsContext()
    .moveTo(OFFSET.x - ARM, OFFSET.y)
    .lineTo(OFFSET.x + ARM, OFFSET.y)
    .moveTo(OFFSET.x, OFFSET.y - ARM)
    .lineTo(OFFSET.x, OFFSET.y + ARM)
    .stroke({ color: ALLOWED_COLOR, width: 1, alpha: 0.6 });
  private readonly marks = new Map<number, Graphics>();
  private readonly scale: Pt = { x: 1, y: 1 };

  /** Marks every added system of `systems` where `at` says it draws. */
  place(systems: Systems, at: (s: SystemNode) => Pt): void {
    const doomed = new Set<Container>();
    for (const [id, mark] of this.marks) {
      if (systems.get(id)?.added) continue;
      doomed.add(mark);
      this.marks.delete(id);
    }
    destroyChildren(this.container, doomed);
    for (const s of systems.values()) {
      if (!s.added) continue;
      let mark = this.marks.get(s.id);
      if (!mark) {
        mark = new Graphics(this.shape);
        mark.scale.set(this.scale.x, this.scale.y);
        this.marks.set(s.id, mark);
        this.container.addChild(mark);
      }
      const { x, y } = at(s);
      mark.position.set(x, y);
    }
  }

  setScale(scale: Pt): void {
    this.scale.x = scale.x;
    this.scale.y = scale.y;
    for (const mark of this.marks.values()) mark.scale.set(scale.x, scale.y);
  }

  destroy(): void {
    this.shape.destroy();
  }
}
