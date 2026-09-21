import {
  BitmapText,
  Circle,
  Container,
  type FederatedPointerEvent,
  Graphics,
  TextStyle,
} from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SpawnScript } from "../../generated/SpawnScript";
import type { SystemNode } from "../../generated/SystemNode";
import { spawnScriptLabel } from "../../lib/paint";
import { isSpawnPoint } from "../../lib/spawn";
import { GHOST_ALPHA, MAP_FONT } from "../../lib/visual/style";
import type { Camera } from "../Camera";
import { useMapChromeStore } from "../../store/mapChromeStore";
import type { MoveGhost } from "../moveGhosts";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { markerScale, type DragState, type MapLayer } from "./MapLayer";

const MARKER = { size: 4.5, width: 1.5, alpha: 0.95, dot: 1.4 };

const MARKER_COLOR = 0xfbbf24;

/** Marker centre relative to the star, in marker units: clear of the ring, opposite the bypasses. */
const OFFSET = { x: -12, y: -12 };

const NO_GHOSTS: ReadonlyMap<number, MoveGhost> = new Map();

/** The mark's own hit area, around its offset centre, so the star's hover and drag stay free. */
const HIT = new Circle(OFFSET.x, OFFSET.y, MARKER.size + 2.5);

/** A scripted seat's kind tag, beside the marker rather than over it. */
const TAG_OFFSET = { x: OFFSET.x + 11, y: OFFSET.y - 6 };

const CHIP = { width: 12, height: 9, radius: 2 };
const STAR = { outer: 4, inner: 1.8 };

/** The ring a weighted seat's chip is drawn with, so the weight shows at any zoom. */
const RING = { color: 0xffffff, width: 1, alpha: 0.9 };

/** One shared instance: PixiJS keys a stroked dynamic bitmap font by the style object. */
const TAG_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 8,
  fontWeight: "700",
  fill: 0x111827,
});

/**
 * What a scripted seat's kind draws beside the marker: nothing for an enabled seat, a star for a
 * preferred one, letters on a chip for the rest, the chip ringed when the seat is weighted.
 */
type Tag = "star" | { letters: string; weighted: boolean } | null;

function tagOf(script: SpawnScript): Tag {
  const { kind, player } = script.paint_a_galaxy;
  if (kind === "enabled") return null;
  if (kind === "preferred") return player ? { letters: "P", weighted: true } : "star";
  if (kind === "sol") return { letters: "Sol", weighted: player };
  return { letters: kind.reserved.toUpperCase(), weighted: player };
}

/** A key that changes exactly when the tag drawn for a seat must change. */
function tagKey(tag: Tag): string {
  if (tag === null) return "";
  if (tag === "star") return "star";
  return `letters:${tag.letters}${tag.weighted ? ":weighted" : ""}`;
}

/** The rounded tag a reserved, Sol or weighted seat draws its letters over. */
function drawChip(g: Graphics, weighted: boolean): void {
  const { x, y } = TAG_OFFSET;
  const chip = () =>
    g.roundRect(x - CHIP.width / 2, y - CHIP.height / 2, CHIP.width, CHIP.height, CHIP.radius);
  chip().fill({ color: MARKER_COLOR, alpha: MARKER.alpha });
  if (weighted) chip().stroke(RING);
}

/** A preferred seat's five-point star, drawn beside the marker rather than spelled out. */
function drawStar(g: Graphics): void {
  const { x, y } = TAG_OFFSET;
  const points: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? STAR.outer : STAR.inner;
    const angle = -Math.PI / 2 + (Math.PI / 5) * i;
    points.push(x + r * Math.cos(angle), y + r * Math.sin(angle));
  }
  g.poly(points).fill({ color: MARKER_COLOR, alpha: MARKER.alpha });
}

