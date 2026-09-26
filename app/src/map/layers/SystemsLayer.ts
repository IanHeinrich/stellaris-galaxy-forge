import { Container, Graphics, Sprite, type Renderer, type Texture } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SystemNode } from "../../generated/SystemNode";
import type { Camera } from "../Camera";
import { EMPTY_CONTEXT, type RenderContext } from "../RenderContext";
import { dimmedByInitializer } from "../../lib/initializer/initializerLabels";
import { effectiveStarClass, starGlyph, starTextureKey } from "../../lib/visual/starGlyphs";
import { STAR_BASE_PX, starDiameterPx } from "../../lib/visual/starSize";
import { FILTERED_ALPHA, ORIGIN_ALPHA } from "../../lib/visual/style";
import { getTexture, onTextures, requestTextures } from "../../lib/visual/textures";
import { destroyChildren } from "./destroyChildren";
import { markerScale, type DragState, type MapLayer } from "./MapLayer";
import { STAR_ART_BLEND, StarClusters } from "./StarClusters";

/** Radius of the generated glow texture in pixels; sprites are scaled from it. */
const TEX_RADIUS = 16;
const RING_COLOR = 0x8a7cb0;
/** How many times its glyph's width a ringed glyph's ring (a black hole's) is drawn. */
const GLYPH_RING_SCALE = 2.2;

function glowTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  const steps = 8;
  for (let i = steps; i >= 1; i--) {
    const r = (TEX_RADIUS * i) / steps;
    const t = 1 - i / steps;
    g.circle(TEX_RADIUS, TEX_RADIUS, r).fill({ color: 0xffffff, alpha: 0.08 + t * t * 0.6 });
  }
  g.circle(TEX_RADIUS, TEX_RADIUS, TEX_RADIUS * 0.3).fill({ color: 0xffffff, alpha: 1 });
  const tex = renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}

const glows = new WeakMap<Renderer, { texture: Texture; users: number }>();

/** A soft white glow, tinted per star: baked once per renderer and shared until its last user lets go. */
export function acquireGlow(renderer: Renderer): Texture {
  const held = glows.get(renderer) ?? { texture: glowTexture(renderer), users: 0 };
  held.users++;
  glows.set(renderer, held);
  return held.texture;
}

export function releaseGlow(renderer: Renderer): void {
  const held = glows.get(renderer);
  if (!held || --held.users > 0) return;
  glows.delete(renderer);
  held.texture.destroy(true);
}

function ringTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(TEX_RADIUS, TEX_RADIUS, TEX_RADIUS * 0.85).stroke({
    color: 0xffffff,
    alpha: 0.9,
    width: TEX_RADIUS * 0.12,
  });
  const tex = renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}

/** Sprite scale that shows a game star texture `basePx` wide at unit zoom, never past its native size. */
function starScale(basePx: number, camScale: number, texturePx: number): number {
  const px = Math.min(texturePx, starDiameterPx(basePx, camScale));
  return px / (camScale * texturePx);
}

const RING_ALPHA = 0.6;

/** Matches no class and no game texture, so the star takes the neutral glyph. */
const NO_CLASS = "";

/**
 * One sprite per system: the game's star art scaling with the world when game data is loaded,
 * else a shared radial glow that stays screen-size-stable across zoom. A save system with more
 * than one star body draws each star's own art instead, clustered where its one sprite would be.
 */
export class SystemsLayer implements MapLayer {
  readonly id = "systems" as const;
  readonly container = new Container();
  private readonly glow: Texture;
  private readonly ring: Texture;
  private readonly sprites = new Map<number, Sprite>();
  private readonly rings = new Map<number, Sprite>();
  private readonly clusters: StarClusters;
  /** Glyph radius in screen pixels for the glow path, else the star's diameter in world units. */
  private readonly sizes = new Map<number, number>();
  private readonly gameTextured = new Set<number>();
  private readonly nodes = new Map<number, SystemNode>();
  private faded = new Set<number>();
  private readonly previews: Sprite[] = [];
  private lastScale = -1;
  private ctx: RenderContext = EMPTY_CONTEXT;
  private readonly unsubTextures: () => void;

  constructor(private readonly renderer: Renderer) {
    this.glow = acquireGlow(renderer);
    this.ring = ringTexture(renderer);
    this.clusters = new StarClusters(this.container, this.glow);
    this.unsubTextures = onTextures(() => this.replaceAll());
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    if (ctx.galaxy === prev.galaxy) {
      if (
        ctx.starClasses !== prev.starClasses ||
        ctx.planetClasses !== prev.planetClasses ||
        ctx.initializerClasses !== prev.initializerClasses ||
        ctx.kind !== prev.kind ||
        ctx.starTints !== prev.starTints ||
        ctx.hiddenInitializers !== prev.hiddenInitializers
      ) {
        this.replaceAll();
      }
      return;
    }
    this.container.removeChildren().forEach((c) => c.destroy());
    this.sprites.clear();
    this.rings.clear();
    this.clusters.clear();
    this.sizes.clear();
    this.gameTextured.clear();
    this.nodes.clear();
    this.previews.length = 0;
    this.faded.clear();
    for (const s of ctx.systems.values()) this.place(s);
  }

  /** Re-places every known system; `place` is idempotent, so this is cheap and safe to call often. */
  private replaceAll(): void {
    for (const s of this.nodes.values()) this.place(s);
  }

  applyDelta(d: GalaxyDelta): void {
    this.drop(d.removed ?? []);
    for (const s of d.systems) this.place(s);
  }

