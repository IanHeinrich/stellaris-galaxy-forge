import { Container, Sprite, type BLEND_MODES } from "pixi.js";
import type { BeltLook } from "../../../generated/BeltLook";
import { seeded } from "../../../lib/random";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type SceneBelt, type SystemContext } from "../context";
import type { SystemLayer } from "./SystemLayer";
import type { BeltPiece, BeltTextures } from "./textures";

/** World units of belt circumference per piece of a plain belt, up to the most pieces one belt draws. */
const PIECE_SPACING = 0.6;
export const MAX_ROCKS = 900;
/** How far the zoom moves before the pieces are sized again, as a share of the scale. */
const RESIZE_STEP = 0.02;

/** One kind of piece a belt scatters: its texture, how often it is drawn, its colours and its size. */
interface PieceStyle {
  readonly texture: BeltPiece;
  /** Its share of the belt's pieces, against the other pieces' weights. */
  readonly weight: number;
  readonly tints: readonly number[];
  /** Its world size is drawn between these, most near the small end, and never below `floorPx` on screen. */
  readonly size: readonly [min: number, max: number];
  readonly floorPx: number;
  /** Its alpha, drawn between the least and the most. */
  readonly alpha: readonly [min: number, max: number];
  /** Light added over the belt, as a glint or a glow is. */
  readonly added?: boolean;
}

/** How a look scatters its belt. */
interface BeltStyle {
  readonly pieces: readonly PieceStyle[];
  /** Its pieces against a plain belt's, before the kind's own density. */
  readonly count: number;
  /** Pieces spread evenly across the band; otherwise most lie near the radius. */
  readonly even: boolean;
  /** The glow an emissive kind adds among its pieces. */
  readonly glow: readonly number[];
}

const glint = (weight: number, tints: readonly number[]): PieceStyle => ({
  texture: "glint",
  weight,
  tints,
  size: [0.9, 2],
  floorPx: 3,
  alpha: [0.7, 1],
  added: true,
});

const glow = (weight: number, tints: readonly number[]): PieceStyle => ({
  texture: "glow",
  weight,
  tints,
  size: [2.5, 5],
  floorPx: 6,
  alpha: [0.25, 0.5],
  added: true,
});

const ICE = [0xe6f6ff, 0xcdeefc, 0xb7e3f4, 0xffffff];
const CRYSTAL = [0x3fd6c8, 0x62ead9, 0xd65ec8, 0xe683da, 0x2fb8b0];

const BELT_STYLES: Readonly<Record<BeltLook, BeltStyle>> = {
  rocky: {
    pieces: [
      {
        texture: "rock",
        weight: 1,
        tints: [0x9a8773, 0x8a7f74, 0x7d7166, 0xa89a88, 0x6f6660],
        size: [0.4, 2.2],
        floorPx: 1,
        alpha: [0.6, 1],
      },
    ],
    count: 1,
    even: false,
    glow: [0xc8b8a0],
  },
  icy: {
    pieces: [
      { texture: "shard", weight: 1, tints: ICE, size: [0.35, 1.2], floorPx: 1, alpha: [0.6, 1] },
      glow(0.08, [0x9fdcff, 0xc4ecff]),
      glint(0.05, [0xffffff, 0xe0f6ff]),
    ],
    count: 1,
    even: false,
    glow: [0x9fdcff],
  },
  crystal: {
    pieces: [
      {
        texture: "crystal",
        weight: 1,
        tints: CRYSTAL,
        size: [0.35, 1],
        floorPx: 1,
        alpha: [0.7, 1],
      },
      glow(0.07, [0x3fd6c8, 0xd65ec8]),
      glint(0.02, [0xffffff]),
    ],
    count: 0.8,
    even: false,
    glow: [0x62ead9, 0xe683da],
  },
  debris: {
    pieces: [
      {
        texture: "rock",
        weight: 0.65,
        tints: [0x6b625b, 0x5a534d, 0x7a7068, 0x837664],
        size: [0.4, 1.8],
        floorPx: 1,
        alpha: [0.55, 0.95],
      },
      {
        texture: "container",
        weight: 0.3,
        tints: [0xa7b0b8, 0x858d95, 0xa4562f, 0x8b4a2b],
        size: [0.7, 1.5],
        floorPx: 2,
        alpha: [0.8, 1],
      },
      glint(0.05, [0xfff2cc, 0xffffff]),
    ],
    count: 1,
    even: false,
    glow: [0xffe0a0],
  },
  dust: {
    pieces: [
      {
        texture: "speck",
        weight: 1,
        tints: [0x8c8c8c, 0x9e9e9e, 0x787878],
        size: [0.3, 0.8],
        floorPx: 1,
        alpha: [0.2, 0.45],
      },
    ],
    count: 0.4,
    even: true,
    glow: [0xb0b0b0],
  },
  fauna: {
    pieces: [
      {
        texture: "blob",
        weight: 1,
        tints: [0xe58fb5, 0xb58be8, 0x8fe0a0, 0xd070c0, 0x9ad07a, 0xf0a0d0],
        size: [0.9, 5],
        floorPx: 2,
        alpha: [0.7, 0.95],
      },
    ],
    count: 0.5,
    even: false,
    glow: [0xf0b0e0, 0xb0f0c0],
  },
};