/** A seat the generator may give to a human player or the AI: the robot behind the person's shoulder. */
function drawSeat(g: Graphics): void {
  const { x, y } = OFFSET;
  const s = MARKER.size;
  drawRobot(g, x + s * 0.5, y - s * 0.35, s * 0.7, MARKER_COLOR);
  drawPerson(g, x - s * 0.35, y + s * 0.2, s * 0.8, MARKER_COLOR);
}

/** The person: a head over a pair of shoulders. */
function drawPerson(g: Graphics, x: number, y: number, s: number, color: number): void {
  g.circle(x, y - s * 0.46, s * 0.36)
    .fill({ color, alpha: MARKER.alpha })
    .arc(x, y + s * 0.95, s * 0.72, Math.PI, 2 * Math.PI)
    .stroke({ color, width: MARKER.width, alpha: MARKER.alpha });
}

/** The robot: a square head with two eyes and a stub of an antenna. */
function drawRobot(g: Graphics, x: number, y: number, s: number, color: number): void {
  g.moveTo(x, y - s)
    .lineTo(x, y - s * 0.62)
    .roundRect(x - s * 0.78, y - s * 0.62, s * 1.56, s * 1.4, s * 0.3)
    .stroke({ color, width: MARKER.width, alpha: MARKER.alpha })
    .circle(x - s * 0.33, y + s * 0.08, MARKER.dot * 0.55)
    .circle(x + s * 0.33, y + s * 0.08, MARKER.dot * 0.55)
    .fill({ color, alpha: MARKER.alpha });
}

/**
 * Where the galaxy generator may put an empire: a screen-sized mark beside every scenario
 * system the generator draws on, as `lib/spawn` decides it. A save has none, so the layer is
 * registered only for a document whose systems can be written.
 */
export class SpawnsLayer implements MapLayer {
  readonly id = "spawns" as const;
  readonly container = new Container();
  private readonly markers = new Map<number, Graphics>();
  private readonly tagsContainer = new Container({ label: "tags" });
  private readonly tags = new Map<number, Graphics>();
  private readonly tagLabels = new Map<number, BitmapText>();
  private readonly tagKeys = new Map<number, string>();
  private readonly freeTagLabels: BitmapText[] = [];
  private ctx: RenderContext = EMPTY_CONTEXT;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private ghosts: ReadonlyMap<number, MoveGhost> = NO_GHOSTS;
  private hovered: number | null = null;
  private readonly scale = { x: 1, y: 1 };

  constructor() {
    this.container.eventMode = "passive";
    this.container.addChild(this.tagsContainer);
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    this.systems = ctx.systems;
    if (ctx.systems === prev.systems) return;
    for (const id of [...this.markers.keys()]) {
      if (!ctx.systems.has(id)) this.remove(id);
    }
    for (const s of ctx.systems.values()) this.place(s);
  }

  applyDelta(d: GalaxyDelta): void {
    for (const id of d.removed ?? []) this.remove(id);
    for (const s of d.systems) this.place(s);
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    for (const g of this.markers.values()) g.scale.set(this.scale.x, this.scale.y);
    for (const g of this.tags.values()) g.scale.set(this.scale.x, this.scale.y);
    for (const [id, label] of this.tagLabels) {
      const g = this.tags.get(id);
      if (g) this.placeLabel(label, g.position);
    }
  }

  /** The letters sit on the chip, whose offset from the marker grows with the marker's scale. */
  private placeLabel(label: BitmapText, at: { x: number; y: number }): void {
    label.position.set(at.x + TAG_OFFSET.x * this.scale.x, at.y + TAG_OFFSET.y * this.scale.y);
    label.scale.set(this.scale.x, this.scale.y);
  }

