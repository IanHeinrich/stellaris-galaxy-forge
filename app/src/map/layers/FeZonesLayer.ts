import { BitmapText, Container, type FederatedPointerEvent, Graphics, TextStyle } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SystemNode } from "../../generated/SystemNode";
import { FE_ZONE_RADIUS, feKindLabel, feKindTag, feZoneCentre } from "../../lib/feZone";
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
  fontSize: 11,
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

function dashedRing(g: Graphics): void {
  const step = (Math.PI * 2) / DASHES;
  for (let i = 0; i < DASHES; i++) {
    const start = i * step;
    g.moveTo(FE_ZONE_RADIUS * Math.cos(start), FE_ZONE_RADIUS * Math.sin(start)).arc(
      0,
      0,
      FE_ZONE_RADIUS,
      start,
      start + step * 0.6,
    );
  }
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

/**
 * Paint a Galaxy's fallen empire zones: a dashed ring of empty space at the point each anchor
 * system names, tied to its anchor by a line, with the kind's tag at the centre. A ring the
 * mod offered rather than the user placed is drawn as a ghost until a change makes it theirs.
 */
export class FeZonesLayer implements MapLayer {
  readonly id = "feZones" as const;
  readonly container = new Container();
  private readonly rings = new Map<number, Graphics>();
  private readonly bands = new Map<number, RingBand>();
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
    for (const id of d.removed ?? []) this.remove(id);
    for (const s of d.systems) this.place(s);
  }

  onViewport(cam: Camera): void {
    cam.childScale(1, this.scale);
    for (const tag of this.tags.values()) tag.scale.set(this.scale.x, this.scale.y);
    if (cam.scale === this.camScale) return;
    this.camScale = cam.scale;
    for (const band of this.bands.values()) band.band = FE_ZONE_RING_HIT_PX / cam.scale;
  }

  /** A dragged anchor's ring follows its ghost, dimmed. */
  setDragState(drag: DragState | null): void {
    const byId = drag?.byId ?? NO_GHOSTS;
    const affected = new Set([...this.ghosts.keys(), ...byId.keys()]);
    this.ghosts = byId;
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
    this.placeTag(s.id, feKindTag(zone.kind), centre, g.alpha);
  }

  private placeTag(id: number, text: string, at: { x: number; y: number }, alpha: number): void {
    if (text === "") {
      this.releaseTag(id);
      return;
    }
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
  }
}
