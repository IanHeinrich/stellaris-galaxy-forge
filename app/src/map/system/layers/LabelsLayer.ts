import { BitmapText, Container, TextStyle } from "pixi.js";
import { MAP_FONT } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import { NAME_STYLE } from "../../layers/nameWidth";
import { EMPTY_SYSTEM_CONTEXT, type SceneBody, type SystemContext } from "../context";
import { drawnDisc } from "../geometry";
import { placeLabels, type LabelItem } from "./labelSlots";
import { NO_HIGHLIGHT, type SceneHighlight, type SystemLayer } from "./SystemLayer";

/** One shared instance each: PixiJS keys a stroked dynamic bitmap font by the style object. */
const PLANET_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 12,
  fontWeight: "600",
  fill: 0xc9d2de,
  stroke: { color: 0x000000, width: 3 },
});
const MOON_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 11,
  fill: 0xa4afbd,
  stroke: { color: 0x000000, width: 3 },
});

/** A moon is labelled unasked once its orbit is this many screen pixels across its planet. */
const MOON_LABEL_ORBIT_PX = 36;

interface Label {
  body: SceneBody;
  text: BitmapText;
  w: number;
  h: number;
}

function styleOf(body: SceneBody): TextStyle {
  if (body.placement.star) return NAME_STYLE;
  return body.moon ? MOON_STYLE : PLANET_STYLE;
}

/** Stars first, then planets from the largest, then moons from the largest. */
function rank(a: Label, b: Label): number {
  const tier = (l: Label) => (l.body.placement.star ? 0 : l.body.moon ? 2 : 1);
  return tier(a) - tier(b) || b.body.placement.disc - a.body.placement.disc;
}

/**
 * Each body's name beside it, placed only where it clears the names already placed, so the
 * lesser ones drop out as the view zooms out. A moon is named on hover, when selected, or once
 * the view is close enough to its planet.
 */
export class LabelsLayer implements SystemLayer {
  readonly id = "labels" as const;
  readonly container = new Container();
  private bodies: readonly SceneBody[] = EMPTY_SYSTEM_CONTEXT.bodies;
  private labels: Label[] = [];
  private ref: SceneHighlight = NO_HIGHLIGHT;
  private cam: Camera | null = null;
  private drawnRev = -1;

  rebuild(ctx: SystemContext): void {
    if (ctx.bodies === this.bodies) return;
    this.bodies = ctx.bodies;
    for (const child of this.container.removeChildren()) child.destroy();
    this.labels = ctx.bodies
      .filter((body) => body.name !== "")
      .map((body) => {
        const text = new BitmapText({ text: body.name, style: styleOf(body) });
        this.container.addChild(text);
        return { body, text, w: text.width, h: text.height };
      })
      .sort(rank);
    this.drawnRev = -1;
    this.place();
  }

  setHighlighted(ref: SceneHighlight): void {
    const changed =
      ref.hoverBody !== this.ref.hoverBody || ref.selectedBody !== this.ref.selectedBody;
    this.ref = ref;
    if (changed) this.place();
  }

  onViewport(cam: Camera): void {
    this.cam = cam;
    if (cam.rev === this.drawnRev) return;
    this.place();
  }

  private place(): void {
    const cam = this.cam;
    if (!cam) return;
    this.drawnRev = cam.rev;
    const pinned = (l: Label) =>
      l.body.placement.id === this.ref.hoverBody || l.body.placement.id === this.ref.selectedBody;
    const shown = (l: Label) => {
      if (!l.body.moon || pinned(l)) return true;
      const ring = l.body.placement.ring;
      return ring !== null && ring.radius * cam.scale >= MOON_LABEL_ORBIT_PX;
    };
    const order = [...this.labels.filter(pinned), ...this.labels.filter((l) => !pinned(l))];
    const items: LabelItem[] = order.filter(shown).map((l) => {
      const { x, y, disc } = l.body.placement;
      const at = cam.worldToScreen(x, y);
      return {
        id: l.body.placement.id,
        x: at.x,
        y: at.y,
        r: drawnDisc(disc, cam.scale) * cam.scale,
        w: l.w,
        h: l.h,
      };
    });
    const boxes = new Map(placeLabels(items).map((box) => [box.id, box]));
    const scale = cam.childScale(1);
    for (const { body, text } of this.labels) {
      const box = boxes.get(body.placement.id);
      text.visible = box !== undefined;
      if (!box) continue;
      const at = cam.screenToWorld(box.x, box.y);
      text.position.set(at.x, at.y);
      text.scale.set(scale.x, scale.y);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
