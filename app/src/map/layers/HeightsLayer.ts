import { BitmapText, Container, Graphics, TextStyle } from "pixi.js";
import type { SystemNode } from "../../generated/SystemNode";
import type { Pt } from "../../lib/geometry/pt";
import {
  heightStrength,
  heightTint,
  isFlat,
  NO_HEIGHT_PREVIEW,
  relativeHeight,
  type HeightPreview,
} from "../../lib/height";
import { labelTier } from "../../lib/visual/labels";
import { MAP_FONT, RING_RADIUS } from "../../lib/visual/style";
import type { Camera } from "../Camera";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { DrawnPositions, type DrawnChange } from "../drawnPositions";
import { RingBatches, type RingSpec, type WantedRings } from "./highlights/RingBatch";
import { markerScale, type MapLayer } from "./MapLayer";

/** How many steps a ring's weight takes from barely off the plane to a full height. */
const LEVELS = 4;
/** The plane mark under a lifted system, and the line down to it. */
const HEX_PX = 5;
const DROP_ALPHA = 0.45;
const HEX_ALPHA = 0.7;
/** The most height values written at once. */
const MAX_VALUES = 300;
/** Screen margin around the view within which a value is still written. */
const VIEW_PAD_PX = 64;
/** Below this a height is written to two decimals, so a ringed system never reads as 0. */
const FINE_BELOW = 0.05;

/** One shared instance: PixiJS keys a stroked dynamic bitmap font by the style object. */
const VALUE_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 11,
  fontWeight: "600",
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 3 },
});

interface Lifted {
  readonly node: SystemNode;
  readonly height: number;
  readonly tint: number;
}

/** The stored systems of one tint and weight, and their drops while tilted. */
interface Group {
  readonly tint: number;
  readonly entries: Lifted[];
  readonly drops: Graphics;
}

/** A height as the map writes it beside the ring: signed, to one decimal, or two near flat. */
export function heightText(relative: number): string {
  const places = Math.abs(relative) < FINE_BELOW ? 100 : 10;
  const size = Math.round(Math.abs(relative) * places) / places;
  return `${relative < 0 ? "−" : "+"}${size}`;
}

function levelOf(height: number): number {
  return Math.max(1, Math.ceil(heightStrength(height) * LEVELS));
}

function ringSpec(tint: number, level: number): RingSpec {
  return {
    color: tint,
    radius: RING_RADIUS.height,
    width: 1 + level * 0.5,
    alpha: 0.3 + (0.7 * level) / LEVELS,
  };
}

function liftedOf(node: SystemNode, height: number): Lifted | null {
  return isFlat(height) ? null : { node, height, tint: heightTint(height) };
}

function groupKey(entry: Lifted): string {
  return `${entry.tint}:${levelOf(entry.height)}`;
}

/**
 * A save's system heights: a ring round every system off the plane, amber above and blue below,
 * heavier the further it is, and its signed height beside it once names show. While the map is
 * tilted each lifted system also drops a line to a hexagon on the plane under it. A system on
 * the plane draws nothing. A system whose height is previewed is drawn on its own, so a change
 * of preview redraws the systems it changed and the group of rings each one left or rejoined.
 */
export class HeightsLayer implements MapLayer {
  readonly id = "heights" as const;
  readonly container = new Container();
  private readonly plane = new Container({ label: "plane" });
  private readonly rings = new Container({ label: "rings" });
  private readonly previewPlane = new Graphics({ label: "previewPlane" });
  private readonly previewRings = new Container({ label: "previewRings" });
  private readonly values = new Container({ label: "values" });
  private readonly batches = new RingBatches(this.rings, "height.");
  private readonly groups = new Map<string, Group>();
  private readonly shown = new Map<number, BitmapText>();
  private readonly free: BitmapText[] = [];
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  /** Every system off the plane at its stored height. */
  private stored = new Map<number, Lifted>();
  /** The preview drawn last, so a change can tell the systems that entered or left it. */
  private preview: HeightPreview = NO_HEIGHT_PREVIEW;
  /** The previewed systems off the plane at the height the preview shows, by id. */
  private readonly previewed = new Map<number, Lifted>();
  private readonly previewMarks = new Map<number, Graphics>();
  private camScale = -1;
  private visible = true;
  /** Whether values are written at this zoom, and how far up and right of the star they sit. */
  private named = false;
  private valueOffset = 0;
  private readonly scale = { x: 1, y: 1 };
  private readonly valueScale = { x: 1, y: 1 };
  private readonly bounds = [0, 0, 0, 0];

  constructor(private readonly drawn: DrawnPositions) {
    this.container.addChild(
      this.plane,
      this.previewPlane,
      this.rings,
      this.previewRings,
      this.values,
    );
  }

