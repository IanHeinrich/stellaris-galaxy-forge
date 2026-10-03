import { Container } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { StarbaseSummary } from "../../generated/StarbaseSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemNode } from "../../generated/SystemNode";
import type { Icon } from "../../lib/details/icons";
import {
  bypassIcons,
  starbaseFrame,
  starbaseKeys,
  starbaseLabel,
  starbaseShown,
} from "../../lib/details/labels";
import {
  type Box,
  DETAILS_MIN_SCALE,
  NAME_ROW,
  plateBox,
  plateKey,
  visiblePlanets,
} from "../../lib/details/layout";
import { systemIcons } from "../../lib/details/nameIcons";
import { resourceRows } from "../../lib/details/resources";
import { nameHalf } from "./nameWidth";
import type { Camera } from "../Camera";
import type { MoveGhost } from "../moveGhosts";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { FLAT_TILT, systemY, type Tilt } from "../tilt";
import { GHOST_ALPHA } from "../../lib/visual/style";
import { onTextures, requestTextures } from "../../lib/visual/textures";
import { queuedTextures, rowY, type RowY } from "./details/cell";
import { fleets } from "./details/fleets";
import { Hover, type Tip } from "./details/Hover";
import { icon } from "./details/icons";
import { drawNameIcons, nameIcons } from "./details/nameIcons";
import { ownerFlag } from "./details/ownerFlag";
import { planetDots, planetIcons } from "./details/planets";
import { resourceIcons, resourceText } from "./details/resources";
import { Row } from "./details/Row";
import type { DragState, MapLayer } from "./MapLayer";

const UNDERLINE_ALPHA = 0.7;
/** How far beyond the viewport, in screen pixels, rows are still laid out. */
const CULL_MARGIN_PX = 160;
const MAX_ROWS = 300;

/** What a shown row was laid out from: everything but the camera's translation. */
interface LaidOut {
  rev: number;
  scale: number;
}

/**
 * A functional copy of the game's `star_mapicon` under each system when zoomed in: the owner's
 * flag and the starbase, megastructure, bypass, site and pre-FTL icons on their category discs
 * flanking the name, the resource totals below it, the habitable planets stacked left of the
 * star and the fleets present right of it. Details are fetched for the systems in view;
 * textures land asynchronously and the rows re-lay themselves out when they do.
 */
export class DetailsLayer implements MapLayer {
  readonly id = "details" as const;
  readonly container = new Container();
  private ctx: RenderContext = EMPTY_CONTEXT;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private grid = EMPTY_CONTEXT.grid;
  private bypassesOf = new Map<number, Icon[]>();
  private readonly hover = new Hover();
  private readonly shown = new Map<number, Row>();
  private readonly laidOut = new Map<number, LaidOut>();
  private readonly free: Row[] = [];
  private readonly inView: number[] = [];
  private readonly bounds = [0, 0, 0, 0];
  private readonly scale = { x: 1, y: 1 };
  private readonly keys = new Set<string>();
  private readonly tex = queuedTextures(this.keys);
  private ghosts: ReadonlyMap<number, MoveGhost> = new Map();
  private cam: Camera | null = null;
  private tilt: Tilt = FLAT_TILT;
  private visible = true;
  /** Bumped whenever anything a row is drawn from moves, so its layout no longer stands. */
  private layoutRev = 0;
  private refreshQueued = false;
  private readonly unsubscribe: Array<() => void> = [];
  private readonly collect = (s: SystemNode): void => {
    if (this.inView.length < MAX_ROWS) this.inView.push(s.id);
  };

  constructor() {
    this.container.eventMode = "passive";
    this.unsubscribe.push(
      onTextures(() => {
        this.layoutRev++;
        this.scheduleRefresh();
      }),
    );
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    this.layoutRev++;
    if (ctx.gameDataReady && !prev.gameDataReady && ctx.resourceIcons.size === 0) {
      ctx.requestResourceIcons();
    }
    this.systems = ctx.systems;
    this.grid = ctx.grid;
    if (ctx.galaxy !== prev.galaxy || ctx.bypasses !== prev.bypasses) {
      this.bypassesOf = new Map();
      for (const s of ctx.systems.values()) {
        if (s.bypass_ids.length > 0)
          this.bypassesOf.set(s.id, bypassIcons(ctx.bypasses, s.id, ctx.bypassKinds));
      }
      this.releaseAll();
      this.scheduleRefresh();
      return;
    }
    if (
      ctx.detailsVersion !== prev.detailsVersion ||
      ctx.resourceIcons !== prev.resourceIcons ||
      ctx.planetClasses !== prev.planetClasses ||
      ctx.starbaseLevels !== prev.starbaseLevels ||
      ctx.mapColors !== prev.mapColors ||
      ctx.names !== prev.names ||
      ctx.coloniesShown !== prev.coloniesShown ||
      ctx.hiddenOwners !== prev.hiddenOwners
    ) {
      this.scheduleRefresh();
    }
  }

  applyDelta(d: GalaxyDelta): void {
    this.layoutRev++;
    for (const id of d.removed ?? []) {
      this.bypassesOf.delete(id);
      const row = this.shown.get(id);
      if (!row) continue;
      this.shown.delete(id);
      this.release(id, row);
    }
    for (const s of d.systems) {
      const row = this.shown.get(s.id);
      if (row) this.place(row, s);
    }
  }

  onViewport(cam: Camera): void {
    this.cam = cam;
    if (!this.visible) return;
    this.refresh(cam);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.container.visible = v;
    if (v) this.scheduleRefresh();
    else this.releaseAll();
  }

