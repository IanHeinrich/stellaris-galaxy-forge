import { Container, type Texture } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { StarbaseSummary } from "../../generated/StarbaseSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemNode } from "../../generated/SystemNode";
import { type Icon, PRE_FTL_ICON_KEY } from "../../lib/details/icons";
import {
  bypassIcons,
  megastructureIcon,
  megastructureLabel,
  shownMegastructures,
  siteIcon,
  siteLabel,
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
import type { MapTooltipLine } from "../../store/mapChromeStore";
import { nameHalf } from "./nameWidth";
import type { Camera } from "../Camera";
import type { MoveGhost } from "../moveGhosts";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { GHOST_ALPHA } from "../../lib/visual/style";
import { getTexture, onTextures, requestTextures } from "../../lib/visual/textures";
import { rowY, type RowY, type Textures } from "./details/cell";
import { fleets } from "./details/fleets";
import { Hover, type Tip } from "./details/Hover";
import { collapsed, icon } from "./details/icons";
import { ownerFlag } from "./details/ownerFlag";
import { planetDots, planetIcons, planetLines } from "./details/planets";
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
  private readonly tex: Textures = {
    texture: (key) => this.texture(key),
    resolve: (keys) => this.resolve(keys),
  };
  private ghosts: ReadonlyMap<number, MoveGhost> = new Map();
  private cam: Camera | null = null;
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
    row.root.position.set(ghost?.x ?? s.x, ghost?.y ?? s.y);
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
    const structures = shownMegastructures(d.megastructures);
    const megastructures = megastructureIcon(structures);
    x = collapsed(
      row,
      tex,
      megastructures,
      x,
      structures.length,
      this.megastructureLines(structures),
      y,
    );
    for (const b of this.bypassesOf.get(d.id) ?? []) x = icon(row, tex, b, x, y);
    const sites = siteIcon(d.sites.map((site) => site.kind));
    x = collapsed(row, tex, sites, x, d.sites.length, this.siteLines(d), y);
    x = this.preFtl(row, d, x, y);
    if (x > first && plateKey(d) === null) this.underline(row, plateBox(half, y.row));
    fleets(row, ctx, tex, d, withIcons);
    if (withIcons) resourceIcons(row, ctx, tex, d, y.resource);
    else resourceText(row, d, y.resource);
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

  private megastructureLines(structures: MegastructureSummary[]): MapTooltipLine[] {
    if (structures.length < 2) return [];
    const { countryName } = this.ctx;
    return structures.map((m) => ({
      label: megastructureLabel(m.kind),
      value: m.owner === null ? "unowned" : countryName(m.owner),
    }));
  }

  private siteLines(d: SystemDetails): MapTooltipLine[] {
    return d.sites.map((site) => {
      const planet = d.planets.find((p) => p.id === site.planet);
      const value = planet ? this.ctx.templateName(planet) : "";
      return d.sites.length > 1 ? { label: siteLabel(site.kind), value } : value;
    });
  }

  private preFtl(row: Row, d: SystemDetails, x: number, y: RowY): number {
    const worlds = d.planets.filter((p) => p.pre_ftl);
    if (worlds.length === 0) return x;
    const preFtl = {
      keys: [PRE_FTL_ICON_KEY],
      glyph: "☗",
      label: "Pre-FTL civilisation",
      frame: "poi" as const,
    };
    return icon(row, this.tex, preFtl, x, y, planetLines(this.ctx, this.tex, worlds));
  }

  /** Without a plate, the plate's bottom line alone underlines the name. */
  private underline(row: Row, plate: Box): void {
    row.marks
      .rect(plate.x, plate.y + plate.height - 1, plate.width, 1)
      .fill({ color: 0xffffff, alpha: UNDERLINE_ALPHA });
  }

  /** The texture for `key` when it has landed; queues the key otherwise. */
  private texture(key: string): Texture | null | undefined {
    const texture = getTexture(key);
    if (texture === undefined) this.keys.add(key);
    return texture;
  }

  /** The first of `keys` that rendered; `undefined` while any is still loading, `null` when none can. */
  private resolve(keys: string[]): Texture | null | undefined {
    let pending = false;
    for (const key of keys) {
      const texture = this.texture(key);
      if (texture) return texture;
      if (texture === undefined) pending = true;
    }
    return pending ? undefined : null;
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