  /** Systems the document no longer holds take their stars, their rings and their fades with them. */
  private drop(ids: readonly number[]): void {
    const doomed = new Set<Container>();
    for (const id of ids) {
      const sprite = this.sprites.get(id);
      const ring = this.rings.get(id);
      if (sprite) doomed.add(sprite);
      if (ring) doomed.add(ring);
      this.clusters.drop(id, doomed);
      this.sprites.delete(id);
      this.rings.delete(id);
      this.sizes.delete(id);
      this.gameTextured.delete(id);
      this.nodes.delete(id);
      this.faded.delete(id);
    }
    destroyChildren(this.container, doomed);
  }

  /** A drag in progress: each star's glyph at its destination, the originals dimmed. */
  setDragState(drag: DragState | null): void {
    const ghosts = drag?.ghosts ?? [];
    for (const id of this.faded) this.applyFade(id, 1);
    this.faded = new Set(ghosts.map((g) => g.id));
    for (const id of this.faded) this.applyFade(id, ORIGIN_ALPHA);
    while (this.previews.length < ghosts.length) {
      const preview = new Sprite(this.glow);
      preview.anchor.set(0.5);
      this.previews.push(preview);
      this.container.addChild(preview);
    }
    this.previews.forEach((preview, i) => {
      const ghost = ghosts[i];
      const source = ghost && this.sprites.get(ghost.id);
      preview.visible = source !== undefined;
      if (!source) return;
      preview.texture = source.texture;
      preview.blendMode = source.blendMode;
      preview.tint = source.tint;
      preview.scale.copyFrom(source.scale);
      preview.position.set(ghost.x, ghost.y);
    });
  }

  /** A system's own alpha times `fade`: the filter dims it, a drag fades what it leaves behind. */
  private applyFade(id: number, fade: number): void {
    const node = this.nodes.get(id);
    const filtered = node !== undefined && dimmedByInitializer(node, this.ctx.hiddenInitializers);
    const alpha = fade * (filtered ? FILTERED_ALPHA : 1);
    const sprite = this.sprites.get(id);
    if (sprite) sprite.alpha = alpha;
    const ring = this.rings.get(id);
    if (ring) ring.alpha = RING_ALPHA * alpha;
    this.clusters.setAlpha(id, alpha);
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.lastScale) return;
    this.lastScale = cam.scale;
    for (const id of this.sprites.keys()) this.rescale(id);
  }

  private rescale(id: number): void {
    const camScale = this.lastScale;
    if (camScale <= 0) return;
    const size = this.sizes.get(id) ?? 1;
    const factor = markerScale(camScale) / camScale;
    const sprite = this.sprites.get(id);
    if (sprite) {
      const k = this.gameTextured.has(id)
        ? starScale(size, camScale, sprite.texture.width)
        : (size * factor * 2) / sprite.texture.width;
      sprite.scale.set(k, k);
    }
    const ring = this.rings.get(id);
    if (ring) {
      const k = ((size * factor * 2) / ring.texture.width) * GLYPH_RING_SCALE;
      ring.scale.set(k, k);
    }
    this.clusters.rescale(id, camScale);
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.unsubTextures();
    this.container.destroy({ children: true });
    releaseGlow(this.renderer);
    this.ring.destroy(true);
  }

  private place(s: SystemNode): void {
    this.nodes.set(s.id, s);
    let sprite = this.sprites.get(s.id);
    if (!sprite) {
      sprite = new Sprite(this.glow);
      sprite.anchor.set(0.5);
      this.sprites.set(s.id, sprite);
      this.container.addChild(sprite);
    }
    sprite.position.set(s.x, s.y);

    const starClass = this.ctx.starTints
      ? effectiveStarClass(s, this.ctx.initializerClasses.get(s.initializer), this.ctx.kind)
      : NO_CLASS;
    const resolved = starTextureKey(starClass, this.ctx.starClasses);
    let tex: Texture | null | undefined;
    if (resolved) {
      requestTextures([resolved.key]);
      tex = getTexture(resolved.key);
    }

    let ring = this.rings.get(s.id);
    if (resolved && tex) {
      sprite.texture = tex;
      sprite.tint = 0xffffff;
      sprite.blendMode = STAR_ART_BLEND;
      this.sizes.set(s.id, STAR_BASE_PX * resolved.scale);
      this.gameTextured.add(s.id);
      if (ring) {
        ring.destroy();
        this.rings.delete(s.id);
        ring = undefined;
      }
    } else {
      const glyph = starGlyph(starClass);
      sprite.texture = this.glow;
      sprite.tint = glyph.tint;
      sprite.blendMode = "normal";
      this.sizes.set(s.id, glyph.size);
      this.gameTextured.delete(s.id);
      if (glyph.ring && !ring) {
        ring = new Sprite(this.ring);
        ring.anchor.set(0.5);
        ring.tint = RING_COLOR;
        ring.alpha = RING_ALPHA;
        this.rings.set(s.id, ring);
        this.container.addChild(ring);
      } else if (!glyph.ring && ring) {
        ring.destroy();
        this.rings.delete(s.id);
        ring = undefined;
      }
    }
    ring?.position.set(s.x, s.y);
    const art = resolved && tex ? resolved : null;
    sprite.renderable = !this.clusters.place(s, art, this.ctx.planetClasses, this.ctx.starClasses);
    this.rescale(s.id);
    this.applyFade(s.id, this.faded.has(s.id) ? ORIGIN_ALPHA : 1);
  }
}
