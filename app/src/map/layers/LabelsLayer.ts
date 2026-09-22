import { BitmapText, Container, NineSliceSprite, Texture } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SystemNode } from "../../generated/SystemNode";
import { PLATE_BORDER_PX } from "../../lib/details/icons";
import { nameRowY, plateBox, plateKey } from "../../lib/details/layout";
import type { Camera } from "../Camera";
import { compareImportance, labelTier } from "../../lib/visual/labels";
import type { MoveGhost } from "../moveGhosts";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { dimmedByInitializer, initializerLabel } from "../../lib/initializer/initializerLabels";
import { FILTERED_ALPHA, GHOST_ALPHA, INITIALIZER_ALPHA } from "../../lib/visual/style";
import { getTexture, onTextures, requestTextures } from "../../lib/visual/textures";
import type { DragState, MapLayer } from "./MapLayer";
import { NAME_STYLE, nameHalf } from "./nameWidth";

const NO_GHOSTS: ReadonlyMap<number, MoveGhost> = new Map();

/** Screen margin around the view within which a system still gets a label. */
const VIEW_PAD_PX = 64;
const MAX_LABELS = 400;
/** Selected systems in view that are labelled whatever their rank, at most. */
const MAX_PINNED = 400;

/** Where `node` belongs in `order`, which is sorted by `compareImportance`. */
function rankIn(order: readonly SystemNode[], node: SystemNode): number {
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareImportance(order[mid], node) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A pool of BitmapText shared by the systems in the current view, most important first, each
 * over the game's dark plate when the system is colonised. One label per system: its name, or,
 * for a scenario system without one, the initializer standing in for it.
 */
export class LabelsLayer implements MapLayer {
  readonly id = "labels" as const;
  readonly container = new Container();
  private readonly plates = new Container();
  private ctx: RenderContext = EMPTY_CONTEXT;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private grid = EMPTY_CONTEXT.grid;
  private order: SystemNode[] = [];
  /** Each system as it was when ranked, so a delta can find it in `order` again. */
  private readonly ranked = new Map<number, SystemNode>();
  private readonly inView = new Set<number>();
  private readonly shown = new Map<number, BitmapText>();
  private readonly free: BitmapText[] = [];
  private readonly shownPlates = new Map<number, NineSliceSprite>();
  private readonly freePlates: NineSliceSprite[] = [];
  private readonly wanted = new Set<number>();
  private readonly bounds = [0, 0, 0, 0];
  private readonly scale = { x: 1, y: 1 };
  /** Gap between the star and the top of the name row, shared by every label this frame. */
  private offsetY = nameRowY(1);
  private lastRev = -1;
  private visible = true;
  private ghosts: ReadonlyMap<number, MoveGhost> = NO_GHOSTS;
  private pinned: ReadonlySet<number> = new Set();
  private readonly pinnedInView = new Set<number>();
  private hovered: number | null = null;
  /** Whether the last pass labelled anything, so a hover labels only where a pass would. */
  private labelling = false;
  private namesDirty = false;
  private platesQueued = false;
  private readonly unsubscribe: Array<() => void> = [];
  private readonly markInView = (s: SystemNode): void => {
    this.inView.add(s.id);
    if (this.keepsNames && this.nameOf(s) !== "") this.wanted.add(s.id);
    if (this.pinned.has(s.id)) this.pinnedInView.add(s.id);
  };

  constructor() {
    this.container.addChild(this.plates);
    this.unsubscribe.push(onTextures(() => this.schedulePlates()));
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    this.systems = ctx.systems;
    this.grid = ctx.grid;
    if (ctx.galaxy !== prev.galaxy) {
      this.releaseAll();
      this.reorder();
      return;
    }
    if (
      ctx.names !== prev.names ||
      ctx.kind !== prev.kind ||
      ctx.initializerLabels !== prev.initializerLabels ||
      ctx.hiddenInitializers !== prev.hiddenInitializers ||
      ctx.territoriesShown !== prev.territoriesShown
    ) {
      this.namesDirty = true;
      this.lastRev = -1;
    }
    if (ctx.detailsVersion !== prev.detailsVersion || ctx.coloniesShown !== prev.coloniesShown) {
      this.schedulePlates();
    }
  }

  applyDelta(d: GalaxyDelta): void {
    for (const id of d.removed ?? []) this.drop(id);
    for (const s of d.systems) {
      const label = this.shown.get(s.id);
      if (label) this.assign(label, s);
    }
    this.reorderAfter(d);
    this.placePlates();
  }

  onViewport(cam: Camera): void {
    if (!this.visible) return;
    if (cam.rev === this.lastRev) return;
    this.lastRev = cam.rev;
    const tier = labelTier(cam.scale);
    if (tier === "none" && !this.keepsNames) {
      this.labelling = false;
      this.releaseAll();
      return;
    }
    this.labelling = true;
    this.offsetY = nameRowY(cam.scale);
    cam.childScale(1, this.scale);
    const pad = VIEW_PAD_PX / cam.scale;
    const b = cam.worldBounds(this.bounds);
    const { order, inView, wanted } = this;
    inView.clear();
    wanted.clear();
    this.pinnedInView.clear();
    this.grid.forEachIn(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad, this.markInView);

    for (const id of this.topPinned()) {
      const s = this.systems.get(id);
      if (s && this.textOf(s) !== "") wanted.add(id);
    }
    if (tier !== "none") {
      let ranked = 0;
      for (let rank = 0; rank < order.length && ranked < MAX_LABELS; rank++) {
        if (!inView.has(order[rank].id) || this.textOf(order[rank]) === "") continue;
        wanted.add(order[rank].id);
        ranked++;
      }
    }
    for (const [id, label] of this.shown) {
      if (!wanted.has(id) && id !== this.hovered) {
        this.shown.delete(id);
        this.release(label);
      }
    }
    for (const id of wanted) this.show(id);
    if (this.hovered !== null) this.show(this.hovered);
    if (this.namesDirty) {
      for (const [id, label] of this.shown) {
        const s = this.systems.get(id);
        if (s) this.assign(label, s);
      }
      this.namesDirty = false;
    }
    for (const label of this.shown.values()) this.fit(label);
    this.placePlates();
  }

  /** Systems whose label is placed before any other, whatever their rank, while in view. */
  setPinned(ids: readonly number[]): void {
    this.pinned = new Set(ids);
    this.lastRev = -1;
  }

  /** The system under the pointer, labelled whatever its rank until the pointer leaves it. */
  setHovered(id: number | null): void {
    const prev = this.hovered;
    if (id === prev) return;
    this.hovered = id;
    if (prev !== null && !this.wanted.has(prev)) this.drop(prev);
    if (id === null || !this.visible || !this.labelling || this.shown.has(id)) return;
    const label = this.show(id);
    if (!label) return;
    this.fit(label);
    this.placePlate(id, label);
  }

  /** The dragged systems' names follow their ghosts. */
  setDragState(drag: DragState | null): void {
    this.ghosts = drag?.byId ?? NO_GHOSTS;
    this.restyleShown();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.container.visible = v;
    if (v) this.lastRev = -1;
  }

  destroy(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    this.container.destroy({ children: true });
  }

  /** A scenario's named systems are labelled at every zoom, unless its scripted empires name the regions. */
  private get keepsNames(): boolean {
    return this.ctx.kind === "scenario" && !this.ctx.territoriesShown;
  }

  private nameOf(s: SystemNode): string {
    return this.ctx.nodeName(s.name);
  }

  /** What a system's one label says: its name, or the initializer the legend still shows. */
  private textOf(s: SystemNode): string {
    const name = this.nameOf(s);
    if (name !== "" || !this.ctx.initializerLabels) return name;
    if (dimmedByInitializer(s, this.ctx.hiddenInitializers)) return "";
    return initializerLabel(s.initializer);
  }

  private reorder(): void {
    this.order = Array.from(this.systems.values()).sort(compareImportance);
    this.ranked.clear();
    for (const s of this.order) this.ranked.set(s.id, s);
    this.lastRev = -1;
  }

  /** The most important of the selected systems in view, up to the pinned budget. */
  private topPinned(): Iterable<number> {
    if (this.pinnedInView.size <= MAX_PINNED) return this.pinnedInView;
    const top: number[] = [];
    for (const s of this.order) {
      if (top.length === MAX_PINNED) break;
      if (this.pinnedInView.has(s.id)) top.push(s.id);
    }
    return top;
  }

  /** Takes the delta's systems out of the ranking and puts them back where they now rank. */
  private reorderAfter(d: GalaxyDelta): void {
    const touched = [...(d.removed ?? []), ...d.systems.map((s) => s.id)];
    if (touched.length === 0) return;
    for (const id of touched) {
      const old = this.ranked.get(id);
      if (!old) continue;
      const at = rankIn(this.order, old);
      if (this.order[at] === old) this.order.splice(at, 1);
      this.ranked.delete(id);
    }
    for (const { id } of d.systems) {
      const s = this.systems.get(id);
      if (!s || this.ranked.has(id)) continue;
      this.order.splice(rankIn(this.order, s), 0, s);
      this.ranked.set(id, s);
    }
    this.lastRev = -1;
  }

  /** Labels `id` unless it is labelled already or has nothing to say; the label is returned when new. */
  private show(id: number): BitmapText | null {
    if (this.shown.has(id)) return null;
    const s = this.systems.get(id);
    if (!s || this.textOf(s) === "") return null;
    const label = this.free.pop() ?? this.make();
    label.visible = true;
    this.assign(label, s);
    this.shown.set(id, label);
    return label;
  }

  private fit(label: BitmapText): void {
    label.scale.set(this.scale.x, this.scale.y);
    label.pivot.set(0, -this.offsetY);
  }

  private make(): BitmapText {
    const label = new BitmapText({ text: "", style: NAME_STYLE });
    label.anchor.set(0.5, 0);
    this.container.addChild(label);
    return label;
  }

  private assign(label: BitmapText, s: SystemNode): void {
    const text = this.textOf(s);
    if (label.text !== text) label.text = text;
    this.style(label, s);
  }

  private style(label: BitmapText, s: SystemNode): void {
    const ghost = this.ghosts.get(s.id);
    const named = this.nameOf(s) !== "";
    const filtered = dimmedByInitializer(s, this.ctx.hiddenInitializers);
    if (ghost) {
      label.position.set(ghost.x, ghost.y);
      label.alpha = GHOST_ALPHA;
    } else {
      label.position.set(s.x, s.y);
      label.alpha = named ? (filtered ? FILTERED_ALPHA : 1) : INITIALIZER_ALPHA;
    }
  }

  private restyleShown(): void {
    for (const [id, label] of this.shown) {
      const s = this.systems.get(id);
      if (s) this.style(label, s);
    }
    this.placePlates();
  }

  /** A system the document no longer holds takes its label and its plate with it. */
  private drop(id: number): void {
    const label = this.shown.get(id);
    if (label) {
      this.shown.delete(id);
      this.release(label);
    }
    const plate = this.shownPlates.get(id);
    if (plate) {
      this.shownPlates.delete(id);
      this.releasePlate(plate);
    }
  }

  private schedulePlates(): void {
    if (this.platesQueued) return;
    this.platesQueued = true;
    queueMicrotask(() => {
      this.platesQueued = false;
      if (!this.container.destroyed) this.placePlates();
    });
  }

  /** A plate under every shown label whose system is colonised, while colonies are shown. */
  private placePlates(): void {
    for (const [id, plate] of this.shownPlates) {
      if (!this.shown.has(id)) {
        this.shownPlates.delete(id);
        this.releasePlate(plate);
      }
    }
    for (const [id, label] of this.shown) this.placePlate(id, label);
  }

  private placePlate(id: number, label: BitmapText): void {
    const s = this.systems.get(id);
    const d = this.ctx.details.get(id);
    const key = s && d && this.ctx.coloniesShown ? plateKey(d) : null;
    const texture = key === null ? null : getTexture(key);
    if (key !== null && texture === undefined) requestTextures([key]);
    let plate = this.shownPlates.get(id);
    if (!texture || !s || !d) {
      if (plate) {
        this.shownPlates.delete(id);
        this.releasePlate(plate);
      }
      return;
    }
    if (!plate) {
      plate = this.freePlates.pop() ?? this.makePlate();
      plate.visible = true;
      this.shownPlates.set(id, plate);
    }
    const box = plateBox(nameHalf(label.text), this.offsetY);
    if (plate.texture !== texture) plate.texture = texture;
    plate.width = box.width;
    plate.height = box.height;
    plate.pivot.set(-box.x, -box.y);
    plate.position.copyFrom(label.position);
    plate.scale.set(this.scale.x, this.scale.y);
    plate.alpha = label.alpha;
  }

  private makePlate(): NineSliceSprite {
    const plate = new NineSliceSprite({
      texture: Texture.EMPTY,
      leftWidth: PLATE_BORDER_PX,
      rightWidth: PLATE_BORDER_PX,
      topHeight: 1,
      bottomHeight: 1,
    });
    this.plates.addChild(plate);
    return plate;
  }

  private release(label: BitmapText): void {
    label.visible = false;
    this.free.push(label);
  }

  private releasePlate(plate: NineSliceSprite): void {
    plate.visible = false;
    this.freePlates.push(plate);
  }

  private releaseAll(): void {
    for (const label of this.shown.values()) this.release(label);
    this.shown.clear();
    for (const plate of this.shownPlates.values()) this.releasePlate(plate);
    this.shownPlates.clear();
  }
}