  rebuild(ctx: RenderContext): void {
    if (ctx.galaxy === this.galaxy && ctx.systems === this.systems) return;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    this.stored = new Map();
    for (const node of ctx.systems.values()) {
      const entry = liftedOf(node, relativeHeight(node.height));
      if (entry) this.stored.set(node.id, entry);
    }
    this.preview = this.drawn.preview;
    this.previewed.clear();
    for (const id of this.preview.keys()) this.readPreview(id);
    this.regroup();
    this.drawPreview();
    this.releaseValues();
  }

  applyDelta(): void {
    // A delta comes with a fresh context, and `rebuild` reads the heights from that.
  }

  /** A new lean moves every ring and drop; a preview redraws only what it changed. */
  onDrawn({ heights, leaned }: DrawnChange): void {
    const before = this.preview;
    this.preview = this.drawn.preview;
    const regrouped = new Set<string>();
    for (const id of heights) {
      this.readPreview(id);
      const stored = this.stored.get(id);
      if (stored && before.has(id) !== this.preview.has(id)) regrouped.add(groupKey(stored));
    }
    for (const key of leaned ? this.groups.keys() : regrouped) this.drawGroup(key);
    this.drawPreview(leaned ? undefined : heights);
    for (const id of heights) this.placeValue(id);
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    this.batches.setScale(this.scale);
    for (const mark of this.previewMarks.values()) mark.scale.set(this.scale.x, this.scale.y);
    cam.childScale(1, this.valueScale);
    if (cam.scale !== this.camScale) {
      this.camScale = cam.scale;
      for (const group of this.groups.values()) this.drawDrops(group);
      this.drawPreview();
    }
    this.placeValues(cam);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.batches.destroy();
  }

  /** Reads the height the preview shows for system `id`, kept while it is off the plane. */
  private readPreview(id: number): void {
    const height = this.preview.get(id);
    const node = height === undefined ? undefined : this.systems.get(id);
    const entry = node && height !== undefined ? liftedOf(node, height) : null;
    if (entry) this.previewed.set(id, entry);
    else this.previewed.delete(id);
  }

  /** The system off the plane as the map shows it now, previewed or stored; null on the plane. */
  private entryOf(id: number): Lifted | null {
    if (this.preview.has(id)) return this.previewed.get(id) ?? null;
    return this.stored.get(id) ?? null;
  }

  /** The stored entries the rings and the plane draw: every one the preview leaves alone. */
  private *settled(entries: Iterable<Lifted> = this.stored.values()): Iterable<Lifted> {
    for (const entry of entries) {
      if (!this.preview.has(entry.node.id)) yield entry;
    }
  }

  private at(entry: Lifted): Pt {
    return this.drawn.at(entry.node);
  }

  /** Sorts the stored entries into a group per tint and weight, and draws every group. */
  private regroup(): void {
    const wanted = new Map<string, Lifted[]>();
    for (const entry of this.stored.values()) {
      const key = groupKey(entry);
      const entries = wanted.get(key);
      if (entries) entries.push(entry);
      else wanted.set(key, [entry]);
    }
    const rings = new Map<string, WantedRings>();
    for (const [key, entries] of wanted) {
      rings.set(key, {
        spec: ringSpec(entries[0].tint, levelOf(entries[0].height)),
        points: this.settledPoints(entries),
      });
    }
    this.batches.sync(rings);
    for (const [key, group] of this.groups) {
      if (wanted.has(key)) continue;
      this.plane.removeChild(group.drops);
      group.drops.destroy();
      this.groups.delete(key);
    }
    for (const [key, entries] of wanted) {
      let group = this.groups.get(key);
      if (group) {
        group.entries.splice(0, group.entries.length, ...entries);
      } else {
        group = {
          tint: entries[0].tint,
          entries,
          drops: new Graphics({ label: `plane.${key}` }),
        };
        this.groups.set(key, group);
        this.plane.addChild(group.drops);
      }
      this.drawDrops(group);
    }
  }

  /** One group's rings where its systems draw, and their drops; a previewed system is left out. */
  private drawGroup(key: string): void {
    const group = this.groups.get(key);
    if (!group) return;
    this.batches.place(key, this.settledPoints(group.entries));
    this.drawDrops(group);
  }

  private settledPoints(entries: Iterable<Lifted>): Pt[] {
    return [...this.settled(entries)].map((entry) => this.at(entry));
  }

  /** The tilted map's drop lines from a group's systems, and the hexagons on the plane they fall to. */
  private drawDrops(group: Group): void {
    group.drops.clear();
    if (!this.drawn.leans || this.camScale <= 0) return;
    this.drawLines(group.drops, this.settled(group.entries), group.tint);
  }