/** The glow's share of an emissive kind's pieces, on top of any its look already has. */
const EMISSIVE_GLOW = 0.06;

/** The same seed for the same radius, so a belt's pieces hold still until the belt moves. */
function radiusSeed(radius: number): number {
  let x = Math.imul(Math.round(radius * 1000) ^ 0x5bd1e995, 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

function piecesOf(belt: SceneBelt): readonly PieceStyle[] {
  const style = BELT_STYLES[belt.look];
  return belt.emissive ? [...style.pieces, glow(EMISSIVE_GLOW, style.glow)] : style.pieces;
}

function pick(pieces: readonly PieceStyle[], draw: number): PieceStyle {
  let left = draw * pieces.reduce((sum, p) => sum + p.weight, 0);
  for (const piece of pieces) {
    left -= piece.weight;
    if (left < 0) return piece;
  }
  return pieces[pieces.length - 1];
}

interface Piece {
  sprite: Sprite;
  size: number;
  floorPx: number;
}

const ADDED: BLEND_MODES = "add";

/**
 * Each asteroid belt as a band of small pieces about its radius, drawn as its look says: rocks,
 * ice, crystals, wreckage, dust or living things, with any glow its kind gives off.
 */
export class BeltsLayer implements SystemLayer {
  readonly container = new Container();
  readonly rocks = new Container();
  private belts: readonly SceneBelt[] = EMPTY_SYSTEM_CONTEXT.belts;
  private placed: Piece[] = [];
  private drawnScale = -1;

  constructor(private readonly textures: BeltTextures) {
    this.container.addChild(this.rocks);
  }

  rebuild(ctx: SystemContext): void {
    const belts = ctx.belts;
    if (belts === this.belts) return;
    this.belts = belts;
    for (const child of this.rocks.removeChildren()) child.destroy();
    this.placed = belts.flatMap((belt) => this.scatter(belt));
    this.drawnScale = -1;
  }

  private scatter(belt: SceneBelt): Piece[] {
    const style = BELT_STYLES[belt.look];
    const pieces = piecesOf(belt);
    const rand = seeded(radiusSeed(belt.radius));
    const half = (belt.outer - belt.inner) / 2;
    const plain = (2 * Math.PI * belt.radius) / PIECE_SPACING;
    const count = Math.min(MAX_ROCKS, Math.round(plain * style.count * belt.density));
    const placed: Piece[] = [];
    for (let i = 0; i < count; i++) {
      const piece = pick(pieces, rand());
      const angle = rand() * 2 * Math.PI;
      // The sum of two draws peaks in the middle: most pieces near the radius, fewer to the edges.
      const across = style.even ? 2 * rand() - 1 : rand() + rand() - 1;
      const r = belt.radius + across * half;
      const sprite = new Sprite(this.textures[piece.texture]);
      sprite.anchor.set(0.5);
      sprite.position.set(r * Math.cos(angle), r * Math.sin(angle));
      sprite.rotation = rand() * 2 * Math.PI;
      sprite.tint = piece.tints[Math.floor(rand() * piece.tints.length)];
      const [alphaMin, alphaMax] = piece.alpha;
      sprite.alpha = alphaMin + rand() * (alphaMax - alphaMin);
      if (piece.added) sprite.blendMode = ADDED;
      this.rocks.addChild(sprite);
      const [sizeMin, sizeMax] = piece.size;
      placed.push({
        sprite,
        size: sizeMin + rand() ** 2 * (sizeMax - sizeMin),
        floorPx: piece.floorPx,
      });
    }
    return placed;
  }

  onViewport(cam: Camera): void {
    if (Math.abs(cam.scale / this.drawnScale - 1) < RESIZE_STEP) return;
    this.drawnScale = cam.scale;
    for (const { sprite, size, floorPx } of this.placed) {
      const width = sprite.texture.width || 1;
      sprite.scale.set(Math.max(size, floorPx / cam.scale) / width);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
