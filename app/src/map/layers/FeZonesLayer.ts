import { BitmapText, Container, type FederatedPointerEvent, Graphics, TextStyle } from "pixi.js";
import type { FeKind } from "../../generated/FeKind";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SystemNode } from "../../generated/SystemNode";
import { linkedTo, takesCustomLinks } from "../../lib/feLinks";
import { FE_ZONE_RADIUS, feKindLabel, feZoneCentre } from "../../lib/feZone";
import { GHOST_ALPHA, MAP_FONT } from "../../lib/visual/style";
import type { Camera } from "../Camera";
import { useMapChromeStore } from "../../store/mapChromeStore";
import type { MoveGhost } from "../moveGhosts";
import { FE_ZONE_RING_HIT_PX } from "../picking/zones";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import type { DragState, MapLayer } from "./MapLayer";

/** The zones' hue: a magenta no other layer uses, so a ring reads as the mod's, not the game's. */
const RING = { color: 0xf0abfc, alpha: 0.75 };
/** The ring whose anchor is selected: the same hue, filled and fully drawn. */
const SELECTED_RING = { color: 0xf5d0fe, alpha: 1 };
const SELECTED_FILL = { color: 0xf0abfc, alpha: 0.12 };
const DASHES = 32;

/** What the tooltip calls the ring. */
export const FE_ZONE_TITLE = "Fallen empire zone";

/** What the tooltip says the ring is for. */
export const FE_ZONE_NOTE = "the mod creates the empire's systems here";

/** What the tooltip adds for a zone the mod offered rather than the user placed. */
export const AUTOMATIC_NOTE = "automatic";

/** One shared instance: PixiJS keys a stroked dynamic bitmap font by the style object. */
const TAG_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 9,
  fontWeight: "700",
  fill: 0xf5d0fe,
});

const NO_GHOSTS: ReadonlyMap<number, MoveGhost> = new Map();

/** The ring band about the graphics' own origin, in world units; the disc inside is not a hit. */
class RingBand {
  band = FE_ZONE_RING_HIT_PX;

  contains(x: number, y: number): boolean {
    return Math.abs(Math.hypot(x, y) - FE_ZONE_RADIUS) <= this.band;
  }
}

/** How much of each dash step is drawn, on the ring and on the lines to its linked systems. */
const DASH_FRACTION = 0.6;
/** One dash step along a line, in world units: the ring's own arc step, so both read alike. */
const LINE_DASH_STEP = (Math.PI * 2 * FE_ZONE_RADIUS) / DASHES;

function dashedRing(g: Graphics): void {
  const step = (Math.PI * 2) / DASHES;
  for (let i = 0; i < DASHES; i++) {
    const start = i * step;
    g.moveTo(FE_ZONE_RADIUS * Math.cos(start), FE_ZONE_RADIUS * Math.sin(start)).arc(
      0,
      0,
      FE_ZONE_RADIUS,
      start,
      start + step * DASH_FRACTION,
    );
  }
}

/** A dashed straight from `from` to `to`, both about the graphics' origin; the last dash reaches `to`. */
function dashedLine(
  g: Graphics,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  for (let at = 0; at < length; at += LINE_DASH_STEP) {
    const last = at + LINE_DASH_STEP >= length;
    const end = last ? length : at + LINE_DASH_STEP * DASH_FRACTION;
    g.moveTo(from.x + ux * at, from.y + uy * at).lineTo(from.x + ux * end, from.y + uy * end);
  }
}

/**
 * The lines from each linked system to the nearest point of the ring, drawn about the centre. A
 * system inside the ring gets none: the core refuses a ring over a system.
 */
function drawLinks(g: Graphics, linked: ReadonlyArray<{ x: number; y: number }>): void {
  g.clear();
  for (const at of linked) {
    const d = Math.hypot(at.x, at.y);
    if (d <= FE_ZONE_RADIUS) continue;
    const t = FE_ZONE_RADIUS / d;
    dashedLine(g, { x: at.x * t, y: at.y * t }, at);
  }
  g.stroke({ ...RING, pixelLine: true });
}

