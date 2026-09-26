import { BitmapText, Container, Graphics, TextStyle } from "pixi.js";
import { MAP_FONT } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import type { LabelBox } from "./labelSlots";
import {
  PLATE_EDGE,
  PLATE_EDGE_ALPHA,
  PLATE_FILL,
  PLATE_FILL_ALPHA,
  PLATE_PAD_X,
  PLATE_PAD_Y,
  PLATE_RADIUS_PX,
} from "./LabelsLayer";

/** One shared instance: PixiJS keys a stroked dynamic bitmap font by the style object. */
const RADIUS_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 10,
  fill: 0xd6dde8,
  stroke: { color: 0x000000, width: 2 },
});

/** A readout on a plate as the name plates have it, measured in unscaled screen pixels. */
export interface RadiusTag {
  readonly holder: Container;
  readonly w: number;
  readonly h: number;
}

/** A plate reading `text`, its text labelled `label` for what it reads. */
export function radiusTag(text: string, label = "radius"): RadiusTag {
  const holder = new Container();
  const plate = new Graphics();
  plate.label = "plate";
  const reading = new BitmapText({ text, style: RADIUS_STYLE });
  reading.label = label;
  reading.position.set(PLATE_PAD_X, PLATE_PAD_Y);
  const w = reading.width + 2 * PLATE_PAD_X;
  const h = reading.height + 2 * PLATE_PAD_Y;
  plate
    .roundRect(0, 0, w, h, PLATE_RADIUS_PX)
    .fill({ color: PLATE_FILL, alpha: PLATE_FILL_ALPHA })
    .stroke({ color: PLATE_EDGE, alpha: PLATE_EDGE_ALPHA, pixelLine: true });
  holder.addChild(plate, reading);
  return { holder, w, h };
}

/** The screen box of body `id`'s tag at plate scale `k`, centred on the screen point (sx, sy). */
export function tagBox(id: number, tag: RadiusTag, sx: number, sy: number, k: number): LabelBox {
  const w = tag.w * k;
  const h = tag.h * k;
  return { id, x: sx - w / 2, y: sy - h / 2, w, h };
}

/** Stands `tag` in the screen box `box`, upright at plate scale `k`. */
export function standTag(tag: RadiusTag, cam: Camera, box: LabelBox, k: number): void {
  const at = cam.screenToWorld(box.x, box.y);
  const scale = cam.childScale(k);
  tag.holder.position.set(at.x, at.y);
  tag.holder.scale.set(scale.x, scale.y);
  tag.holder.visible = true;
}
