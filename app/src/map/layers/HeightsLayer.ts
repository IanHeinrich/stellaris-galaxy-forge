import { BitmapText, Container, Graphics, TextStyle } from "pixi.js";
import type { SystemNode } from "../../generated/SystemNode";
import type { Pt } from "../../lib/geometry/pt";
import { heightStrength, heightTint, isFlat } from "../../lib/height";
import { labelTier } from "../../lib/visual/labels";
import { MAP_FONT, RING_RADIUS } from "../../lib/visual/style";
import type { Camera } from "../Camera";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { FLAT_TILT, isTilted, liftedY, systemHeight, type Tilt } from "../tilt";
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

/** A height as the map writes it beside the ring: signed, to one decimal at most. */
export function heightText(relative: number): string {
  const size = Math.round(Math.abs(relative) * 10) / 10;
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

/**
 * A save's system heights: a ring round every system off the plane, amber above and blue below,
 * heavier the further it is, and its signed height beside it once names show. While the map is
 * tilted each lifted system also drops a line to a hexagon on the plane under it. A system on
 * the plane draws nothing.
 */
export class HeightsLayer implements MapLayer {
  readonly id = "heights" as const;
  readonly container = new Container();
  private readonly plane = new Graphics({ label: "plane" });
  private readonly rings = new Container({ label: "rings" });
  private readonly values = new Container({ label: "values" });
  private readonly batches = new Map<string, RingBatch>();
  private readonly shown = new Map<number, BitmapText>();
  private readonly free: BitmapText[] = [];
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private lifted: Lifted[] = [];
  private tilt: Tilt = FLAT_TILT;
  private camScale = -1;
  private readonly scale = { x: 1, y: 1 };
  private readonly valueScale = { x: 1, y: 1 };
  private readonly bounds = [0, 0, 0, 0];

  constructor() {
    this.container.addChild(this.plane, this.rings, this.values);
  }

  rebuild(ctx: RenderContext): void {
    if (ctx.galaxy === this.galaxy && ctx.systems === this.systems) return;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    this.lifted = [];
    for (const node of ctx.systems.values()) {
      const height = systemHeight(node);
      if (!isFlat(height)) this.lifted.push({ node, height, tint: heightTint(height) });
    }
    this.placeRings();
    this.drawPlane();
    this.releaseValues();
  }

  applyDelta(): void {
    // A delta comes with a fresh context, and `rebuild` reads the heights from that.
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    for (const batch of this.batches.values()) batch.setScale(this.scale);
    cam.childScale(1, this.valueScale);
    const tilted = cam.tilt !== this.tilt;
    const zoomed = cam.scale !== this.camScale;
    this.tilt = cam.tilt;
    this.camScale = cam.scale;
    if (tilted) this.placeRings();
    if (tilted || (zoomed && isTilted(this.tilt))) this.drawPlane();
    this.placeValues(cam);
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    for (const batch of this.batches.values()) batch.destroy();
  }

  private at(entry: Lifted): Pt {
    return { x: entry.node.x, y: liftedY(entry.node.y, entry.height, this.tilt) };
  }

  /** One batch per tint and weight, each ringing its systems where they draw. */
  private placeRings(): void {
    const wanted = new Map<string, { spec: RingSpec; points: Pt[] }>();
    for (const entry of this.lifted) {
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
    const g = this.plane;
    g.clear();
    if (!isTilted(this.tilt) || this.camScale <= 0) return;
    const r = HEX_PX / this.camScale;
    const tints = new Set(this.lifted.map((entry) => entry.tint));
    for (const tint of tints) {
      for (const entry of this.lifted) {
        if (entry.tint !== tint) continue;
        const { x, y } = entry.node;
        g.moveTo(x, y).lineTo(x, liftedY(y, entry.height, this.tilt));
      }
      g.stroke({ color: tint, alpha: DROP_ALPHA, pixelLine: true });
      for (const entry of this.lifted) {
        if (entry.tint !== tint) continue;
        const { x, y } = entry.node;
        g.moveTo(x + r, y);
        for (let k = 1; k <= 6; k++) {
          const a = (k * Math.PI) / 3;
          g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
        }
      }
      g.stroke({ color: tint, alpha: HEX_ALPHA, width: 1, pixelLine: true });
    }
  }

  /** Each lifted system's signed height up and right of its ring, while names show. */
  private placeValues(cam: Camera): void {
    if (labelTier(cam.scale) === "none") {
      this.releaseValues();
      return;
    }
    const pad = VIEW_PAD_PX / cam.scale;
    const [minX, minY, maxX, maxY] = cam.worldBounds(this.bounds);
    const offset = RING_RADIUS.height * markerScale(cam.scale) * 0.8;
    const wanted = new Set<number>();
    for (const entry of this.lifted) {
      if (wanted.size >= MAX_VALUES) break;
      const at = this.at(entry);
      if (at.x < minX - pad || at.x > maxX + pad || at.y < minY - pad || at.y > maxY + pad) {
        continue;
      }
      wanted.add(entry.node.id);
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
      value.pivot.set(-offset, offset);
    }
    for (const [id, value] of this.shown) {
      if (wanted.has(id)) continue;
      this.shown.delete(id);
      this.release(value);
    }
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
