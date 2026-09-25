import { BitmapText, Container, Graphics } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { Nebula } from "../../generated/Nebula";
import type { Camera } from "../Camera";
import { nebulaHandles } from "../picking";
import { EMPTY_CONTEXT, type RenderContext } from "../RenderContext";
import { HANDLE_COLOR, MAP_FONT, NEBULA_COLOR } from "../../lib/visual/style";
import type { MapLayer } from "./MapLayer";

const FILL = { color: 0x7c5cbf, alpha: 0.12 };
const EDGE = { color: 0x9d7ce0, alpha: 0.25 };
/** The selected nebula: the same ring, bright enough to grab, with a handle on each cardinal. */
const SELECTED_EDGE = { color: NEBULA_COLOR, alpha: 0.9 };
const HANDLE_FILL = { color: HANDLE_COLOR, alpha: 0.9 };
const HANDLE_EDGE = { color: NEBULA_COLOR, alpha: 1 };
const HANDLE_PX = 4;

const LABEL_STYLE = {
  fontFamily: MAP_FONT,
  fontSize: 12,
};
const LABEL_ALPHA = 0.7;
const LABEL_TINT = NEBULA_COLOR;

/** A translucent disc per nebula with its name at the centre, screen-sized like a map label. */
export class NebulaeLayer implements MapLayer {
  readonly id = "nebulae" as const;
  readonly container = new Container();
  private readonly discs = new Graphics();
  private readonly selectionRing = new Graphics();
  private readonly labelLayer = new Container();
  private readonly scale = { x: 1, y: 1 };
  private ctx: RenderContext = EMPTY_CONTEXT;
  private nebulae: readonly Nebula[] = [];
  private selected: number | null = null;
  private camScale = 1;

  constructor() {
    this.container.addChild(this.discs, this.selectionRing, this.labelLayer);
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    if (ctx.nebulae !== this.nebulae) this.draw(ctx.nebulae);
    else if (ctx.names !== prev.names) this.retext();
  }

  applyDelta(d: GalaxyDelta): void {
    if (d.nebulae) this.draw(d.nebulae);
  }

  setSelectedNebula(index: number | null): void {
    this.selected = index;
    this.drawSelection();
  }

  private draw(nebulae: readonly Nebula[]): void {
    this.nebulae = nebulae;
    this.labelLayer.removeChildren().forEach((c) => c.destroy());
    this.discs.clear();
    for (const n of nebulae) {
      this.discs.circle(n.x, n.y, n.radius);
      this.labelLayer.addChild(this.makeLabel(n));
    }
    if (nebulae.length > 0) this.discs.fill(FILL).stroke({ ...EDGE, pixelLine: true });
    this.drawSelection();
  }

  private drawSelection(): void {
    const g = this.selectionRing;
    g.clear();
    const n = this.selected === null ? undefined : this.nebulae[this.selected];
    if (!n) return;
    g.circle(n.x, n.y, n.radius).stroke({ ...SELECTED_EDGE, pixelLine: true });
    const r = HANDLE_PX / this.camScale;
    for (const h of nebulaHandles(n)) g.circle(h.x, h.y, r);
    g.fill(HANDLE_FILL).stroke({ ...HANDLE_EDGE, pixelLine: true });
  }

  onViewport(cam: Camera): void {
    cam.childScale(1, this.scale);
    for (const label of this.labelLayer.children) label.scale.set(this.scale.x, this.scale.y);
    if (cam.scale === this.camScale) return;
    this.camScale = cam.scale;
    this.drawSelection();
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private retext(): void {
    this.nebulae.forEach((n, i) => {
      const label = this.labelLayer.children[i] as BitmapText | undefined;
      const text = this.ctx.nodeName(n.name);
      if (label && label.text !== text) label.text = text;
    });
  }

  private makeLabel(n: Nebula): BitmapText {
    const label = new BitmapText({ text: this.ctx.nodeName(n.name), style: LABEL_STYLE });
    label.anchor.set(0.5, 0.5);
    label.alpha = LABEL_ALPHA;
    label.tint = LABEL_TINT;
    label.scale.set(this.scale.x, this.scale.y);
    label.position.set(n.x, n.y);
    return label;
  }
}
