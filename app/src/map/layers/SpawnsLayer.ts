import { Circle, Container, type FederatedPointerEvent, Graphics } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SystemNode } from "../../generated/SystemNode";
import { spawnScriptLabel } from "../../lib/paint";
import { isAiReserved, isHumanReserved, isSpawnPoint } from "../../lib/spawn";
import { GHOST_ALPHA } from "../../lib/visual/style";
import type { Camera } from "../Camera";
import { useMapChromeStore } from "../../store/mapChromeStore";
import type { MoveGhost } from "../moveGhosts";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { markerScale, type DragState, type MapLayer } from "./MapLayer";

const MARKER = { size: 4.5, width: 1.5, alpha: 0.95, dot: 1.4 };

/** Who holds the seat: nobody, a human player, or the AI. */
type Seat = "open" | "human" | "ai";

/** One amber for every seat: the figure says who holds it. */
const MARKER_COLOR = 0xfbbf24;

/** What the tooltip adds after the weight for a seat held for a human player. */
export const RESERVED_NOTE = "reserved for a human player";

/** What the tooltip adds after the weight for a seat held for the AI. */
export const AI_RESERVED_NOTE = "reserved for the AI";

/** Marker centre relative to the star, in marker units: clear of the ring, opposite the bypasses. */
const OFFSET = { x: -12, y: -12 };

const NO_GHOSTS: ReadonlyMap<number, MoveGhost> = new Map();

/** The mark's own hit area, around its offset centre, so the star's hover and drag stay free. */
const HIT = new Circle(OFFSET.x, OFFSET.y, MARKER.size + 2.5);

function seatOf(s: SystemNode): Seat {
  if (isHumanReserved(s)) return "human";
  if (isAiReserved(s)) return "ai";
  return "open";
}

function note(seat: Seat): string | null {
  if (seat === "human") return RESERVED_NOTE;
  if (seat === "ai") return AI_RESERVED_NOTE;
  return null;
}

/** An open seat, which the generator may give to either: the robot behind the person's shoulder. */
function drawOpen(g: Graphics, x: number, y: number, s: number, color: number): void {
  drawRobot(g, x + s * 0.5, y - s * 0.35, s * 0.7, color);
  drawPerson(g, x - s * 0.35, y + s * 0.2, s * 0.8, color);
}

/** A human player's seat: a head over a pair of shoulders. */
function drawPerson(g: Graphics, x: number, y: number, s: number, color: number): void {
  g.circle(x, y - s * 0.46, s * 0.36)
    .fill({ color, alpha: MARKER.alpha })
    .arc(x, y + s * 0.95, s * 0.72, Math.PI, 2 * Math.PI)
    .stroke({ color, width: MARKER.width, alpha: MARKER.alpha });
}

/** The AI's seat: a square head with two eyes and a stub of an antenna. */
function drawRobot(g: Graphics, x: number, y: number, s: number, color: number): void {
  g.moveTo(x, y - s)
    .lineTo(x, y - s * 0.62)
    .roundRect(x - s * 0.78, y - s * 0.62, s * 1.56, s * 1.4, s * 0.3)
    .stroke({ color, width: MARKER.width, alpha: MARKER.alpha })
    .circle(x - s * 0.33, y + s * 0.08, MARKER.dot * 0.55)
    .circle(x + s * 0.33, y + s * 0.08, MARKER.dot * 0.55)
    .fill({ color, alpha: MARKER.alpha });
}

function draw(g: Graphics, seat: Seat): void {
  const { x, y } = OFFSET;
  const s = MARKER.size;
  const color = MARKER_COLOR;
  g.clear();
  if (seat === "human") drawPerson(g, x, y, s, color);
  else if (seat === "ai") drawRobot(g, x, y, s, color);
  else drawOpen(g, x, y, s, color);
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
  private readonly seats = new Map<number, Seat>();
  private ctx: RenderContext = EMPTY_CONTEXT;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private ghosts: ReadonlyMap<number, MoveGhost> = NO_GHOSTS;
  private hovered: number | null = null;
  private readonly scale = { x: 1, y: 1 };

  constructor() {
    this.container.eventMode = "passive";
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
      this.markers.set(s.id, g);
    }
    const seat = seatOf(s);
    if (this.seats.get(s.id) !== seat) {
      this.seats.set(s.id, seat);
      draw(g, seat);
    }
    const ghost = this.ghosts.get(s.id);
    const at = ghost ?? s;
    g.position.set(at.x, at.y);
    g.alpha = ghost ? GHOST_ALPHA : 1;
    g.scale.set(this.scale.x, this.scale.y);
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
    const held = note(seatOf(s));
    useMapChromeStore.getState().showTooltip({
      x: at.x,
      y: at.y,
      title: name === "" ? "Spawn point" : name,
      lines: [held === null ? weight : `${weight} · ${held}`],
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
    this.seats.delete(id);
  }
}
