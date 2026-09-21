import { Container, Graphics } from "pixi.js";
import { smoothRegion, type Region } from "../../lib/geometry/territory";
import type { OwnerColors } from "../../lib/visual/ownerColors";
import { GHOST_ALPHA } from "../../lib/visual/style";

/** How a territory is painted, shared by every layer that paints one so they read alike. */
export const TERRITORY_FILL_ALPHA = 0.55;
export const TERRITORY_EDGE_PX = 6;
export const TERRITORY_EDGE_ALPHA = 0.95;
export const TERRITORY_HALO_PX = 10;
export const TERRITORY_HALO_ALPHA = 0.25;
/** Strokes hold their screen width until a pixel spans this many world units, then stop growing. */
const STROKE_MAX_UNIT = 2;
/** The stroke width is snapped to steps of √2 so zooming redraws it rarely. */
const STROKE_STEPS_PER_OCTAVE = 2;

export interface TerritoryShape {
  region: Region;
  /** The drawn outline: `region` with its corners rounded off. */
  smoothed: Region;
  colors: OwnerColors;
  fill: Graphics;
  edge: Graphics;
}

/** World units per screen pixel for the strokes, capped and snapped. */
function strokeUnit(camScale: number): number {
  const wanted = Math.min(STROKE_MAX_UNIT, 1 / camScale);
  const step = Math.round(Math.log2(wanted) * STROKE_STEPS_PER_OCTAVE);
  return Math.pow(2, step / STROKE_STEPS_PER_OCTAVE);
}

/**
 * The territories one layer paints: each region with its corners rounded, filled with its fill
 * colour and outlined with its outline colour in a chunky screen-stable stroke over a soft
 * halo. Every fill sits below every edge, so neighbours' edges never vanish under a fill.
 */
export class TerritoryShapes {
  readonly fills = new Container({ label: "fills" });
  readonly edges = new Container({ label: "edges" });
  private readonly shapes = new Map<number, TerritoryShape>();
  private strokeUnit = 1;
  private dimmed = false;

  /** World units per screen pixel of the strokes as last drawn. */
  get unit(): number {
    return this.strokeUnit;
  }

  shape(id: number): TerritoryShape | undefined {
    return this.shapes.get(id);
  }

  /** Paints every region given, replacing what its id had before, and removes the rest. */
  sync(regions: ReadonlyMap<number, Region>, colorsOf: (id: number) => OwnerColors): void {
    for (const id of [...this.shapes.keys()]) if (!regions.has(id)) this.remove(id);
    for (const [id, region] of regions) this.show(id, region, colorsOf(id));
  }

  show(id: number, region: Region, colors: OwnerColors): TerritoryShape {
    let shape = this.shapes.get(id);
    if (!shape) {
      shape = { region, smoothed: [], colors, fill: new Graphics(), edge: new Graphics() };
      this.fills.addChild(shape.fill);
      this.edges.addChild(shape.edge);
      this.shapes.set(id, shape);
      this.applyDimmed(shape);
    }
    shape.region = region;
    shape.smoothed = smoothRegion(region);
    shape.colors = colors;
    this.drawFill(shape);
    this.drawEdge(shape);
    return shape;
  }

  remove(id: number): void {
    const shape = this.shapes.get(id);
    if (!shape) return;
    shape.fill.destroy();
    shape.edge.destroy();
    this.shapes.delete(id);
  }

  /** Repaints every shape in its current colours. */
  recolor(colorsOf: (id: number) => OwnerColors): void {
    for (const [id, shape] of this.shapes) {
      shape.colors = colorsOf(id);
      this.drawFill(shape);
      this.drawEdge(shape);
    }
  }

  /** A hidden shape keeps its polygons but paints nothing. */
  setHidden(id: number, hidden: boolean): void {
    const shape = this.shapes.get(id);
    if (!shape) return;
    shape.fill.visible = !hidden;
    shape.edge.visible = !hidden;
  }

  /** Follows the camera's scale; true when the snapped stroke width changed and the edges redrew. */
  setUnit(camScale: number): boolean {
    const unit = strokeUnit(camScale);
    if (unit === this.strokeUnit) return false;
    this.strokeUnit = unit;
    for (const shape of this.shapes.values()) this.drawEdge(shape);
    return true;
  }

  setDimmed(dimmed: boolean): void {
    this.dimmed = dimmed;
    for (const shape of this.shapes.values()) this.applyDimmed(shape);
  }

  destroy(): void {
    this.shapes.clear();
    this.fills.destroy({ children: true });
    this.edges.destroy({ children: true });
  }

  private applyDimmed({ fill, edge }: TerritoryShape): void {
    fill.alpha = this.dimmed ? GHOST_ALPHA : 1;
    edge.alpha = this.dimmed ? GHOST_ALPHA : 1;
  }

  private drawFill({ fill, smoothed, colors }: TerritoryShape): void {
    fill.clear();
    for (const polygon of smoothed) {
      fill.poly(polygon[0], true).fill({ color: colors.fill, alpha: TERRITORY_FILL_ALPHA });
    }
  }

  private drawEdge({ edge, smoothed, colors }: TerritoryShape): void {
    edge.clear();
    const color = colors.outline;
    const unit = this.strokeUnit;
    for (const polygon of smoothed) edge.poly(polygon[0], true);
    edge.stroke({
      color,
      width: TERRITORY_HALO_PX * unit,
      alpha: TERRITORY_HALO_ALPHA,
      join: "round",
    });
    for (const polygon of smoothed) edge.poly(polygon[0], true);
    edge.stroke({
      color,
      width: TERRITORY_EDGE_PX * unit,
      alpha: TERRITORY_EDGE_ALPHA,
      join: "round",
    });
  }
}
