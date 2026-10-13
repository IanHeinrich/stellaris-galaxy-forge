import { BitmapText, Container, Graphics, TextStyle } from "pixi.js";
import { PLATE_PAD_PX } from "../../../lib/details/layout";
import type { ResourceRow } from "../../../lib/details/resources";
import type { Names } from "../../../lib/names";
import { ACCENT_COLOR, MAP_FONT } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import type { Textures } from "../../layers/details/cell";
import {
  RESOURCE_AMOUNT_PX,
  type ResourceReach,
  resourceIcons,
  type ResourceStyles,
} from "../../layers/details/resources";
import type { Row } from "../../layers/details/Row";
import type { LabelBox } from "./labelSlots";
import { NAME_FRAME } from "./nameMarks";

/** The plate behind a name: a dark wash with a faint edge, raised a little while hovered. */
const PLATE_FILL = 0x000000;
const PLATE_FILL_ALPHA = 0.4;
const PLATE_HOVER_FILL_ALPHA = 0.55;
const PLATE_EDGE = 0xd0d6de;
const PLATE_EDGE_ALPHA = 0.2;
const PLATE_HOVER_EDGE_ALPHA = 0.35;
/** The selected body's plate is edged in the selection ring's colour, at full strength. */
const PLATE_SELECTED_EDGE_PX = 1.5;
const PLATE_RADIUS_PX = 3;
/** The plate past the name on each side, and above and below it, in screen pixels. */
export const PLATE_PAD_X = 4;
export const PLATE_PAD_Y = 1;
/** A colonised body's mark: a short bar in its owner's colour down the plate's left edge. */
const COLONY_BAR_PX = 2;
const COLONY_BAR_INSET_PX = 2;
const COLONY_BAR_ALPHA = 0.9;

/** One shared instance: PixiJS keys a stroked dynamic bitmap font by the style object. */
const RADIUS_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 10,
  fill: 0xd6dde8,
  stroke: { color: 0x000000, width: 2 },
});

/** A name's plate, and where it stands in its label's unscaled pixels. */
export interface Plate {
  g: Graphics;
  x: number;
  w: number;
  h: number;
  /** The owner's colour its colony bar shows; null for a body that is not a colony. */
  colony: number | null;
}

export type PlateState = "rest" | "hovered" | "selected";

/** How far a colony's bar pushes the name along its plate; 0 for a body that is not a colony. */
export function colonyBarReach(colony: number | null): number {
  return colony === null ? 0 : COLONY_BAR_INSET_PX + COLONY_BAR_PX;
}

export function drawPlate({ g, x, w, h, colony }: Plate, state: PlateState): void {
  const hovered = state === "hovered";
  g.clear()
    .roundRect(x, 0, w, h, PLATE_RADIUS_PX)
    .fill({ color: PLATE_FILL, alpha: hovered ? PLATE_HOVER_FILL_ALPHA : PLATE_FILL_ALPHA });
  if (state === "selected") {
    g.stroke({ color: ACCENT_COLOR, width: PLATE_SELECTED_EDGE_PX, alignment: 1 });
  } else {
    const alpha = hovered ? PLATE_HOVER_EDGE_ALPHA : PLATE_EDGE_ALPHA;
    g.stroke({ color: PLATE_EDGE, alpha, pixelLine: true });
  }
  if (colony !== null) {
    const inset = COLONY_BAR_INSET_PX;
    g.roundRect(x + inset, inset, COLONY_BAR_PX, h - 2 * inset, COLONY_BAR_PX / 2).fill({
      color: colony,
      alpha: COLONY_BAR_ALPHA,
    });
  }
}

/** A readout on a plate as the name plates have it, measured in unscaled screen pixels. */
export interface RadiusTag {
  readonly holder: Container;
  readonly w: number;
  readonly h: number;
}