/** The ring and the line back to the anchor, drawn about the centre. */
function draw(g: Graphics, anchorDx: number, anchorDy: number, selected: boolean): void {
  g.clear();
  if (selected) g.circle(0, 0, FE_ZONE_RADIUS).fill(SELECTED_FILL);
  dashedRing(g);
  const d = Math.hypot(anchorDx, anchorDy);
  if (d > FE_ZONE_RADIUS) {
    const t = FE_ZONE_RADIUS / d;
    g.moveTo(anchorDx, anchorDy).lineTo(anchorDx * t, anchorDy * t);
  }
  g.stroke({ ...(selected ? SELECTED_RING : RING), pixelLine: true });
}

/** Only a scenario written for the mod carries zones the map should draw. */
function drawn(ctx: RenderContext): boolean {
  return ctx.kind === "scenario" && ctx.paintLayer;
}

/** The centre text: the ring's name, and the kind's full label below it unless it is random. */
function centreText(kind: FeKind): string {
  return kind === "random" ? FE_ZONE_TITLE : `${FE_ZONE_TITLE}\n${feKindLabel(kind)}`;
}

/** How much fainter the spawn ghosts are drawn than the ring that carries them. */
const SPAWN_GHOST_ALPHA_FRACTION = 1 / 3;

/** The home star's radius: hollow, so the centre text stays legible drawn over it. */
const HOME_STAR_RADIUS = 3.5;
const SATELLITE_RADIUS = 1.4;
const SATELLITE_MIN_DISTANCE = 15;
const SATELLITE_DISTANCE_SPAN = 10;
const SATELLITE_COUNT_MIN = 4;
const SATELLITE_COUNT_OPTIONS = 3;

