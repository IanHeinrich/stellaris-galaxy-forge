import { BitmapText, Container, Graphics, Sprite, TextStyle } from "pixi.js";
import {
  type BodyMarks,
  marked,
  NO_MARKS,
  PLATE_PAD_PX,
  sameMarks,
} from "../../../lib/details/layout";
import type { ResourceRow } from "../../../lib/details/resources";
import type { Names } from "../../../lib/names";
import { MAP_FONT } from "../../../lib/visual/style";
import { onTextures, requestTextures } from "../../../lib/visual/textures";
import type { Camera } from "../../Camera";
import { NO_TEXTURES, queuedTextures, type Textures } from "../../layers/details/cell";
import type { Tip } from "../../layers/details/Hover";
import {
  RESOURCE_AMOUNT_PX,
  type ResourceReach,
  resourceIcons,
  type ResourceStyles,
} from "../../layers/details/resources";
import type { FlagContext } from "../../layers/details/ownerFlag";
import type { Row } from "../../layers/details/Row";
import { NAME_STYLE } from "../../layers/nameWidth";
import {
  EMPTY_SYSTEM_CONTEXT,
  type SceneBody,
  type SceneWormhole,
  type SystemContext,
} from "../context";
import { bodyTier, drawnDisc, drawnWormhole } from "../geometry";
import { idOf, pickPlate, type PlatePick } from "../picking";
import { LabelRow } from "./labelRow";
import { placeLabels, plateScaleAt, type LabelItem } from "./labelSlots";
import { NAME_FRAME, NameMarks } from "./nameMarks";
import { colonyBarReach, drawPlate, PLATE_PAD_X, PLATE_PAD_Y, type Plate } from "./plate";
import { NO_HIGHLIGHT, type SceneHighlight, type SystemLayer } from "./SystemLayer";

/** The gap between the plate and the row of icons. */
const RESOURCE_GAP_PX = 2;

/**
 * A marked body's label is drawn as the galaxy draws a system's name row, at this share of that
 * row's size, so a moon's reads smaller than its planet's.
 */
const MARKED_LABEL_SCALE = { star: 1, planet: 1, moon: 0.85 } as const;

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
/** How far a wormhole's glyph stands past its plate, and how far it reaches above and below it. */
const WORMHOLE_GLYPH_GAP_PX = 2;
const WORMHOLE_GLYPH_OVERHANG_PX = 2;
/** A plain body's resource row; a marked body's has the galaxy row's styles. */
const PLAIN_RESOURCE_STYLES: ResourceStyles = { abbrev: ABBREV_STYLE, amount: AMOUNT_STYLE };

/**
 * A body's plate with its name, its resource row, or both, in unscaled pixels from the box's
 * top-left.
 */
interface Label {
  body: SceneBody;
  holder: Container;
  plate: Plate | null;
  /** The marks about its plate; null for a body with none, or none shown. */
  marks: NameMarks | null;
  /** The resources under its plate; null for a body with none, or none shown. */
  resources: LabelRow | null;
  /** Its resource row's styles; unset for the galaxy row's. */
  resourceStyles: ResourceStyles | undefined;
  /** Screen pixels per unscaled pixel at full plate size: 1 for a plain label. */
  scale: number;
  w: number;
  h: number;
}

/**
 * A wormhole's name on a plate, with its kind's glyph at the plate's right end, in unscaled
 * pixels from the box's top-left.
 */
interface WormholeLabel {
  hole: SceneWormhole;
  holder: Container;
  plate: Plate;
  /** The glyph, shown once its texture lands; null for a kind with none. */
  glyph: Sprite | null;
  glyphPx: number;
  w: number;
  h: number;
}

/**
 * Where a wormhole's label takes part in the slotting: its own ids below zero, so none meets a
 * body's, and none is picked as a body's plate.
 */
function wormholeSlot(index: number): number {
  return -1 - index;
}

function styleOf(body: SceneBody): TextStyle {
  if (body.placement.star) return STAR_STYLE;
  return body.moon ? MOON_STYLE : PLANET_STYLE;
}

