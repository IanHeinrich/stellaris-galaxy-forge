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
import { RingBatch, type RingSpec } from "./highlights/RingBatch";
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

/**
 * A save's system heights: a ring round every system off the plane, amber above and blue below,
 * heavier the further it is, and its signed height beside it once names show. While the map is
 * tilted each lifted system also drops a line to a hexagon on the plane under it. A system on
 * the plane draws nothing. A system whose height the inspector previews is drawn on its own,
 * so a slider drag redraws that system and nothing else.
 */
export class HeightsLayer implements MapLayer {
  readonly id = "heights" as const;
  readonly container = new Container();
  private readonly plane = new Graphics({ label: "plane" });
  private readonly rings = new Container({ label: "rings" });
  private readonly previewPlane = new Graphics({ label: "previewPlane" });
  private readonly previewRings = new Container({ label: "previewRings" });
  private readonly values = new Container({ label: "values" });
  private readonly batches = new Map<string, RingBatch>();
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

  constructor(private readonly drawn = new DrawnPositions()) {
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
    this.readPreview();
    this.placeRings();
    this.drawPlane();
    this.drawPreview();
    this.releaseValues();
  }

  applyDelta(): void {
    // A delta comes with a fresh context, and `rebuild` reads the heights from that.
  }

  /** A new lean moves every ring and drop; a preview redraws only its own systems. */
  onDrawn({ heights, leaned }: DrawnChange): void {
    const preview = this.drawn.preview;
    const entered = [...heights].some((id) => this.preview.has(id) !== preview.has(id));
    this.readPreview();
    if (leaned || entered) {
      this.placeRings();
      this.drawPlane();
    }
    this.drawPreview();
    for (const id of heights) this.placeValue(id);
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    for (const batch of this.batches.values()) batch.setScale(this.scale);
    for (const mark of this.previewMarks.values()) mark.scale.set(this.scale.x, this.scale.y);
    cam.childScale(1, this.valueScale);
    if (cam.scale !== this.camScale) {
      this.camScale = cam.scale;
      this.drawPlane();
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
    for (const batch of this.batches.values()) batch.destroy();
  }

  private readPreview(): void {
    this.preview = this.drawn.preview;
    this.previewed.clear();
    for (const [id, height] of this.preview) {
      const node = this.systems.get(id);
      const entry = node && liftedOf(node, height);
      if (entry) this.previewed.set(id, entry);
    }
  }

  /** The system off the plane as the map shows it now, previewed or stored; null on the plane. */
  private entryOf(id: number): Lifted | null {
    if (this.preview.has(id)) return this.previewed.get(id) ?? null;
    return this.stored.get(id) ?? null;
  }

  /** The stored entries the batches and the plane draw: every one the preview leaves alone. */
  private *settled(): Iterable<Lifted> {
    for (const entry of this.stored.values()) {
      if (!this.preview.has(entry.node.id)) yield entry;
    }
  }

  private at(entry: Lifted): Pt {
    return this.drawn.at(entry.node);
  }

  /** One batch per tint and weight, each ringing its systems where they draw. */
  private placeRings(): void {
    const wanted = new Map<string, { spec: RingSpec; points: Pt[] }>();
    for (const entry of this.settled()) {
      const level = levelOf(entry.height);
      const key = `${entry.tint}:${level}`;
      let group = wanted.get(key);
      if (!group) {
        group = { spec: ringSpec(entry.tint, level), points: [] };
        wanted.set(key, group);
      }
      group.points.push(this.at(entry));
    }
    for (const [key, batch] of this.batches) {
      if (wanted.has(key)) continue;
      this.rings.removeChild(batch.container);
      batch.container.destroy({ children: true });
      batch.destroy();
      this.batches.delete(key);
    }
    for (const [key, { spec, points }] of wanted) {
      let batch = this.batches.get(key);
      if (!batch) {
        batch = new RingBatch(spec, `height.${key}`);
        batch.setScale(this.scale);
        this.batches.set(key, batch);
        this.rings.addChild(batch.container);
      }
      batch.place(points);
    }
  }

  /** The tilted map's drop lines and the hexagons on the plane they fall to, by tint. */
  private drawPlane(): void {
    this.plane.clear();
    if (!this.drawn.leans || this.camScale <= 0) return;
    const tints = new Set<number>();
    for (const entry of this.settled()) tints.add(entry.tint);
    for (const tint of tints) this.drawDrops(this.plane, this.settled(), tint);
  }

  /** The lines and hexagons of `entries` of one tint, stroked as two paths. */
  private drawDrops(g: Graphics, entries: Iterable<Lifted>, tint: number): void {
    const r = HEX_PX / this.camScale;
    const ofTint = [...entries].filter((entry) => entry.tint === tint);
    for (const entry of ofTint) {
      const { x, y } = entry.node;
      g.moveTo(x, y).lineTo(x, this.drawn.y(entry.node));
    }
    g.stroke({ color: tint, alpha: DROP_ALPHA, pixelLine: true });
    for (const entry of ofTint) {
      const { x, y } = entry.node;
      g.moveTo(x + r, y);
      for (let k = 1; k <= 6; k++) {
        const a = (k * Math.PI) / 3;
        g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
    }
    g.stroke({ color: tint, alpha: HEX_ALPHA, width: 1, pixelLine: true });
  }

  /** Each previewed system's ring, and its drop line while tilted, at the height it previews. */
  private drawPreview(): void {
    for (const [id, mark] of this.previewMarks) {
      if (this.previewed.has(id)) continue;
      mark.destroy();
      this.previewMarks.delete(id);
    }
    for (const [id, entry] of this.previewed) {
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
    this.previewPlane.clear();
    if (!this.drawn.leans || this.camScale <= 0) return;
    for (const entry of this.previewed.values()) {
      this.drawDrops(this.previewPlane, [entry], entry.tint);
    }
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
