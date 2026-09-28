import { BitmapText, Container, Graphics, Sprite, TextStyle, Texture } from "pixi.js";
import { type BodyMarks, marked, NO_MARKS, sameMarks } from "../../../lib/details/layout";
import { formatAmount, resourceAbbrev, type ResourceRow } from "../../../lib/details/resources";
import { MAP_FONT } from "../../../lib/visual/style";
import { onTextures, requestTextures } from "../../../lib/visual/textures";
import type { Camera } from "../../Camera";
import { queuedTextures } from "../../layers/details/cell";
import {
  ICON_SHADOW_ALPHA,
  ICON_SHADOW_OFFSET_PX,
  RESOURCE_AMOUNT_PX,
  RESOURCE_ICON_PX,
  resourceCell,
} from "../../layers/details/resources";
import { EMPTY_SYSTEM_CONTEXT, type SceneBody, type SystemContext } from "../context";
import { bodyTier, drawnDisc } from "../geometry";
import type { PlatePick } from "../picking";
import { placeLabels, plateScaleAt, type LabelItem } from "./labelSlots";
import { NameMarks } from "./nameMarks";
import { colonyBarReach, drawPlate, PLATE_PAD_X, PLATE_PAD_Y, type Plate } from "./plate";
import { NO_HIGHLIGHT, type SceneHighlight, type SystemLayer } from "./SystemLayer";

/** The gap between the plate and the row of icons. */
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

interface Cell {
  key: string;
  icon: Sprite;
  shadow: Sprite;
  abbrev: BitmapText;
}

/**
 * A body's plate with its name, its resource row, or both, in unscaled screen pixels from the
 * box's top-left.
 */
interface Label {
  body: SceneBody;
  holder: Container;
  plate: Plate | null;
  /** A colony's or pre-FTL body's marks about its plate; null for any other body, or none shown. */
  marks: NameMarks | null;
  cells: Cell[];
  w: number;
  h: number;
}

function styleOf(body: SceneBody): TextStyle {
  if (body.placement.star) return STAR_STYLE;
  return body.moon ? MOON_STYLE : PLANET_STYLE;
}

/** Whether `b`'s label reads and ranks as `a`'s does, wherever each stands. */
function labelledAlike(a: SceneBody, b: SceneBody): boolean {
  return (
    a.name === b.name &&
    a.moon === b.moon &&
    a.colony === b.colony &&
    a.resources === b.resources &&
    sameMarks(a.marks, b.marks) &&
    a.placement.star === b.placement.star &&
    a.placement.disc === b.placement.disc
  );
}

/** Stars first, then planets from the largest, then moons from the largest. */
function rank(a: Label, b: Label): number {
  return bodyTier(a.body) - bodyTier(b.body) || b.body.placement.disc - a.body.placement.disc;
}

/**
 * One body's label: its name on a plate when `named`, with `marks` about the plate, and under it
 * the resources in `rows`, each icon over its amount.
 */
function makeLabel(
  body: SceneBody,
  named: boolean,
  rows: readonly ResourceRow[],
  marks: BodyMarks,
): Label {
  const holder = new Container();
  let plate: Plate | null = null;
  let name: BitmapText | null = null;
  let nameMarks: NameMarks | null = null;
  if (named) {
    const g = new Graphics();
    g.label = "plate";
    name = new BitmapText({ text: body.name, style: styleOf(body) });
    name.label = "name";
    name.anchor.set(0.5, 0);
    const w = name.width + 2 * PLATE_PAD_X + colonyBarReach(body.colony);
    plate = { g, x: 0, w, h: name.height + 2 * PLATE_PAD_Y, colony: body.colony };
    if (marked(marks)) nameMarks = new NameMarks(marks, plate.w, plate.h);
    if (nameMarks?.under) holder.addChild(nameMarks.under);
    holder.addChild(g);
    if (nameMarks) holder.addChild(nameMarks.over);
    holder.addChild(name);
  }

  let rowHalf = 0;
  let amountH = 0;
  const laid = rows.map((row, i) => {
    const dx = resourceCell(i, rows.length, 0).x;
    const shadow = new Sprite(Texture.EMPTY);
    shadow.tint = 0x000000;
    shadow.alpha = ICON_SHADOW_ALPHA;
    shadow.anchor.set(0.5, 0);
    const icon = new Sprite(Texture.EMPTY);
    icon.label = "resource";
    icon.anchor.set(0.5, 0);
    const abbrev = new BitmapText({ text: resourceAbbrev(row.resource), style: ABBREV_STYLE });
    abbrev.anchor.set(0.5, 0);
    const amount = new BitmapText({ text: formatAmount(row.amount), style: AMOUNT_STYLE });
    amount.label = "amount";
    amount.anchor.set(0.5, 0);
    holder.addChild(shadow, icon, abbrev, amount);
    const reach = Math.max(RESOURCE_ICON_PX, abbrev.width, amount.width) / 2;
    rowHalf = Math.max(rowHalf, Math.abs(dx) + reach);
    amountH = Math.max(amountH, amount.height);
    return { cell: { key: row.sprite, icon, shadow, abbrev }, amount };
  });

  const side = nameMarks?.side ?? 0;
  const w = Math.max(plate ? plate.w + 2 * side : 0, 2 * rowHalf);
  if (plate && name) {
    plate.x = (w - plate.w) / 2;
    name.position.set(w / 2 + colonyBarReach(plate.colony) / 2, PLATE_PAD_Y);
    nameMarks?.place(plate.x, 0);
  }
  const rowY = plate ? plate.h + RESOURCE_GAP_PX : 0;
  for (const [i, { cell, amount }] of laid.entries()) {
    const at = resourceCell(i, laid.length, rowY);
    const x = w / 2 + at.x;
    cell.icon.position.set(x, at.iconY);
    cell.shadow.position.set(x + ICON_SHADOW_OFFSET_PX, at.iconY + ICON_SHADOW_OFFSET_PX);
    cell.abbrev.position.set(x, at.abbrevY);
    amount.position.set(x, at.amountY);
  }
  const h = laid.length > 0 ? rowY + RESOURCE_ICON_PX + amountH : (plate?.h ?? 0);
  return { body, holder, plate, marks: nameMarks, cells: laid.map((l) => l.cell), w, h };
}

