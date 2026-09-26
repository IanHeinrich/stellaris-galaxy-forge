import { BitmapText, Container, Graphics, Sprite, TextStyle, Texture } from "pixi.js";
import { fitScale } from "../../../lib/details/orbits";
import {
  formatAmount,
  resourceAbbrev,
  resourceStride,
  type ResourceRow,
} from "../../../lib/details/resources";
import { ACCENT_COLOR, MAP_FONT } from "../../../lib/visual/style";
import { getTexture, onTextures, requestTextures } from "../../../lib/visual/textures";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type SceneBody, type SystemContext } from "../context";
import { drawnDisc } from "../geometry";
import type { PlatePick } from "../picking";
import { placeLabels, plateScale, type LabelItem } from "./labelSlots";
import { NO_HIGHLIGHT, type SceneHighlight, type SystemLayer } from "./SystemLayer";

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
const PLATE_PAD_X = 4;
/** A colonised body's mark: a short bar in its owner's colour down the plate's left edge. */
const COLONY_BAR_PX = 2;
const COLONY_BAR_INSET_PX = 2;
const COLONY_BAR_ALPHA = 0.9;
const PLATE_PAD_Y = 1;
/** A resource's icon and its drop shadow, and the gap between the plate and the row of icons. */
const RESOURCE_ICON_PX = 14;
const ICON_SHADOW_ALPHA = 0.6;
const RESOURCE_GAP_PX = 2;

/** One shared instance each: PixiJS keys a stroked dynamic bitmap font by the style object. */
const STAR_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 14,
  fontWeight: "600",
  fill: 0xf2f5f9,
  stroke: { color: 0x000000, width: 2 },
});
const PLANET_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 12,
  fontWeight: "600",
  fill: 0xf2f5f9,
  stroke: { color: 0x000000, width: 2 },
});
const MOON_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 11,
  fill: 0xe4e9ef,
  stroke: { color: 0x000000, width: 2 },
});
const AMOUNT_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 10,
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

interface Cell {
  key: string;
  icon: Sprite;
  shadow: Sprite;
  abbrev: BitmapText;
}

/** The plate behind a name, and where it stands in its label's unscaled pixels. */
interface Plate {
  g: Graphics;
  x: number;
  w: number;
  h: number;
  colony: number | null;
}

type PlateState = "rest" | "hovered" | "selected";

/**
 * A body's plate with its name, its resource row, or both, in unscaled screen pixels from the
 * box's top-left.
 */
interface Label {
  body: SceneBody;
  holder: Container;
  plate: Plate | null;
  cells: Cell[];
  w: number;
  h: number;
}

function styleOf(body: SceneBody): TextStyle {
  if (body.placement.star) return STAR_STYLE;
  return body.moon ? MOON_STYLE : PLANET_STYLE;
}

/** Stars first, then planets from the largest, then moons from the largest. */
function rank(a: Label, b: Label): number {
  const tier = (l: Label) => (l.body.placement.star ? 0 : l.body.moon ? 2 : 1);
  return tier(a) - tier(b) || b.body.placement.disc - a.body.placement.disc;
}

