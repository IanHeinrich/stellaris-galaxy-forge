import { Container, Sprite, type Texture } from "pixi.js";
import type { BeltBand } from "../../../lib/details/orbits";
import { seeded } from "../../../lib/random";
import type { Camera } from "../../Camera";
import type { SystemContext } from "../context";
import type { SystemLayer } from "./SystemLayer";

/** World units of belt circumference per rock, up to the most rocks one belt draws. */
const ROCK_SPACING = 1.2;
export const MAX_ROCKS = 400;
/** How far the zoom moves before the rocks are sized again, as a share of the scale. */
const RESIZE_STEP = 0.02;
/** A rock's world size is drawn between these, before the screen-pixel floor. */
const ROCK_MIN = 0.8;
const ROCK_MAX = 2.2;
const ROCK_FLOOR_PX = 1.5;

const ICY_TINT = 0xbfd9ee;
const ROCKY_TINT = 0x9a8773;
const DEBRIS_TINT = 0x514a45;

function beltTint(kind: string): number {
  if (kind.includes("icy")) return ICY_TINT;
  if (kind.includes("rocky")) return ROCKY_TINT;
  return DEBRIS_TINT;
}

/** The same seed for the same radius, so a belt's rocks hold still until the belt moves. */
function radiusSeed(radius: number): number {
  let x = Math.imul(Math.round(radius * 1000) ^ 0x5bd1e995, 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

interface Rock {
  sprite: Sprite;
  size: number;
}

function sameBelts(a: readonly BeltBand[], b: readonly BeltBand[]): boolean {
  return (
    a.length === b.length &&
    a.every((belt, i) => belt.kind === b[i].kind && belt.radius === b[i].radius)
  );
}

/**
 * Each asteroid belt as a band of small rocks about its radius, densest at the radius and
 * thinning towards both edges, tinted by the belt's kind.
 */
export class BeltsLayer implements SystemLayer {
  readonly id = "belts" as const;
  readonly container = new Container();
  readonly rocks = new Container();
  private belts: readonly BeltBand[] = [];
  private placed: Rock[] = [];
  private drawnScale = -1;

  constructor(private readonly rock: Texture) {
    this.container.addChild(this.rocks);
  }

  rebuild(ctx: SystemContext): void {
    const belts = ctx.layout.belts;
    if (sameBelts(belts, this.belts)) return;
    this.belts = belts;
    for (const child of this.rocks.removeChildren()) child.destroy();
    this.placed = belts.flatMap((belt) => this.scatter(belt));
    this.drawnScale = -1;
  }

  private scatter(belt: BeltBand): Rock[] {
    const rand = seeded(radiusSeed(belt.radius));
    const count = Math.min(MAX_ROCKS, Math.round((2 * Math.PI * belt.radius) / ROCK_SPACING));
    const half = (belt.outer - belt.inner) / 2;
    const tint = beltTint(belt.kind);
    const rocks: Rock[] = [];
    for (let i = 0; i < count; i++) {
      const angle = rand() * 2 * Math.PI;
      // The sum of two draws peaks in the middle: most rocks near the radius, fewer to the edges.
      const r = belt.radius + (rand() + rand() - 1) * half;
      const sprite = new Sprite(this.rock);
      sprite.anchor.set(0.5);
      sprite.position.set(r * Math.cos(angle), r * Math.sin(angle));
      sprite.rotation = rand() * 2 * Math.PI;
      sprite.tint = tint;
      sprite.alpha = 0.55 + rand() * 0.45;
      this.rocks.addChild(sprite);
      rocks.push({ sprite, size: ROCK_MIN + rand() * (ROCK_MAX - ROCK_MIN) });
    }
    return rocks;
  }

  onViewport(cam: Camera): void {
    if (Math.abs(cam.scale / this.drawnScale - 1) < RESIZE_STEP) return;
    this.drawnScale = cam.scale;
    const floor = ROCK_FLOOR_PX / cam.scale;
    for (const { sprite, size } of this.placed) {
      const k = Math.max(size, floor) / this.rock.width;
      sprite.scale.set(k);
    }
  }

  setHighlighted(): void {}

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