/**
 * Each body's name on a plate centred under it, placed only where it clears the plates already
 * placed, so the lesser ones drop out as the view zooms out. A moon's plate goes under the moon,
 * or, where that is taken, in a column over its planet's plate. With the Details layer on, the
 * body's resources show under its name, or alone where the Labels layer is off, and a colony's
 * name shows its owner's flag on the game's plate, a pre-FTL world's the pre-FTL icon. The plates
 * shrink a little as the view zooms out.
 */
export class LabelsLayer implements SystemLayer {
  readonly container = new Container();
  private bodies: readonly SceneBody[] = EMPTY_SYSTEM_CONTEXT.bodies;
  private detailsShown = EMPTY_SYSTEM_CONTEXT.sceneLayers.details;
  private labelsShown = EMPTY_SYSTEM_CONTEXT.sceneLayers.labels;
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
      ctx.sceneLayers.details === this.detailsShown &&
      ctx.sceneLayers.labels === this.labelsShown;
    if (same) return;
    if (
      ctx.sceneLayers.details === this.detailsShown &&
      ctx.sceneLayers.labels === this.labelsShown
    ) {
      if (this.move(ctx)) return;
    }
    this.bodies = ctx.bodies;
    this.detailsShown = ctx.sceneLayers.details;
    this.labelsShown = ctx.sceneLayers.labels;
    this.fitRadius = ctx.layout.fitRadius;
    for (const child of this.container.removeChildren()) child.destroy({ children: true });
    this.labels = ctx.bodies
      .flatMap((body) => {
        const named = ctx.sceneLayers.labels && body.name !== "";
        const rows = ctx.sceneLayers.details ? body.resources : [];
        if (!named && rows.length === 0) return [];
        const marks = ctx.sceneLayers.details ? body.marks : NO_MARKS;
        const label = makeLabel(body, named, rows, marks);
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
   * Stands each label by its body where `ctx` puts it, when nothing a label shows changed; false,
   * with nothing moved, otherwise.
   */
  private move(ctx: SystemContext): boolean {
    if (ctx.bodies.length !== this.bodies.length) return false;
    const byId = new Map(ctx.bodies.map((b) => [b.placement.id, b]));
    const alike = (was: SceneBody) => {
      const now = byId.get(was.placement.id);
      return now !== undefined && labelledAlike(was, now);
    };
    if (!this.bodies.every(alike)) return false;
    this.bodies = ctx.bodies;
    this.fitRadius = ctx.layout.fitRadius;
    for (const label of this.labels) label.body = byId.get(label.body.placement.id)!;
    this.drawnRev = -1;
    this.place();
    return true;
  }

  /**
   * The resource icons and name marks once they have landed, and their abbreviations and glyphs
   * where they cannot load. Asks for them again after the cache was cleared, as when game data
   * reloads.
   */
  private redress(): void {
    const wanted = new Set<string>();
    const tex = queuedTextures(wanted);
    for (const { cells, marks } of this.labels) {
      marks?.dress(tex);
      for (const { key, icon, shadow, abbrev } of cells) {
        const texture = tex.texture(key);
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
    const k = plateScaleAt(cam, this.fitRadius);
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