function drawPlate({ g, x, w, h, colony }: Plate, state: PlateState): void {
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

/**
 * One body's label: its name on a plate when `named`, and under it the resources in `rows`, each
 * icon over its amount.
 */
function makeLabel(body: SceneBody, named: boolean, rows: readonly ResourceRow[]): Label {
  const holder = new Container();
  let plate: Plate | null = null;
  let name: BitmapText | null = null;
  if (named) {
    const g = new Graphics();
    g.label = "plate";
    name = new BitmapText({ text: body.name, style: styleOf(body) });
    name.label = "name";
    name.anchor.set(0.5, 0);
    holder.addChild(g, name);
    const bar = body.colony === null ? 0 : COLONY_BAR_INSET_PX + COLONY_BAR_PX;
    const w = name.width + 2 * PLATE_PAD_X + bar;
    plate = { g, x: 0, w, h: name.height + 2 * PLATE_PAD_Y, colony: body.colony };
  }

  const stride = resourceStride(rows.length);
  let rowHalf = 0;
  let amountH = 0;
  const laid = rows.map((row, i) => {
    const dx = (i - (rows.length - 1) / 2) * stride;
    const shadow = new Sprite(Texture.EMPTY);
    shadow.tint = 0x000000;
    shadow.alpha = ICON_SHADOW_ALPHA;
    shadow.anchor.set(0.5, 0);
    const icon = new Sprite(Texture.EMPTY);
    icon.label = "resource";
    icon.anchor.set(0.5, 0);
    const abbrev = new BitmapText({ text: resourceAbbrev(row.resource), style: ABBREV_STYLE });
    abbrev.anchor.set(0.5, 0.5);
    const amount = new BitmapText({ text: formatAmount(row.amount), style: AMOUNT_STYLE });
    amount.label = "amount";
    amount.anchor.set(0.5, 0);
    holder.addChild(shadow, icon, abbrev, amount);
    const reach = Math.max(RESOURCE_ICON_PX, abbrev.width, amount.width) / 2;
    rowHalf = Math.max(rowHalf, Math.abs(dx) + reach);
    amountH = Math.max(amountH, amount.height);
    return { cell: { key: row.sprite, icon, shadow, abbrev }, amount, dx };
  });

  const w = Math.max(plate?.w ?? 0, 2 * rowHalf);
  if (plate && name) {
    plate.x = (w - plate.w) / 2;
    const bar = plate.colony === null ? 0 : COLONY_BAR_INSET_PX + COLONY_BAR_PX;
    name.position.set(w / 2 + bar / 2, PLATE_PAD_Y);
  }
  const rowY = plate ? plate.h + RESOURCE_GAP_PX : 0;
  for (const { cell, amount, dx } of laid) {
    cell.icon.position.set(w / 2 + dx, rowY);
    cell.shadow.position.set(w / 2 + dx + 1, rowY + 1);
    cell.abbrev.position.set(w / 2 + dx, rowY + RESOURCE_ICON_PX / 2);
    amount.position.set(w / 2 + dx, rowY + RESOURCE_ICON_PX);
  }
  const h = laid.length > 0 ? rowY + RESOURCE_ICON_PX + amountH : (plate?.h ?? 0);
  return { body, holder, plate, cells: laid.map((l) => l.cell), w, h };
}

/**
 * Each body's name on a plate centred under it, placed only where it clears the plates already
 * placed, so the lesser ones drop out as the view zooms out. A moon's plate goes under the moon,
 * or, where that is taken, in a column over its planet's plate. With the Details layer on, the
 * body's resources show under its name, or alone where the Labels layer is off. The plates
 * shrink a little as the view zooms out.
 */
export class LabelsLayer implements SystemLayer {
  readonly id = "labels" as const;
  readonly container = new Container();
  private bodies: readonly SceneBody[] = EMPTY_SYSTEM_CONTEXT.bodies;
  private detailsShown = EMPTY_SYSTEM_CONTEXT.detailsShown;
  private labelsShown = EMPTY_SYSTEM_CONTEXT.labelsShown;
  private fitRadius = EMPTY_SYSTEM_CONTEXT.layout.fitRadius;
  private labels: Label[] = [];
  private shown: PlatePick[] = [];
  private ref: SceneHighlight = NO_HIGHLIGHT;
  /** Whether the hovered body's plate is placed first; see `setHighlighted`. */
  private hoverPinned = false;
  private cam: Camera | null = null;
  private drawnRev = -1;
  private readonly unsubTextures: () => void;

  constructor() {
    this.unsubTextures = onTextures(() => this.redress());
  }

  /** The plates shown now, for picking. */
  plates(): readonly PlatePick[] {
    return this.shown;
  }

  rebuild(ctx: SystemContext): void {
    const same =
      ctx.bodies === this.bodies &&
      ctx.detailsShown === this.detailsShown &&
      ctx.labelsShown === this.labelsShown;
    if (same) return;
    this.bodies = ctx.bodies;
    this.detailsShown = ctx.detailsShown;
    this.labelsShown = ctx.labelsShown;
    this.fitRadius = ctx.layout.fitRadius;
    for (const child of this.container.removeChildren()) child.destroy({ children: true });
    this.labels = ctx.bodies
      .flatMap((body) => {
        const named = ctx.labelsShown && body.name !== "";
        const rows = ctx.detailsShown ? body.resources : [];
        if (!named && rows.length === 0) return [];
        const label = makeLabel(body, named, rows);
        this.container.addChild(label.holder);
        return [label];
      })
      .sort(rank);
    for (const label of this.labels) this.mark(label);
    this.shown = [];
    this.redress();
    this.drawnRev = -1;
    this.place();
  }

  /**
   * The resource icons once they have landed, and their abbreviations where they cannot load.
   * Asks for them again after the cache was cleared, as when game data reloads.
   */
  private redress(): void {
    const wanted = new Set<string>();
    for (const { cells } of this.labels) {
      for (const { key, icon, shadow, abbrev } of cells) {
        const texture = getTexture(key);
        if (texture === undefined) wanted.add(key);
        if (texture && icon.texture !== texture) {
          for (const sprite of [icon, shadow]) {
            sprite.texture = texture;
            sprite.width = RESOURCE_ICON_PX;
            sprite.height = RESOURCE_ICON_PX;
          }
        }
        icon.visible = Boolean(texture);
        shadow.visible = Boolean(texture);
        abbrev.visible = texture === null;
      }
    }
    if (wanted.size > 0) requestTextures(wanted);
  }

  setHighlighted(ref: SceneHighlight): void {
    const hoverMoved = ref.hoverBody !== this.ref.hoverBody;
    const changed = hoverMoved || ref.selectedBody !== this.ref.selectedBody;
    const was = this.ref;
    if (hoverMoved) {
      // Only a hidden plate is brought out: a shown one may be under the pointer, and pinning could move it away.
      this.hoverPinned =
        ref.hoverBody !== null && !this.shown.some((plate) => plate.id === ref.hoverBody);
    }
    this.ref = ref;
    if (!changed) return;
    const touched = [was.hoverBody, was.selectedBody, ref.hoverBody, ref.selectedBody];
    for (const label of this.labels) {
      if (touched.includes(label.body.placement.id)) this.mark(label);
    }
    this.place();
  }

  private mark({ body, plate }: Label): void {
    if (!plate) return;
    const id = body.placement.id;
    const state =
      id === this.ref.selectedBody ? "selected" : id === this.ref.hoverBody ? "hovered" : "rest";
    drawPlate(plate, state);
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
    const k = plateScale(cam.scale / fitScale(this.fitRadius, cam.width, cam.height));
    const byId = new Map(this.labels.map((l) => [l.body.placement.id, l]));
    const parentOf = (l: Label) => {
      const parent = l.body.placement.parent;
      return l.body.moon && parent !== null && byId.has(parent) ? parent : null;
    };
    const moonsOf = new Map<number, Label[]>();
    for (const l of this.labels) {
      const parent = parentOf(l);
      if (parent !== null) moonsOf.set(parent, [...(moonsOf.get(parent) ?? []), l]);
    }
    const orbit = (l: Label) => l.body.placement.ring?.radius ?? 0;
    for (const moons of moonsOf.values()) moons.sort((a, b) => orbit(b) - orbit(a));
    const moonsOfLabel = (l: Label) => moonsOf.get(l.body.placement.id) ?? [];
    const pinned = (l: Label) => {
      const id = l.body.placement.id;
      return id === this.ref.selectedBody || (this.hoverPinned && id === this.ref.hoverBody);
    };
    const groupPinned = (l: Label) => pinned(l) || moonsOfLabel(l).some(pinned);
    const heads = this.labels.filter((l) => parentOf(l) === null);
    const order = [...heads.filter(groupPinned), ...heads.filter((l) => !groupPinned(l))];
    const item = (l: Label): LabelItem => {
      const { x, y, disc } = l.body.placement;
      const at = cam.worldToScreen(x, y);
      return {
        id: l.body.placement.id,
        x: at.x,
        y: at.y,
        r: drawnDisc(disc, cam.scale) * cam.scale,
        w: l.w * k,
        h: l.h * k,
      };
    };
    const items = order.map((l) => ({ ...item(l), moons: moonsOfLabel(l).map(item) }));
    this.shown = placeLabels(items).map((box) => {
      const at = cam.screenToWorld(box.x, box.y);
      return { id: box.id, x: at.x, y: at.y, w: box.w, h: box.h };
    });
    const shown = new Map(this.shown.map((plate) => [plate.id, plate]));
    const scale = cam.childScale(k);
    for (const { body, holder } of this.labels) {
      const plate = shown.get(body.placement.id);
      holder.visible = plate !== undefined;
      if (!plate) continue;
      holder.position.set(plate.x, plate.y);
      holder.scale.set(scale.x, scale.y);
    }
  }

  destroy(): void {
    this.unsubTextures();
    this.container.destroy({ children: true });
  }
}