  /** The dragged systems' marks follow their ghosts, dimmed. */
  setDragState(drag: DragState | null): void {
    const byId = drag?.byId ?? NO_GHOSTS;
    const affected = new Set([...this.ghosts.keys(), ...byId.keys()]);
    this.ghosts = byId;
    for (const id of affected) {
      const s = this.systems.get(id);
      if (s) this.place(s);
    }
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private place(s: SystemNode): void {
    if (!isSpawnPoint(s)) {
      this.remove(s.id);
      return;
    }
    let g = this.markers.get(s.id);
    if (!g) {
      g = this.makeMarker(s.id);
      drawSeat(g);
      this.markers.set(s.id, g);
    }
    const ghost = this.ghosts.get(s.id);
    const at = ghost ?? s;
    g.position.set(at.x, at.y);
    g.alpha = ghost ? GHOST_ALPHA : 1;
    g.scale.set(this.scale.x, this.scale.y);
    this.placeTag(s, at, ghost !== undefined);
  }

  /** The scripted seat's kind, drawn beside the marker and moved, dimmed or dropped with it. */
  private placeTag(s: SystemNode, at: { x: number; y: number }, ghosted: boolean): void {
    const tag = s.spawn_script === null ? null : tagOf(s.spawn_script);
    const key = tagKey(tag);
    if (this.tagKeys.get(s.id) !== key) {
      this.tagKeys.set(s.id, key);
      this.drawTag(s.id, tag);
    }
    const g = this.tags.get(s.id);
    if (g) {
      g.position.set(at.x, at.y);
      g.alpha = ghosted ? GHOST_ALPHA : 1;
      g.scale.set(this.scale.x, this.scale.y);
    }
    const label = this.tagLabels.get(s.id);
    if (label) {
      this.placeLabel(label, at);
      label.alpha = ghosted ? GHOST_ALPHA : 1;
    }
  }

  private drawTag(id: number, tag: Tag): void {
    this.releaseTag(id);
    if (tag === null) return;
    const g = new Graphics();
    this.tagsContainer.addChild(g);
    this.tags.set(id, g);
    if (tag === "star") {
      drawStar(g);
      return;
    }
    drawChip(g, tag.weighted);
    const label = this.freeTagLabels.pop() ?? this.makeTagLabel();
    label.text = tag.letters;
    label.visible = true;
    this.tagsContainer.addChild(label);
    this.tagLabels.set(id, label);
  }

  private makeTagLabel(): BitmapText {
    const label = new BitmapText({ text: "", style: TAG_STYLE });
    label.anchor.set(0.5);
    return label;
  }

  private releaseTag(id: number): void {
    const g = this.tags.get(id);
    if (g) {
      this.tags.delete(id);
      g.destroy();
    }
    const label = this.tagLabels.get(id);
    if (label) {
      this.tagLabels.delete(id);
      label.visible = false;
      this.freeTagLabels.push(label);
    }
  }

  private makeMarker(id: number): Graphics {
    const g = new Graphics();
    g.eventMode = "static";
    g.cursor = "help";
    g.hitArea = HIT;
    g.on("pointerover", (e: FederatedPointerEvent) => this.hover(id, e.global));
    g.on("pointerout", () => this.unhover(id));
    this.container.addChild(g);
    return g;
  }

  private hover(id: number, at: { x: number; y: number }): void {
    const s = this.systems.get(id);
    if (!s || !isSpawnPoint(s)) return;
    this.hovered = id;
    const name = this.ctx.nodeName(s.name);
    const weight =
      s.spawn_script === null
        ? `Spawn point · weight ${s.spawn_weight ?? 0}`
        : `Spawn point · Paint a Galaxy ${spawnScriptLabel(s.spawn_script)}`;
    useMapChromeStore.getState().showTooltip({
      x: at.x,
      y: at.y,
      title: name === "" ? "Spawn point" : name,
      lines: [weight],
    });
  }

  private unhover(id: number): void {
    if (this.hovered !== id) return;
    this.hovered = null;
    useMapChromeStore.getState().hideTooltip();
  }

  private remove(id: number): void {
    const g = this.markers.get(id);
    if (!g) return;
    this.unhover(id);
    g.destroy();
    this.markers.delete(id);
    this.releaseTag(id);
    this.tagKeys.delete(id);
  }
}
