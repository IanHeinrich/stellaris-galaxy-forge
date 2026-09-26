import { MeshGeometry, type Mesh, type Sprite } from "pixi.js";

/**
 * A ring's outer semi-axes in disc radii, and its tilt on screen: seen from well above, as the
 * game shows it. The game's ring mesh spans 1.39 to 2.12 planet radii.
 */
const RING_MAJOR = 2.12;
const RING_MINOR = RING_MAJOR * 0.75;
export const RING_TILT = -0.08;
/** The ring's inner edge, as a share of its outer one. */
export const RING_INNER = 1.39 / 2.12;
/** The steps round each half of the game's ring texture's strip. */
const RING_SEGMENTS = 32;

/** A planet's ring, each half drawn as a baked sprite and as the game's texture on a strip. */
export interface RingParts {
  /** The baked halves, shown until the game's ring texture lands, or when it cannot. */
  back: Sprite;
  front: Sprite;
  /** The game's ring texture on each half. */
  backStrip: Mesh;
  frontStrip: Mesh;
}

/**
 * Half the unit ring, the far half on -y as the baked halves have it, with u running round the
 * whole ring and v from 0 at the outer edge to 1 at the inner, as the game's mesh maps its strip.
 */
function ringStripGeometry(far: boolean): MeshGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const from = far ? Math.PI : 0;
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const t = from + (Math.PI * i) / RING_SEGMENTS;
    const u = t / (2 * Math.PI);
    positions.push(Math.cos(t), Math.sin(t), RING_INNER * Math.cos(t), RING_INNER * Math.sin(t));
    uvs.push(u, 0, u, 1);
    if (i > 0) {
      const k = 2 * i;
      indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  return new MeshGeometry({
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  });
}

/** The two halves' geometry, made once and shared by every ring. */
const ringStrips = new Map<boolean, MeshGeometry>();

export function ringStrip(far: boolean): MeshGeometry {
  let geometry = ringStrips.get(far);
  if (!geometry) ringStrips.set(far, (geometry = ringStripGeometry(far)));
  return geometry;
}

/** Sizes every part of `ring` about a disc of `radius`. */
export function sizeRing(ring: RingParts, radius: number): void {
  for (const half of [ring.back, ring.front]) {
    const { width, height } = half.texture;
    half.scale.set(
      (2 * RING_MAJOR * radius) / Math.max(width, 1),
      (2 * RING_MINOR * radius) / Math.max(height, 1),
    );
  }
  for (const half of [ring.backStrip, ring.frontStrip]) {
    half.scale.set(RING_MAJOR * radius, RING_MINOR * radius);
  }
}