/** A plate reading `text`, its text labelled `label` for what it reads. */
export function radiusTag(text: string, label: string): RadiusTag {
  const holder = new Container();
  const g = new Graphics();
  g.label = "plate";
  const reading = new BitmapText({ text, style: RADIUS_STYLE });
  reading.label = label;
  reading.position.set(PLATE_PAD_X, PLATE_PAD_Y);
  const w = reading.width + 2 * PLATE_PAD_X;
  const h = reading.height + 2 * PLATE_PAD_Y;
  drawPlate({ g, x: 0, w, h, colony: null }, "rest");
  holder.addChild(g, reading);
  return { holder, w, h };
}

/**
 * Readout plates by `K`, each added to `container` hidden until it is stood, and made again only
 * when its text moves.
 */
export class TagCache<K> {
  private readonly tags = new Map<K, { text: string; tag: RadiusTag }>();

  constructor(private readonly container: Container) {}

  /** The plate for `key` reading `text`, its text labelled `label`; null, with none left, for no text. */
  get(key: K, text: string | null, label: string): RadiusTag | null {
    const held = this.tags.get(key);
    if (held?.text !== text) {
      held?.tag.holder.destroy({ children: true });
      this.tags.delete(key);
      if (text !== null) {
        const tag = radiusTag(text, label);
        this.container.addChild(tag.holder);
        this.tags.set(key, { text, tag });
      }
    }
    const tag = this.tags.get(key)?.tag ?? null;
    if (tag) tag.holder.visible = false;
    return tag;
  }

  hideAll(): void {
    for (const { tag } of this.tags.values()) tag.holder.visible = false;
  }

  clear(): void {
    for (const { tag } of this.tags.values()) tag.holder.destroy({ children: true });
    this.tags.clear();
  }
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

/** The gap between the plate and the row of icons. */
export const RESOURCE_GAP_PX = 2;

/** A planet's name, and the name on a snug plate of anything shown like one. */
export const PLANET_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 12,
  fontWeight: "600",
  fill: 0xf2f5f9,
  stroke: { color: 0x000000, width: 2 },
});
const AMOUNT_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: RESOURCE_AMOUNT_PX,
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 2 },
});
const ABBREV_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 10,
  fontWeight: "600",
  fill: 0xd6dde8,
  stroke: { color: 0x000000, width: 2 },
});
/** A plain body's resource row; a marked body's has the galaxy row's styles. */
export const PLAIN_RESOURCE_STYLES: ResourceStyles = { abbrev: ABBREV_STYLE, amount: AMOUNT_STYLE };

/** Draws `rows` into a label's resource row, its middle at x = 0 and its top at 0. */
export function drawResources(
  row: Row,
  names: Names,
  tex: Textures,
  rows: readonly ResourceRow[],
  styles: ResourceStyles | undefined,
): ResourceReach {
  row.begin();
  const reach = resourceIcons(row, names, tex, rows, 0, styles);
  row.end();
  return reach;
}

/** A body's name, its plate and how far down the plate the name stands. */
export interface Nameplate {
  plate: Plate;
  name: BitmapText;
  nameY: number;
}

/** `text` in `style` on the galaxy row's plate when `big`, else a snug one, with room for a colony's bar. */
export function nameplate(
  text: string,
  style: TextStyle,
  big: boolean,
  colony: number | null,
): Nameplate {
  const g = new Graphics();
  g.label = "plate";
  const name = new BitmapText({ text, style });
  name.label = "name";
  name.anchor.set(0.5, 0);
  const bar = colonyBarReach(colony);
  if (big) {
    const w = name.width + 2 * PLATE_PAD_PX + bar;
    const plate = { g, x: 0, w, h: NAME_FRAME.height, colony };
    return { plate, name, nameY: -NAME_FRAME.y };
  }
  const w = name.width + 2 * PLATE_PAD_X + bar;
  const plate = { g, x: 0, w, h: name.height + 2 * PLATE_PAD_Y, colony };
  return { plate, name, nameY: PLATE_PAD_Y };
}