  /** The lines and hexagons of `entries`, all of one tint, stroked as two paths. */
  private drawLines(g: Graphics, entries: Iterable<Lifted>, tint: number): void {
    const r = HEX_PX / this.camScale;
    const drawn = [...entries];
    if (drawn.length === 0) return;
    for (const entry of drawn) {
      const { x, y } = entry.node;
      g.moveTo(x, y).lineTo(x, this.drawn.y(entry.node));
    }
    g.stroke({ color: tint, alpha: DROP_ALPHA, pixelLine: true });
    for (const entry of drawn) {
      const { x, y } = entry.node;
      g.moveTo(x + r, y);
      for (let k = 1; k <= 6; k++) {
        const a = (k * Math.PI) / 3;
        g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
    }
    g.stroke({ color: tint, alpha: HEX_ALPHA, width: 1, pixelLine: true });
  }

  /**
   * The ring of each previewed system among `ids`, or of every one without them, at the height
   * it previews, and every previewed system's drop line while tilted.
   */
  private drawPreview(ids?: Iterable<number>): void {
    if (ids === undefined) {
      for (const id of this.previewMarks.keys()) {
        if (!this.previewed.has(id)) this.dropMark(id);
      }
    }
    for (const id of ids ?? this.previewed.keys()) {
      const entry = this.previewed.get(id);
      if (entry) this.drawMark(id, entry);
      else this.dropMark(id);
    }
    this.previewPlane.clear();
    if (!this.drawn.leans || this.camScale <= 0) return;
    for (const entry of this.previewed.values()) {
      this.drawLines(this.previewPlane, [entry], entry.tint);
    }
  }

  private drawMark(id: number, entry: Lifted): void {
    let mark = this.previewMarks.get(id);
    if (!mark) {
      mark = new Graphics({ label: `preview.${id}` });
      this.previewMarks.set(id, mark);
      this.previewRings.addChild(mark);
    }
    const spec = ringSpec(entry.tint, levelOf(entry.height));
    mark.clear().circle(0, 0, spec.radius).stroke(spec);
    const { x, y } = this.at(entry);
    mark.position.set(x, y);
    mark.scale.set(this.scale.x, this.scale.y);
  }

  private dropMark(id: number): void {
    const mark = this.previewMarks.get(id);
    if (!mark) return;
    mark.destroy();
    this.previewMarks.delete(id);
  }

  /** Each lifted system's signed height up and right of its ring, while names show. */
  private placeValues(cam: Camera): void {
    this.named = this.visible && labelTier(cam.scale) !== "none";
    if (!this.named) {
      this.releaseValues();
      return;
    }
    const pad = VIEW_PAD_PX / cam.scale;
    const [minX, minY, maxX, maxY] = cam.worldBounds(this.bounds);
    this.valueOffset = RING_RADIUS.height * markerScale(cam.scale) * 0.8;
    const wanted = new Set<number>();
    const consider = (entry: Lifted) => {
      if (wanted.size >= MAX_VALUES) return;
      const at = this.at(entry);
      if (at.x < minX - pad || at.x > maxX + pad || at.y < minY - pad || at.y > maxY + pad) {
        return;
      }
      wanted.add(entry.node.id);
      this.write(entry, at);
    };
    for (const entry of this.previewed.values()) consider(entry);
    for (const entry of this.settled()) consider(entry);
    for (const [id, value] of this.shown) {
      if (wanted.has(id)) continue;
      this.shown.delete(id);
      this.release(value);
    }
  }

  /** System `id`'s value alone, after its previewed height moved. */
  private placeValue(id: number): void {
    const entry = this.named ? this.entryOf(id) : null;
    if (entry) {
      this.write(entry, this.at(entry));
      return;
    }
    const value = this.shown.get(id);
    if (!value) return;
    this.shown.delete(id);
    this.release(value);
  }

  private write(entry: Lifted, at: Pt): void {
    let value = this.shown.get(entry.node.id);
    if (!value) {
      value = this.free.pop() ?? this.make();
      value.visible = true;
      this.shown.set(entry.node.id, value);
    }
    const text = heightText(entry.height);
    if (value.text !== text) value.text = text;
    value.tint = entry.tint;
    value.position.set(at.x, at.y);
    value.scale.set(this.valueScale.x, this.valueScale.y);
    value.pivot.set(-this.valueOffset, this.valueOffset);
  }

  private make(): BitmapText {
    const value = new BitmapText({ text: "", style: VALUE_STYLE });
    value.anchor.set(0, 1);
    this.values.addChild(value);
    return value;
  }

  private release(value: BitmapText): void {
    value.visible = false;
    this.free.push(value);
  }

  private releaseValues(): void {
    for (const value of this.shown.values()) this.release(value);
    this.shown.clear();
  }
}
