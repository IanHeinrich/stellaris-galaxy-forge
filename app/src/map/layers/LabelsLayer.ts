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
  private readonly rankOf = new Map<number, number>();
  private inView = new Uint8Array(0);
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
  private pinned: readonly number[] = [];
  private namesDirty = false;
  private platesQueued = false;
  private readonly unsubscribe: Array<() => void> = [];
  private readonly markInView = (s: SystemNode): void => {
    const rank = this.rankOf.get(s.id);
    if (rank !== undefined) this.inView[rank] = 1;
    if (this.keepsNames && this.nameOf(s) !== "") this.wanted.add(s.id);
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
    this.reorder();
    this.placePlates();
  }

  onViewport(cam: Camera): void {
    if (!this.visible) return;
    if (cam.rev === this.lastRev) return;
    this.lastRev = cam.rev;
    const tier = labelTier(cam.scale);
    if (tier === "none" && !this.keepsNames) {
      this.releaseAll();
      return;
    }
    this.offsetY = nameRowY(cam.scale);
    const pad = VIEW_PAD_PX / cam.scale;
    const b = cam.worldBounds(this.bounds);
    this.inView.fill(0);
    const { order, inView, wanted } = this;
    wanted.clear();
    this.grid.forEachIn(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad, this.markInView);

    for (const id of this.pinned) {
      const s = this.systems.get(id);
      if (s && this.textOf(s) !== "") wanted.add(id);
    }
    if (tier !== "none") {
      let ranked = 0;
      for (let rank = 0; rank < order.length && ranked < MAX_LABELS; rank++) {
        if (inView[rank] === 0 || this.textOf(order[rank]) === "") continue;
        wanted.add(order[rank].id);
        ranked++;
      }
    }
    for (const [id, label] of this.shown) {
      if (!wanted.has(id)) {
        this.shown.delete(id);
        this.release(label);
      }
    }
    for (const id of wanted) {
      if (this.shown.has(id)) continue;
      const s = this.systems.get(id);
      if (!s) continue;
      const label = this.free.pop() ?? this.make();
      label.visible = true;
      this.assign(label, s);
      this.shown.set(id, label);
    }
    if (this.namesDirty) {
      for (const [id, label] of this.shown) {
        const s = this.systems.get(id);
        if (s) this.assign(label, s);
      }
      this.namesDirty = false;
    }
    cam.childScale(1, this.scale);
    for (const label of this.shown.values()) {
      label.scale.set(this.scale.x, this.scale.y);
      label.pivot.set(0, -this.offsetY);
    }
    this.placePlates();
  }

  /** Systems whose label is placed before any other, whatever their rank. */
  setPinned(ids: readonly number[]): void {
    this.pinned = ids;
    this.lastRev = -1;
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
    this.rankOf.clear();
    this.order.forEach((s, rank) => this.rankOf.set(s.id, rank));
    if (this.inView.length !== this.order.length) this.inView = new Uint8Array(this.order.length);
    this.lastRev = -1;
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
    const details = this.ctx.details;
    for (const [id, plate] of this.shownPlates) {
      if (!this.shown.has(id)) {
        this.shownPlates.delete(id);
        this.releasePlate(plate);
      }
    }
    for (const [id, label] of this.shown) {
      const s = this.systems.get(id);
      const d = details.get(id);
      const key = s && d && this.ctx.coloniesShown ? plateKey(d) : null;
      const texture = key === null ? null : getTexture(key);
      if (key !== null && texture === undefined) requestTextures([key]);
      let plate = this.shownPlates.get(id);
      if (!texture || !s || !d) {
        if (plate) {
          this.shownPlates.delete(id);
          this.releasePlate(plate);
        }
        continue;
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
