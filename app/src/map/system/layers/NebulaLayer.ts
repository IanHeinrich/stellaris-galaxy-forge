import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { seeded, type Rand } from "../../../lib/random";
import { mixColor } from "../../../lib/visual/color";
import { NEBULA_EDGE_COLOR, NEBULA_FILL_COLOR } from "../../../lib/visual/style";
import type { SystemContext } from "../context";
import type { SystemLayer } from "./SystemLayer";

/**
 * Half the field's side, in inner radii: its clearing ends about where the planets do, and it
 * covers the view zoomed out to its limit.
 */
const FIELD_REACH = 3;
/** Faint, so its brightest strands stay well under the orbit lines. */
const FIELD_ALPHA = 0.18;
/** A second, larger copy turned against the first, which breaks up its pattern and fills the corners. */
const ECHO_SCALE_MIN = 1.3;
const ECHO_SCALE_MAX = 1.6;
const ECHO_ALPHA = 0.09;

const STAR_COUNT = 40;
const STAR_COLOR = 0xc9b8f0;
/** A faint star's world radius, and how far out they go, in inner radii. */
const STAR_SIZE_MIN = 0.8;
const STAR_SIZE_MAX = 2;
const STAR_REACH = 2.8;
const STAR_ALPHA_MIN = 0.12;
const STAR_ALPHA_MAX = 0.3;

function between(rand: Rand, min: number, max: number): number {
  return min + rand() * (max - min);
}

/**
 * The nebula field swirling about a system that lies in a nebula, turned and mirrored per system,
 * with a few faint stars, behind everything else while the scene's Nebulae switch is on. Nothing
 * for a system outside one.
 */
export class NebulaLayer implements SystemLayer {
  readonly container = new Container();
  readonly field = new Container();
  readonly stars = new Graphics();
  private drawn: string | null = null;

  constructor(private readonly texture: Texture) {
    this.container.addChild(this.field, this.stars);
  }

  rebuild(ctx: SystemContext): void {
    const id = ctx.sceneLayers.nebulae && ctx.inNebula ? ctx.id : null;
    const inner = ctx.layout.innerRadius;
    const key = id === null ? "" : `${id}:${inner}`;
    if (key === this.drawn) return;
    this.drawn = key;
    for (const child of this.field.removeChildren()) child.destroy();
    this.stars.clear();
    if (id !== null) this.draw(id, inner);
  }

  private draw(id: number, inner: number): void {
    const rand = seeded(id);
    const mirror = rand() < 0.5 ? -1 : 1;
    const turn = rand() * 2 * Math.PI;
    this.copy(rand, inner * FIELD_REACH, mirror, turn, FIELD_ALPHA);
    const echo = between(rand, ECHO_SCALE_MIN, ECHO_SCALE_MAX);
    this.copy(rand, inner * FIELD_REACH * echo, mirror, turn + between(rand, 2, 4), ECHO_ALPHA);
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = inner * STAR_REACH * Math.sqrt(rand());
      const angle = rand() * 2 * Math.PI;
      this.stars
        .circle(
          r * Math.cos(angle),
          r * Math.sin(angle),
          between(rand, STAR_SIZE_MIN, STAR_SIZE_MAX),
        )
        .fill({ color: STAR_COLOR, alpha: between(rand, STAR_ALPHA_MIN, STAR_ALPHA_MAX) });
    }
  }

  /** One copy of the field, `reach` from its centre to its side; every copy swirls the same way. */
  private copy(rand: Rand, reach: number, mirror: number, rotation: number, alpha: number): void {
    const sprite = new Sprite(this.texture);
    sprite.anchor.set(0.5);
    const scale = (2 * reach) / this.texture.width;
    sprite.scale.set(mirror * scale, scale);
    sprite.rotation = rotation;
    // Each copy takes its own mix of the galaxy map's two nebula purples.
    sprite.tint = mixColor(NEBULA_FILL_COLOR, NEBULA_EDGE_COLOR, rand());
    sprite.alpha = alpha;
    this.field.addChild(sprite);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
