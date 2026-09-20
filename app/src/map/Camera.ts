import { SAVE_X_SIGN, SAVE_Y_SIGN, clamp } from "../lib/geometry/geometry";

export interface Pt {
  x: number;
  y: number;
}

export interface WorldTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

interface Ease {
  fromX: number;
  fromY: number;
  fromScale: number;
  toX: number;
  toY: number;
  toScale: number;
  elapsed: number;
  duration: number;
}

const FIT_MARGIN = 2.2;
const MAX_SCALE = 40;

/** Centre of view in world (save) units plus pixels per unit. Pure: no pixi. */
export class Camera {
  x = 0;
  y = 0;
  scale = 1;
  width = 1;
  height = 1;
  minScale = 0.01;
  maxScale = MAX_SCALE;
  /** Bumped on every change so the renderer knows when to re-apply the transform. */
  rev = 0;

  private readonly xSign = SAVE_X_SIGN;
  private readonly ySign = SAVE_Y_SIGN;
  private ease: Ease | null = null;
  /** Two points the camera's own conversions reuse, so a pointer move allocates nothing. */
  private readonly from: Pt = { x: 0, y: 0 };
  private readonly to: Pt = { x: 0, y: 0 };

  setViewport(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.rev++;
  }

  worldToScreen(wx: number, wy: number, out: Pt = { x: 0, y: 0 }): Pt {
    out.x = this.xSign * (wx - this.x) * this.scale + this.width / 2;
    out.y = this.ySign * (wy - this.y) * this.scale + this.height / 2;
    return out;
  }

  screenToWorld(sx: number, sy: number, out: Pt = { x: 0, y: 0 }): Pt {
    out.x = (this.xSign * (sx - this.width / 2)) / this.scale + this.x;
    out.y = (this.ySign * (sy - this.height / 2)) / this.scale + this.y;
    return out;
  }

  /** Position and scale for a container holding world-unit children. */
  worldTransform(out: WorldTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1 }): WorldTransform {
    out.x = this.width / 2 - this.xSign * this.x * this.scale;
    out.y = this.height / 2 - this.ySign * this.y * this.scale;
    out.scaleX = this.xSign * this.scale;
    out.scaleY = this.ySign * this.scale;
    return out;
  }

  /** Local scale that makes a child of the world container `px` per unit big and upright on screen. */
  childScale(px: number, out: Pt = { x: 0, y: 0 }): Pt {
    out.x = (this.xSign * px) / this.scale;
    out.y = (this.ySign * px) / this.scale;
    return out;
  }

  /** World-space bounds of the viewport as [minX, minY, maxX, maxY]. */
  worldBounds(out: number[] = [0, 0, 0, 0]): number[] {
    const a = this.screenToWorld(0, 0, this.from);
    const b = this.screenToWorld(this.width, this.height, this.to);
    out[0] = Math.min(a.x, b.x);
    out[1] = Math.min(a.y, b.y);
    out[2] = Math.max(a.x, b.x);
    out[3] = Math.max(a.y, b.y);
    return out;
  }

  clampScale(s: number): number {
    return clamp(s, this.minScale, this.maxScale);
  }

  /** Multiply the scale by `factor`, keeping the world point under `screen` fixed. */
  zoomAt(screen: Pt, factor: number): void {
    const next = this.clampScale(this.scale * factor);
    if (next === this.scale) return;
    const before = this.screenToWorld(screen.x, screen.y, this.from);
    this.scale = next;
    const after = this.screenToWorld(screen.x, screen.y, this.to);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.ease = null;
    this.rev++;
  }

  /** Move the view so the world follows the pointer by (dxPx, dyPx). */
  panBy(dxPx: number, dyPx: number): void {
    if (dxPx === 0 && dyPx === 0) return;
    const a = this.screenToWorld(0, 0, this.from);
    const b = this.screenToWorld(dxPx, dyPx, this.to);
    this.x -= b.x - a.x;
    this.y -= b.y - a.y;
    this.ease = null;
    this.rev++;
  }

  /** The scale at which a galaxy of `radius` fills the shorter viewport side with a margin. */
  fitScale(radius: number, width = this.width, height = this.height): number {
    return Math.min(width, height) / (FIT_MARGIN * Math.max(radius, 1));
  }

  /** Show the whole galaxy centred at the origin and set that as the minimum zoom. */
  fit(radius: number, width = this.width, height = this.height): void {
    this.setViewport(width, height);
    const s = this.fitScale(radius, width, height);
    this.minScale = s * 0.8;
    this.x = 0;
    this.y = 0;
    this.scale = s;
    this.ease = null;
    this.rev++;
  }

  easeTo(x: number, y: number, scale: number = this.scale, ms = 300): void {
    const toScale = this.clampScale(scale);
    if (ms <= 0) {
      this.x = x;
      this.y = y;
      this.scale = toScale;
      this.ease = null;
      this.rev++;
      return;
    }
    this.ease = {
      fromX: this.x,
      fromY: this.y,
      fromScale: this.scale,
      toX: x,
      toY: y,
      toScale,
      elapsed: 0,
      duration: ms,
    };
  }

  get animating(): boolean {
    return this.ease !== null;
  }

  update(dtMs: number): boolean {
    const e = this.ease;
    if (!e) return false;
    e.elapsed += dtMs;
    const t = clamp(e.elapsed / e.duration, 0, 1);
    const k = 1 - (1 - t) * (1 - t) * (1 - t);
    this.x = e.fromX + (e.toX - e.fromX) * k;
    this.y = e.fromY + (e.toY - e.fromY) * k;
    this.scale = e.fromScale * Math.pow(e.toScale / e.fromScale, k);
    if (t >= 1) this.ease = null;
    this.rev++;
    return true;
  }
}