  setDragState(drag: DragState | null): void {
    this.ghosts = drag?.byId ?? new Map();
    for (const [id, row] of this.shown) {
      const s = this.systems.get(id);
      if (s) this.place(row, s);
    }
  }

  destroy(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    this.container.destroy({ children: true });
  }

  private scheduleRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      if (this.visible && this.cam && !this.container.destroyed) this.refresh(this.cam);
    });
  }

  private refresh(cam: Camera): void {
    this.tilt = cam.tilt;
    if (cam.scale < DETAILS_MIN_SCALE) {
      this.releaseAll();
      return;
    }
    const pad = CULL_MARGIN_PX / cam.scale;
    const b = cam.worldBounds(this.bounds);
    this.inView.length = 0;
    this.grid.forEachIn(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad, this.collect);
    const details = this.ctx.details;
    this.ctx.requestDetails(this.inView);

    const wanted = new Set(this.inView.filter((id) => details.has(id)));
    for (const [id, row] of this.shown) {
      if (!wanted.has(id)) {
        this.shown.delete(id);
        this.release(id, row);
      }
    }
    cam.childScale(1, this.scale);
    this.keys.clear();
    for (const id of wanted) {
      const s = this.systems.get(id);
      const d = details.get(id);
      if (!s || !d) continue;
      let row = this.shown.get(id);
      if (!row) {
        row = this.free.pop() ?? this.make();
        row.root.visible = true;
        this.shown.set(id, row);
      }
      this.place(row, s);
      row.root.scale.set(this.scale.x, this.scale.y);
      const drawn = this.laidOut.get(id);
      if (drawn && drawn.rev === this.layoutRev && drawn.scale === cam.scale) continue;
      this.layout(row, s, d, cam.scale);
      this.laidOut.set(id, { rev: this.layoutRev, scale: cam.scale });
    }
    if (this.keys.size > 0) requestTextures(this.keys);
  }

  private place(row: Row, s: SystemNode): void {
    const ghost = this.ghosts.get(s.id);
    row.root.position.set(ghost?.x ?? s.x, ghost?.y ?? systemY(s, this.tilt));
    row.root.alpha = ghost ? GHOST_ALPHA : 1;
  }

  private layout(row: Row, s: SystemNode, d: SystemDetails, camScale: number): void {
    const { ctx, tex } = this;
    const withIcons = ctx.planetClasses.size > 0;
    const half = nameHalf(ctx.nodeName(s.name));
    const y = rowY(camScale);
    row.begin();
    if (ctx.coloniesShown) ownerFlag(row, ctx, tex, s, d, -half - NAME_ROW.gap, y);
    const first = half + NAME_ROW.gap;
    let x = first;
    x = withIcons ? this.starbaseIcon(row, d, x, y) : this.starbaseText(row, d, x, y);
    const icons = nameIcons(ctx, tex, systemIcons(d, this.bypassesOf.get(d.id)));
    x = drawNameIcons(row, tex, icons, x, y);
    if (x > first && plateKey(d) === null) this.underline(row, plateBox(half, y.row));
    fleets(row, ctx, tex, d, withIcons);
    if (withIcons) {
      resourceIcons(row, ctx.names, tex, resourceRows(d, ctx.resourceIcons), y.resource);
    } else resourceText(row, d, y.resource);
    const planets = visiblePlanets(d);
    if (withIcons) planetIcons(row, ctx, tex, planets);
    else planetDots(row, ctx, tex, planets);
    row.end();
  }

  private starbaseIcon(row: Row, d: SystemDetails, x: number, y: RowY): number {
    if (!d.starbase || !starbaseShown(d.starbase.level)) return x;
    const owner = d.starbase.owner === null ? undefined : this.ctx.countries.get(d.starbase.owner);
    const keys = starbaseKeys(d.starbase.level, this.ctx.starbaseLevels, owner);
    if (keys.length === 0) return this.starbaseText(row, d, x, y);
    const tip = this.starbaseTip(d.starbase);
    const starbase = {
      keys,
      glyph: "⬢",
      label: tip.title,
      frame: starbaseFrame(d.starbase.level),
    };
    return icon(row, this.tex, starbase, x, y, tip.lines);
  }

  private starbaseText(row: Row, d: SystemDetails, x: number, y: RowY): number {
    if (!d.starbase || !starbaseShown(d.starbase.level)) return x;
    const tip = this.starbaseTip(d.starbase);
    return x + row.text(tip.title, x, y.row + 2, tip) + NAME_ROW.gap;
  }

  private starbaseTip({ level, owner }: StarbaseSummary): Tip {
    const title = this.ctx.names.get(level) ?? starbaseLabel(level);
    const lines = owner === null ? [] : [this.ctx.countryName(owner)];
    return { title, lines };
  }

  /** Without a plate, the plate's bottom line alone underlines the name. */
  private underline(row: Row, plate: Box): void {
    row.marks
      .rect(plate.x, plate.y + plate.height - 1, plate.width, 1)
      .fill({ color: 0xffffff, alpha: UNDERLINE_ALPHA });
  }

  private make(): Row {
    const row = new Row(this.hover);
    this.container.addChild(row.root);
    return row;
  }

  private release(id: number, row: Row): void {
    this.laidOut.delete(id);
    row.release();
    this.free.push(row);
  }

  private releaseAll(): void {
    for (const [id, row] of this.shown) this.release(id, row);
    this.shown.clear();
  }
}