/** A tiny deterministic generator: the same seed always yields the same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spreads an id's bits before it seeds the generator, so consecutive ids do not draw alike. */
function hashId(id: number): number {
  let x = Math.imul(id ^ (id >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** The satellites the mod hyperlanes to the home star, offset from the centre, by anchor id. */
function spawnSatellites(id: number): Array<{ x: number; y: number }> {
  const rand = mulberry32(hashId(id));
  const count = SATELLITE_COUNT_MIN + Math.floor(rand() * SATELLITE_COUNT_OPTIONS);
  const step = (Math.PI * 2) / count;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const angle = i * step + (rand() - 0.5) * step * 0.6;
    const distance = SATELLITE_MIN_DISTANCE + rand() * SATELLITE_DISTANCE_SPAN;
    points.push({ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance });
  }
  return points;
}

/**
 * The zone's ghost system, stable for a given anchor id: a hollow home star at the centre and
 * its satellites, each joined to it by a faint ghost lane.
 */
function drawSpawnGhosts(g: Graphics, id: number): void {
  g.clear();
  const satellites = spawnSatellites(id);
  for (const sat of satellites) g.moveTo(0, 0).lineTo(sat.x, sat.y);
  g.stroke({ color: RING.color, alpha: 1, pixelLine: true });
  for (const sat of satellites) g.circle(sat.x, sat.y, SATELLITE_RADIUS).fill(RING.color);
  g.circle(0, 0, HOME_STAR_RADIUS).stroke({ color: RING.color, alpha: 1, pixelLine: true });
}

/**
 * Paint a Galaxy's fallen empire zones: a dashed ring of empty space at the point each anchor
 * system names, tied to its anchor by a line, with the ring's name and the kind's full label
 * at the centre, over a faint ghost of the home star and satellites the mod spawns there. A
 * ring the mod offered rather than the user placed is drawn as a ghost until a change makes it
 * theirs. A zone that takes custom connections has a dashed line from each linked system to
 * the nearest point of its ring.
 */
export class FeZonesLayer implements MapLayer {
  readonly id = "feZones" as const;
  readonly container = new Container();
  private readonly rings = new Map<number, Graphics>();
  private readonly bands = new Map<number, RingBand>();
  private readonly linksContainer = new Container({ label: "links", eventMode: "none" });
  private readonly links = new Map<number, Graphics>();
  private readonly freeLinks: Graphics[] = [];
  /** The systems each anchor's lines are drawn from, so a change to one redraws the anchor. */
  private readonly linkedIds = new Map<number, number[]>();
  private readonly spawnGhostsContainer = new Container({
    label: "spawnGhosts",
    eventMode: "none",
  });
  private readonly spawnGhosts = new Map<number, Graphics>();
  private readonly freeSpawnGhosts: Graphics[] = [];
  private readonly tagsContainer = new Container({ label: "tags" });
  private readonly tags = new Map<number, BitmapText>();
  private readonly freeTags: BitmapText[] = [];
  private ctx: RenderContext = EMPTY_CONTEXT;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private ghosts: ReadonlyMap<number, MoveGhost> = NO_GHOSTS;
  private selection: ReadonlySet<number> = new Set();
  private hovered: number | null = null;
  private camScale = 1;
  private readonly scale = { x: 1, y: 1 };

  constructor() {
    this.container.eventMode = "passive";
    this.container.addChild(this.linksContainer);
    this.container.addChild(this.spawnGhostsContainer);
    this.container.addChild(this.tagsContainer);
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    this.systems = ctx.systems;
    if (ctx.systems === prev.systems && drawn(ctx) === drawn(prev)) return;
    for (const id of [...this.rings.keys()]) {
      if (!ctx.systems.has(id)) this.remove(id);
    }
    for (const s of ctx.systems.values()) this.place(s);
  }

  applyDelta(d: GalaxyDelta): void {
    // The lines read the linked systems' positions, so the layer's own view takes the delta too.
    const systems = new Map(this.systems);
    for (const id of d.removed ?? []) systems.delete(id);
    for (const s of d.systems) systems.set(s.id, s);
    this.systems = systems;
    for (const id of d.removed ?? []) this.remove(id);
    for (const s of d.systems) this.place(s);
    const touched = new Set([...(d.removed ?? []), ...d.systems.map((s) => s.id)]);
    for (const id of this.anchorsLinkedFrom(touched, d.systems)) {
      const anchor = this.systems.get(id);
      if (anchor && !touched.has(id)) this.place(anchor);
    }
  }

  onViewport(cam: Camera): void {
    cam.childScale(1, this.scale);
    for (const tag of this.tags.values()) tag.scale.set(this.scale.x, this.scale.y);
    if (cam.scale === this.camScale) return;
    this.camScale = cam.scale;
    for (const band of this.bands.values()) band.band = FE_ZONE_RING_HIT_PX / cam.scale;
  }

  /** A dragged anchor's ring follows its ghost, dimmed; a dragged linked system takes its line along. */
  setDragState(drag: DragState | null): void {
    const byId = drag?.byId ?? NO_GHOSTS;
    const affected = new Set([...this.ghosts.keys(), ...byId.keys()]);
    this.ghosts = byId;
    for (const id of this.anchorsLinkedFrom(affected, [])) affected.add(id);
    for (const id of affected) {
      const s = this.systems.get(id);
      if (s) this.place(s);
    }
  }

  setSelection(ids: readonly number[]): void {
    const affected = new Set([...this.selection, ...ids]);
    this.selection = new Set(ids);
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
    const zone = s.fe_zone;
    if (zone === null || !drawn(this.ctx)) {
      this.remove(s.id);
      return;
    }
    let g = this.rings.get(s.id);
    if (!g) {
      g = this.makeRing(s.id);
      this.rings.set(s.id, g);
    }
    const ghost = this.ghosts.get(s.id);
    const at = ghost ?? s;
    const centre = feZoneCentre(at, zone);
    draw(g, at.x - centre.x, at.y - centre.y, this.selection.has(s.id));
    g.position.set(centre.x, centre.y);
    g.alpha = ghost || !zone.preferred ? GHOST_ALPHA : 1;
    this.placeSpawnGhosts(s.id, centre, g.alpha);
    this.placeTag(s.id, centreText(zone.kind), centre, g.alpha);
    this.placeLinks(s, centre, g.alpha);
  }

  /**
   * The anchors whose lines a change to `ids` moves: those drawn from one of them, and those
   * `changed` now links to.
   */
  private anchorsLinkedFrom(ids: ReadonlySet<number>, changed: readonly SystemNode[]): Set<number> {
    const anchors = new Set<number>();
    for (const [anchor, linked] of this.linkedIds) {
      if (linked.some((id) => ids.has(id))) anchors.add(anchor);
    }
    const wanted = new Set(changed.flatMap((s) => s.fe_link.to));
    if (wanted.size > 0) {
      for (const s of this.systems.values()) {
        if (takesCustomLinks(s) && wanted.has(s.fe_link.id as number)) anchors.add(s.id);
      }
    }
    return anchors;
  }

  private placeLinks(anchor: SystemNode, centre: { x: number; y: number }, alpha: number): void {
    const linked = takesCustomLinks(anchor) ? linkedTo(anchor, this.systems) : [];
    if (linked.length === 0) {
      this.releaseLinks(anchor.id);
      return;
    }
    let g = this.links.get(anchor.id);
    if (!g) {
      g = this.freeLinks.pop() ?? new Graphics();
      g.visible = true;
      this.linksContainer.addChild(g);
      this.links.set(anchor.id, g);
    }
    const ends = linked.map((s) => {
      const at = this.ghosts.get(s.id) ?? s;
      return { x: at.x - centre.x, y: at.y - centre.y };
    });
    drawLinks(g, ends);
    g.position.set(centre.x, centre.y);
    g.alpha = alpha;
    this.linkedIds.set(
      anchor.id,
      linked.map((s) => s.id),
    );
  }

  private releaseLinks(id: number): void {
    this.linkedIds.delete(id);
    const g = this.links.get(id);
    if (!g) return;
    this.links.delete(id);
    g.visible = false;
    this.freeLinks.push(g);
  }

  private placeSpawnGhosts(id: number, at: { x: number; y: number }, ringAlpha: number): void {
    let g = this.spawnGhosts.get(id);
    if (!g) {
      g = this.freeSpawnGhosts.pop() ?? this.makeSpawnGhosts();
      drawSpawnGhosts(g, id);
      g.visible = true;
      this.spawnGhostsContainer.addChild(g);
      this.spawnGhosts.set(id, g);
    }
    g.position.set(at.x, at.y);
    g.alpha = ringAlpha * SPAWN_GHOST_ALPHA_FRACTION;
  }

  private makeSpawnGhosts(): Graphics {
    const g = new Graphics();
    g.eventMode = "none";
    return g;
  }

  private releaseSpawnGhosts(id: number): void {
    const g = this.spawnGhosts.get(id);
    if (!g) return;
    this.spawnGhosts.delete(id);
    g.visible = false;
    this.freeSpawnGhosts.push(g);
  }

  private placeTag(id: number, text: string, at: { x: number; y: number }, alpha: number): void {
    let tag = this.tags.get(id);
    if (!tag) {
      tag = this.freeTags.pop() ?? this.makeTag();
      tag.visible = true;
      this.tagsContainer.addChild(tag);
      this.tags.set(id, tag);
    }
    if (tag.text !== text) tag.text = text;
    tag.position.set(at.x, at.y);
    tag.alpha = alpha;
    tag.scale.set(this.scale.x, this.scale.y);
  }

  private makeTag(): BitmapText {
    const tag = new BitmapText({ text: "", style: TAG_STYLE });
    tag.anchor.set(0.5);
    return tag;
  }

  private releaseTag(id: number): void {
    const tag = this.tags.get(id);
    if (!tag) return;
    this.tags.delete(id);
    tag.visible = false;
    this.freeTags.push(tag);
  }

  private makeRing(id: number): Graphics {
    const g = new Graphics();
    const band = new RingBand();
    band.band = FE_ZONE_RING_HIT_PX / this.camScale;
    this.bands.set(id, band);
    g.eventMode = "static";
    g.cursor = "move";
    g.hitArea = band;
    g.on("pointerover", (e: FederatedPointerEvent) => this.hover(id, e.global));
    g.on("pointerout", () => this.unhover(id));
    this.container.addChildAt(g, 0);
    return g;
  }

  private hover(id: number, at: { x: number; y: number }): void {
    const s = this.systems.get(id);
    if (!s || s.fe_zone === null) return;
    this.hovered = id;
    const name = this.ctx.nodeName(s.name);
    const parts = [
      feKindLabel(s.fe_zone.kind),
      name === "" ? `system ${s.id}` : name,
      FE_ZONE_NOTE,
    ];
    if (!s.fe_zone.preferred) parts.push(AUTOMATIC_NOTE);
    useMapChromeStore.getState().showTooltip({
      x: at.x,
      y: at.y,
      title: FE_ZONE_TITLE,
      lines: [parts.join(" · ")],
    });
  }

  private unhover(id: number): void {
    if (this.hovered !== id) return;
    this.hovered = null;
    useMapChromeStore.getState().hideTooltip();
  }

  private remove(id: number): void {
    const g = this.rings.get(id);
    if (!g) return;
    this.unhover(id);
    g.destroy();
    this.rings.delete(id);
    this.bands.delete(id);
    this.releaseTag(id);
    this.releaseSpawnGhosts(id);
    this.releaseLinks(id);
  }
}
