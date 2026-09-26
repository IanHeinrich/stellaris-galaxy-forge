import { BitmapText, Container, Graphics, TextStyle } from "pixi.js";
import { MAP_FONT } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type Exit, type SystemContext } from "../context";
import {
  EXIT_GAP_PX,
  EXIT_LABEL_GAP_PX,
  EXIT_LENGTH_PX,
  alongExit,
  exitTriangle,
} from "../geometry";
import type { SystemLayer } from "./SystemLayer";

export const EXIT_COLOR = 0x4fd66b;
const EXIT_ALPHA = 0.9;

/** One shared instance: PixiJS keys a stroked dynamic bitmap font by the style object. */
const EXIT_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 12,
  fontWeight: "600",
  fill: 0xa7e8b4,
  stroke: { color: 0x000000, width: 3 },
});

/** One green arrow per hyperlane just outside the inner radius, labelled with the neighbour's name. */
export class ExitsLayer implements SystemLayer {
  readonly id = "exits" as const;
  readonly container = new Container();
  readonly arrows = new Graphics();
  private readonly labels = new Container();
  private exits: readonly Exit[] = EMPTY_SYSTEM_CONTEXT.exits;
  private texts: BitmapText[] = [];
  private drawnRev = -1;

  constructor() {
    this.container.addChild(this.arrows, this.labels);
  }

  rebuild(ctx: SystemContext): void {
    if (ctx.exits === this.exits) return;
    this.exits = ctx.exits;
    for (const child of this.labels.removeChildren()) child.destroy();
    this.texts = ctx.exits.map((exit) => {
      const text = new BitmapText({ text: exit.name, style: EXIT_STYLE });
      text.anchor.set(0.5 - 0.5 * Math.cos(exit.rotation), 0.5 - 0.5 * Math.sin(exit.rotation));
      this.labels.addChild(text);
      return text;
    });
    this.drawnRev = -1;
  }

  onViewport(cam: Camera): void {
    if (cam.rev === this.drawnRev) return;
    this.drawnRev = cam.rev;
    const g = this.arrows.clear();
    const scale = cam.childScale(1);
    this.exits.forEach((exit, i) => {
      g.poly(exitTriangle(exit, cam.scale)).fill({ color: EXIT_COLOR, alpha: EXIT_ALPHA });
      const text = this.texts[i];
      const at = alongExit(exit, cam.scale, EXIT_GAP_PX + EXIT_LENGTH_PX + EXIT_LABEL_GAP_PX);
      text.position.set(at.x, at.y);
      text.scale.set(scale.x, scale.y);
    });
  }

  setHighlighted(): void {}

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