function markedScale(body: SceneBody): number {
  if (body.placement.star) return MARKED_LABEL_SCALE.star;
  return body.moon ? MARKED_LABEL_SCALE.moon : MARKED_LABEL_SCALE.planet;
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

/** What the labels' tooltips read from `ctx`. */
function tipContext(ctx: SystemContext): FlagContext {
  const { planetClasses, names, templateName, countryName } = ctx;
  return { planetClasses, names, templateName, countryName, table: ctx.ownership.table };
}

/** Whether the tooltips read `ctx` as they read `was`. */
function sameTipContext(was: FlagContext, ctx: SystemContext): boolean {
  return (
    was.planetClasses === ctx.planetClasses &&
    was.names === ctx.names &&
    was.templateName === ctx.templateName &&
    was.countryName === ctx.countryName &&
    was.table === ctx.ownership.table
  );
}

/** Stars first, then planets from the largest, then moons from the largest. */
function rank(a: Label, b: Label): number {
  return bodyTier(a.body) - bodyTier(b.body) || b.body.placement.disc - a.body.placement.disc;
}

/** Draws `rows` into a label's resource row, its middle at x = 0 and its top at 0. */
function drawResources(
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
interface Nameplate {
  plate: Plate;
  name: BitmapText;
  nameY: number;
}

/** `text` in `style` on the galaxy row's plate when `big`, else a snug one, with room for a colony's bar. */
function nameplate(text: string, style: TextStyle, big: boolean, colony: number | null): Nameplate {
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

/** The galaxy's name and plate for a marked body; a smaller name on a snug plate for another. */
function nameplateOf(body: SceneBody, big: boolean): Nameplate {
  return nameplate(body.name, big ? NAME_STYLE : styleOf(body), big, body.colony);
}

/** A wormhole's name on a planet's snug plate, room for its glyph at the right end. */
function makeWormholeLabel(hole: SceneWormhole): WormholeLabel {
  const holder = new Container();
  const { plate, name, nameY } = nameplate(hole.plateName, PLANET_STYLE, false, null);
  holder.addChild(plate.g, name);
  const glyphPx = plate.h + 2 * WORMHOLE_GLYPH_OVERHANG_PX;
  const top = hole.iconKey === null ? 0 : WORMHOLE_GLYPH_OVERHANG_PX;
  plate.g.position.set(0, top);
  name.position.set(plate.w / 2, top + nameY);
  let glyph: Sprite | null = null;
  let w = plate.w;
  if (hole.iconKey !== null) {
    glyph = new Sprite();
    glyph.label = "glyph";
    glyph.anchor.set(0, 0.5);
    glyph.visible = false;
    glyph.position.set(plate.w + WORMHOLE_GLYPH_GAP_PX, top + plate.h / 2);
    holder.addChild(glyph);
    w += WORMHOLE_GLYPH_GAP_PX + glyphPx;
  }
  return { hole, holder, plate, glyph, glyphPx, w, h: plate.h + 2 * top };
}

/**
 * One body's label: its name on a plate when `named`, with `marks` about the plate, and under it
 * the resources in `rows`, each icon over its amount. A named body with marks is drawn at its
 * kind's share of the galaxy's system name row, and a plain one smaller.
 */
function makeLabel(
  body: SceneBody,
  named: boolean,
  rows: readonly ResourceRow[],
  marks: BodyMarks,
  names: Names,
): Label {
  const holder = new Container();
  const big = named && marked(marks);
  const nameplate = named ? nameplateOf(body, big) : null;
  const nameMarks = big && nameplate ? new NameMarks(marks, nameplate.plate.w) : null;
  if (nameplate) {
    if (nameMarks?.under) holder.addChild(nameMarks.under);
    holder.addChild(nameplate.plate.g);
    if (nameMarks) holder.addChild(nameMarks.over);
    holder.addChild(nameplate.name);
  }

  const resourceStyles = big ? undefined : PLAIN_RESOURCE_STYLES;
  let resources: LabelRow | null = null;
  let reach: ResourceReach = { half: 0, height: 0 };
  if (rows.length > 0) {
    resources = new LabelRow("resources");
    reach = drawResources(resources.row, names, NO_TEXTURES, rows, resourceStyles);
    holder.addChild(resources.root);
  }

  const plate = nameplate?.plate ?? null;
  const side = nameMarks?.side ?? 0;
  const top = nameMarks?.above ?? 0;
  const w = Math.max(plate ? plate.w + 2 * side : 0, 2 * reach.half);
  let bottom = 0;
  if (nameplate && plate) {
    plate.x = (w - plate.w) / 2;
    plate.g.position.set(0, top);
    const nameX = w / 2 + colonyBarReach(plate.colony) / 2;
    nameplate.name.position.set(nameX, top + nameplate.nameY);
    nameMarks?.place(plate.x, top);
    bottom = top + plate.h;
  }
  const rowY = plate ? bottom + RESOURCE_GAP_PX : 0;
  resources?.root.position.set(w / 2, rowY);
  const h = Math.max(bottom + (nameMarks?.below ?? 0), resources ? rowY + reach.height : 0);
  const scale = big ? markedScale(body) : 1;
  return { body, holder, plate, marks: nameMarks, resources, resourceStyles, scale, w, h };
}

/**
 * Each body's name on a plate centred under it, placed only where it clears the plates already
 * placed, so the lesser ones drop out as the view zooms out. A moon's plate goes under the moon,
 * or, where that is taken, in a column over its planet's plate. With the Details layer on, the
 * body's resources show under its name, or alone where the Labels layer is off. A colony's name
 * shows its owner's flag on the game's plate, and a body's name the icons of its megastructures,
 * dig sites, anomaly and pre-FTL civilisation, each with its tooltip. A name with marks is drawn
 * the size of the galaxy's system name row, a moon's a little smaller. The plates shrink a little
 * as the view zooms out. With the Labels layer on, each wormhole's name shows on a plate under it
 * with its kind's glyph, slotted with the bodies' plates.
 */
export class LabelsLayer implements SystemLayer {
  readonly container = new Container();
  private bodies: readonly SceneBody[] = EMPTY_SYSTEM_CONTEXT.bodies;
  private tips: FlagContext = tipContext(EMPTY_SYSTEM_CONTEXT);
  private detailsShown = EMPTY_SYSTEM_CONTEXT.sceneLayers.details;
  private labelsShown = EMPTY_SYSTEM_CONTEXT.sceneLayers.labels;
  private fitRadius = EMPTY_SYSTEM_CONTEXT.layout.fitRadius;
  private labels: Label[] = [];
  /** The labels of bodies that are not moons of a labelled planet, which head their groups. */
  private heads: Label[] = [];
  /** Each labelled planet's moons' labels, the outermost orbit first. */
  private moonsOf = new Map<number, Label[]>();
  private wormholes: readonly SceneWormhole[] = EMPTY_SYSTEM_CONTEXT.wormholes;
  private wormholeLabels: WormholeLabel[] = [];
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

  /**
   * The tooltip of the mark or resource under the screen point on `body`'s shown label; null for
   * none, and where another body's disc or plate is what the pointer is over.
   */
  tipAt(body: number, sx: number, sy: number): Tip | null {
    const cam = this.cam;
    if (!cam) return null;
    const plate = this.shown.find((p) => p.id === body);
    const label = this.labels.find((l) => l.body.placement.id === body);
    if (!plate || !label || pickPlate([plate], cam, { x: sx, y: sy }) === null) return null;
    const top = cam.worldToScreen(plate.x, plate.y);
    const k = plateScaleAt(cam, this.fitRadius) * label.scale;
    const x = (sx - top.x) / k;
    const y = (sy - top.y) / k;
    return label.marks?.tipAt(x, y) ?? label.resources?.tipAt(x, y) ?? null;
  }

  rebuild(ctx: SystemContext): void {
    const switched =
      ctx.sceneLayers.details !== this.detailsShown || ctx.sceneLayers.labels !== this.labelsShown;
    if (!switched) {
      const holesMoved = ctx.wormholes !== this.wormholes;
      if (holesMoved) this.labelWormholes(ctx);
      if (ctx.bodies === this.bodies) {
        if (holesMoved) {
          this.drawnRev = -1;
          this.place();
        }
        return;
      }
      if (this.move(ctx)) return;
    }
    this.bodies = ctx.bodies;
    this.tips = tipContext(ctx);
    this.detailsShown = ctx.sceneLayers.details;
    this.labelsShown = ctx.sceneLayers.labels;
    this.fitRadius = ctx.layout.fitRadius;
    for (const child of this.container.removeChildren()) child.destroy({ children: true });
    this.wormholeLabels = [];
    this.labels = ctx.bodies
      .flatMap((body) => {
        const named = ctx.sceneLayers.labels && body.name !== "";
        const rows = ctx.sceneLayers.details ? body.resources : [];
        if (!named && rows.length === 0) return [];
        const marks = ctx.sceneLayers.details ? body.marks : NO_MARKS;
        const label = makeLabel(body, named, rows, marks, ctx.names);
        this.container.addChild(label.holder);
        return [label];
      })
      .sort(rank);
    this.group();
    for (const label of this.labels) this.mark(label);
    this.labelWormholes(ctx);
    this.shown = [];
    this.redress();
    this.drawnRev = -1;
    this.place();
  }

  /**
   * A label for each of `ctx`'s wormholes while the Labels layer is on; the same labels, stood at
   * the wormholes' new points, when only where they stand changed.
   */
  private labelWormholes(ctx: SystemContext): void {
    const holes = ctx.sceneLayers.labels ? ctx.wormholes : [];
    this.wormholes = ctx.wormholes;
    const alike =
      holes.length === this.wormholeLabels.length &&
      this.wormholeLabels.every(
        (l, i) => l.hole.id === holes[i].id && l.hole.plateName === holes[i].plateName,
      );
    if (alike) {
      this.wormholeLabels.forEach((l, i) => (l.hole = holes[i]));
      return;
    }
    for (const label of this.wormholeLabels) label.holder.destroy({ children: true });
    this.wormholeLabels = holes.map((hole) => {
      const label = makeWormholeLabel(hole);
      this.container.addChild(label.holder);
      this.markWormhole(label);
      return label;
    });
    this.redress();
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
    const stale =
      !sameTipContext(this.tips, ctx) ||
      this.labels.some((l) => byId.get(l.body.placement.id)?.planet !== l.body.planet);
    this.bodies = ctx.bodies;
    this.fitRadius = ctx.layout.fitRadius;
    for (const label of this.labels) label.body = byId.get(label.body.placement.id)!;
    this.group();
    if (stale) {
      this.tips = tipContext(ctx);
      this.redress();
    }
    this.drawnRev = -1;
    this.place();
    return true;
  }

  /** Puts each moon's label in a group under its planet's, where its planet has one. */
  private group(): void {
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
    this.moonsOf = moonsOf;
    this.heads = this.labels.filter((l) => parentOf(l) === null);
  }

  /**
   * The resource icons and name marks once they have landed, and their abbreviations and glyphs
   * where they cannot load. Asks for them again after the cache was cleared, as when game data
   * reloads.
   */
  private redress(): void {
    const wanted = new Set<string>();
    const tex = queuedTextures(wanted);
    for (const { body, marks, resources, resourceStyles } of this.labels) {
      marks?.dress(tex, body.marks, this.tips);
      if (!resources) continue;
      drawResources(resources.row, this.tips.names, tex, body.resources, resourceStyles);
    }
    for (const { hole, glyph, glyphPx } of this.wormholeLabels) {
      if (!glyph || hole.iconKey === null) continue;
      const texture = tex.texture(hole.iconKey);
      glyph.visible = Boolean(texture);
      if (!texture) continue;
      glyph.texture = texture;
      glyph.scale.set(glyphPx / Math.max(texture.width, texture.height, 1));
    }
    if (wanted.size > 0) requestTextures(wanted);
  }

  setHighlighted(ref: SceneHighlight): void {
    const was = this.ref;
    const hovered = idOf(ref.hover, "body");
    const wasHovered = idOf(was.hover, "body");
    const hoverMoved = hovered !== wasHovered;
    const changed = hoverMoved || ref.selectedBody !== was.selectedBody;
    if (hoverMoved) {
      // Only a hidden plate is brought out: a shown one may be under the pointer, and pinning could move it away.
      this.hoverPinned = hovered !== null && !this.shown.some((plate) => plate.id === hovered);
    }
    this.ref = ref;
    const holeSelected = ref.selectedWormhole !== was.selectedWormhole;
    if (idOf(ref.hover, "wormhole") !== idOf(was.hover, "wormhole") || holeSelected) {
      for (const label of this.wormholeLabels) this.markWormhole(label);
    }
    if (holeSelected && !changed) this.place();
    if (!changed) return;
    const touched = [wasHovered, was.selectedBody, hovered, ref.selectedBody];
    for (const label of this.labels) {
      if (touched.includes(label.body.placement.id)) this.mark(label);
    }
    this.place();
  }

  private mark({ body, plate }: Label): void {
    if (!plate) return;
    const id = body.placement.id;
    const hovered = idOf(this.ref.hover, "body");
    const state = id === this.ref.selectedBody ? "selected" : id === hovered ? "hovered" : "rest";
    drawPlate(plate, state);
  }

  private markWormhole({ hole, plate }: WormholeLabel): void {
    const state =
      hole.id === this.ref.selectedWormhole
        ? "selected"
        : hole.id === idOf(this.ref.hover, "wormhole")
          ? "hovered"
          : "rest";
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
    const moonsOfLabel = (l: Label) => this.moonsOf.get(l.body.placement.id) ?? [];
    const hovered = idOf(this.ref.hover, "body");
    const pinned = (l: Label) => {
      const id = l.body.placement.id;
      return id === this.ref.selectedBody || (this.hoverPinned && id === hovered);
    };
    const groupPinned = (l: Label) => pinned(l) || moonsOfLabel(l).some(pinned);
    const heads = this.heads;
    const order = [...heads.filter(groupPinned), ...heads.filter((l) => !groupPinned(l))];
    const item = (l: Label): LabelItem => {
      const { x, y, disc } = l.body.placement;
      const at = cam.worldToScreen(x, y);
      return {
        id: l.body.placement.id,
        x: at.x,
        y: at.y,
        r: drawnDisc(disc, cam.scale, l.body.look) * cam.scale,
        w: l.w * k * l.scale,
        h: l.h * k * l.scale,
      };
    };
    const withMoons = (l: Label) => ({ ...item(l), moons: moonsOfLabel(l).map(item) });
    const holes = this.wormholeLabels.map((l, i): LabelItem => {
      const at = cam.worldToScreen(l.hole.x, l.hole.y);
      const r = drawnWormhole(cam.scale) * cam.scale;
      return { id: wormholeSlot(i), x: at.x, y: at.y, r, w: l.w * k, h: l.h * k };
    });
    const chosen = this.wormholeLabels.findIndex((l) => l.hole.id === this.ref.selectedWormhole);
    const selectedHole = (item: LabelItem) => chosen >= 0 && item.id === wormholeSlot(chosen);
    const items = [
      ...holes.filter(selectedHole),
      ...order.filter(groupPinned).map(withMoons),
      ...holes.filter((item) => !selectedHole(item)),
      ...order.filter((l) => !groupPinned(l)).map(withMoons),
    ];
    const boxes = placeLabels(items).map((box) => {
      const at = cam.screenToWorld(box.x, box.y);
      return { id: box.id, x: at.x, y: at.y, w: box.w, h: box.h };
    });
    this.shown = boxes.filter((box) => box.id >= 0);
    const size = cam.childScale(k);
    this.wormholeLabels.forEach(({ holder }, i) => {
      const box = boxes.find((b) => b.id === wormholeSlot(i));
      holder.visible = box !== undefined;
      if (!box) return;
      holder.position.set(box.x, box.y);
      holder.scale.set(size.x, size.y);
    });
    const shown = new Map(this.shown.map((plate) => [plate.id, plate]));
    for (const { body, holder, scale } of this.labels) {
      const plate = shown.get(body.placement.id);
      holder.visible = plate !== undefined;
      if (!plate) continue;
      const size = cam.childScale(k * scale);
      holder.position.set(plate.x, plate.y);
      holder.scale.set(size.x, size.y);
    }
  }

  destroy(): void {
    this.unsubTextures();
    this.container.destroy({ children: true });
  }
}
