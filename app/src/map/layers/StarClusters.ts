import { Sprite, type BLEND_MODES, type Container, type Texture } from "pixi.js";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import type { SystemNode } from "../../generated/SystemNode";
import { singleStarClasses } from "../../lib/details/starBody";
import { starCluster, type ClusterStar } from "../../lib/visual/starCluster";
import { STAR_BASE_PX, starDiameterPx } from "../../lib/visual/starSize";
import { getTexture, requestTextures } from "../../lib/visual/textures";

/** Game star art sits on opaque black; drawn additively, black reads as transparent. */
export const STAR_ART_BLEND: BLEND_MODES = "add";

interface Cluster {
  node: SystemNode;
  stars: ClusterStar[];
  sprites: Sprite[];
}

/**
 * The save systems drawn star by star: one sprite per star body, placed where the system's one
 * sprite would be, in `parent` beside it. A system is drawn so only while it has more than one
 * star body and every star's art has landed.
 */
export class StarClusters {
  private readonly clusters = new Map<number, Cluster>();
  private singles: ReadonlyMap<string, StarClassView> = new Map<string, StarClassView>();
  private singlesFrom: ReadonlyMap<string, StarClassView> | null = null;

  constructor(
    private readonly parent: Container,
    private readonly fallback: Texture,
  ) {}

  /**
   * Draws `s` star by star when it can, and says whether it does; `art` is the system class's
   * own, the stand-in for a star with none, and null draws `s` as its one sprite.
   */
  place(
    s: SystemNode,
    art: { key: string; scale: number } | null,
    planetClasses: ReadonlyMap<string, PlanetClassView>,
    starClasses: ReadonlyMap<string, StarClassView>,
  ): boolean {
    const stars = art ? this.starsOf(s, art, planetClasses, starClasses) : null;
    const textures = stars?.map((star) => getTexture(star.texture.key));
    const held = this.clusters.get(s.id);
    if (!stars || !textures || textures.some((t) => !t)) {
      held?.sprites.forEach((star) => star.destroy());
      this.clusters.delete(s.id);
      return false;
    }
    const sprites = held?.sprites ?? [];
    while (sprites.length > stars.length) sprites.pop()?.destroy();
    while (sprites.length < stars.length) {
      const star = new Sprite(this.fallback);
      star.anchor.set(0.5);
      star.blendMode = STAR_ART_BLEND;
      sprites.push(star);
      this.parent.addChild(star);
    }
    sprites.forEach((star, i) => {
      star.texture = textures[i] ?? this.fallback;
    });
    this.clusters.set(s.id, { node: s, stars, sprites });
    return true;
  }

  /** Sizes and places system `id`'s stars for the zoom `camScale`. */
  rescale(id: number, camScale: number): void {
    const cluster = this.clusters.get(id);
    if (!cluster) return;
    const footprint = starDiameterPx(STAR_BASE_PX, camScale);
    cluster.sprites.forEach((star, i) => {
      const place = cluster.stars[i];
      const width = star.texture.width;
      const px = Math.min(width, footprint * place.diameter * place.texture.scale);
      star.scale.set(px / (camScale * width));
      star.position.set(
        cluster.node.x + (place.dx * footprint) / camScale,
        cluster.node.y + (place.dy * footprint) / camScale,
      );
    });
  }

  setAlpha(id: number, alpha: number): void {
    for (const star of this.clusters.get(id)?.sprites ?? []) star.alpha = alpha;
  }

  /** Forgets system `id`, adding its sprites to `doomed` for the caller to take down. */
  drop(id: number, doomed: Set<Container>): void {
    for (const star of this.clusters.get(id)?.sprites ?? []) doomed.add(star);
    this.clusters.delete(id);
  }

  /** Forgets every system, for a caller that has taken the sprites down already. */
  clear(): void {
    this.clusters.clear();
  }

  private starsOf(
    s: SystemNode,
    art: { key: string; scale: number },
    planetClasses: ReadonlyMap<string, PlanetClassView>,
    starClasses: ReadonlyMap<string, StarClassView>,
  ): ClusterStar[] | null {
    if (this.singlesFrom !== starClasses) {
      this.singlesFrom = starClasses;
      this.singles = singleStarClasses(starClasses);
    }
    const stars = starCluster(s.bodies, planetClasses, starClasses, this.singles, art);
    if (stars) requestTextures(stars.map((star) => star.texture.key));
    return stars;
  }
}
