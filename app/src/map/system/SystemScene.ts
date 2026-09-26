import { Container, type Renderer } from "pixi.js";
import { fitScale, zoomLimits } from "../../lib/details/orbits";
import { laneLabel } from "../../lib/names";
import { useDetailsStore } from "../../store/detailsStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { Camera } from "../Camera";
import type { Scene } from "../Scene";
import { bindSystemScene, type SceneView } from "./bindings";
import {
  EMPTY_SYSTEM_CONTEXT,
  readSystemSources,
  sameSources,
  systemContext,
  type SystemContext,
} from "./context";
import { EXIT_REACH_PX } from "./geometry";
import { BeltsLayer } from "./layers/BeltsLayer";
import { BodiesLayer } from "./layers/BodiesLayer";
import { ExitsLayer } from "./layers/ExitsLayer";
import { HighlightLayer } from "./layers/HighlightLayer";
import { LabelsLayer } from "./layers/LabelsLayer";
import { OrbitsLayer } from "./layers/OrbitsLayer";
import { NO_HIGHLIGHT, type SceneHighlight, type SystemLayer } from "./layers/SystemLayer";
import { bakeSceneTextures, releaseSceneTextures, type SceneTextures } from "./layers/textures";
import { SystemInteraction, type SceneTarget } from "./SystemInteraction";

/**
 * One system's bodies, orbits, belts and hyperlane exits, drawn about its centre with a camera of
 * its own. The host retargets it to the system the scene store shows; nothing here is React state.
 */
export class SystemScene implements Scene, SceneView, SceneTarget {
  readonly cam = new Camera();
  readonly root = new Container();
  private readonly layers: SystemLayer[];
  private readonly interaction: SystemInteraction;
  private readonly textures: SceneTextures;
  private ctx: SystemContext = EMPTY_SYSTEM_CONTEXT;
  private highlight: SceneHighlight = NO_HIGHLIGHT;
  private id: number | null = null;
  /** The planet on top of the inspector's stack, ringed when it is one of this system's bodies. */
  private inspected: number | null = null;
  private appliedRev = -1;
  private fitPending = false;
  /** Where the last fit left the camera: still there means nobody has panned or zoomed since. */
  private fitted = { x: NaN, y: NaN, scale: NaN };
  private sizedFor = { width: 0, height: 0 };
  private unbind: (() => void) | null = null;

  constructor(
    private readonly renderer: Renderer,
    canvas: HTMLCanvasElement,
  ) {
    const textures = bakeSceneTextures(renderer);
    this.textures = textures;
    this.layers = [
      new OrbitsLayer(),
      new BeltsLayer(textures.rock),
      new ExitsLayer(),
      new BodiesLayer(textures),
      new LabelsLayer(),
      new HighlightLayer(),
    ];
    for (const layer of this.layers) this.root.addChild(layer.container);
    this.interaction = new SystemInteraction(canvas, this.cam, this);
  }

  /** Shows system `id`, fitting the camera to it when it is not the one shown already. */
  show(id: number): void {
    if (id !== this.id) {
      this.id = id;
      this.highlight = NO_HIGHLIGHT;
      this.fitPending = true;
    }
    if (this.unbind) this.refresh();
  }

  activate(): void {
    this.fitPending = true;
    this.ctx = EMPTY_SYSTEM_CONTEXT;
    this.refresh();
    this.unbind ??= bindSystemScene(this);
    this.interaction.activate();
  }

  deactivate(): void {
    this.interaction.deactivate();
    this.unbind?.();
    this.unbind = null;
    this.setHighlight({ hoverBody: null, hoverExit: null, lane: null });
    useMapChromeStore.getState().setSceneHint(null);
  }

  dispose(): void {
    this.deactivate();
    for (const layer of this.layers.splice(0)) layer.destroy();
    this.root.destroy({ children: true });
    releaseSceneTextures(this.renderer, this.textures);
  }

  context(): SystemContext {
    return this.ctx;
  }

  refresh(): void {
    if (this.id !== null) useDetailsStore.getState().request([this.id]);
    const sources = readSystemSources(this.id);
    if (sameSources(sources, this.ctx)) return;
    const before = this.ctx.layout.fitRadius;
    this.ctx = systemContext(sources);
    for (const layer of this.layers) layer.rebuild(this.ctx);
    this.selectBody(this.inspected);
    if (this.ctx.layout.fitRadius !== before && this.untouched()) {
      this.fitPending = true;
    }
    this.appliedRev = -1;
    this.showLane();
  }

  selectBody(id: number | null): void {
    this.inspected = id;
    const ours = id !== null && this.ctx.bodies.some((b) => b.planet?.id === id);
    this.setHighlight({ selectedBody: ours ? id : null });
  }

  hover(body: number | null, exit: number | null): void {
    this.setHighlight({ hoverBody: body, hoverExit: exit });
  }

  selectLane(neighbour: number | null): void {
    this.setHighlight({ lane: neighbour });
    this.showLane();
  }

  private setHighlight(change: Partial<SceneHighlight>): void {
    this.highlight = { ...this.highlight, ...change };
    for (const layer of this.layers) layer.setHighlighted(this.highlight);
  }

  /** The highlighted lane's two ends and its length in the status bar, while it is highlighted. */
  private showLane(): void {
    const lane = this.ctx.exits.find((exit) => exit.neighbour === this.highlight.lane);
    if (!lane || this.id === null) {
      useMapChromeStore.getState().setSceneHint(null);
      return;
    }
    const here = useGalaxyStore.getState().systemName(this.id);
    useMapChromeStore
      .getState()
      .setSceneHint(`${laneLabel(here, lane.name)} · length ${lane.length}`);
  }

  /** The scale at which the whole system, its hyperlane arrows and their labels included, is in view. */
  private fittedScale(): number {
    const { width, height } = this.cam;
    const { fitRadius, innerRadius } = this.ctx.layout;
    const half = Math.min(width, height) / 2;
    const exitsInView = Math.max(half - EXIT_REACH_PX, half / 2) / Math.max(innerRadius, 1);
    return Math.min(fitScale(fitRadius, width, height), exitsInView);
  }

  /** Out to a quarter of the fit, in until the largest body fills the view's short side. */
  private limit(scale: number): void {
    const { width, height } = this.cam;
    const { fitRadius, largestDisc } = this.ctx.layout;
    const limits = zoomLimits(fitRadius, width, height, largestDisc);
    this.cam.minScale = Math.min(limits.minScale, scale / 4);
    this.cam.maxScale = Math.max(limits.maxScale, scale);
  }

  fit(): void {
    const scale = this.fittedScale();
    this.limit(scale);
    this.cam.easeTo(0, 0, scale, 0);
    this.fitted = { x: this.cam.x, y: this.cam.y, scale: this.cam.scale };
    this.sizedFor = { width: this.cam.width, height: this.cam.height };
  }

  /** Whether the camera stands where the last fit put it; a resize alone leaves it there. */
  private untouched(): boolean {
    const { x, y, scale } = this.fitted;
    return this.cam.x === x && this.cam.y === y && this.cam.scale === scale;
  }

  fitSelection(): void {
    this.fit();
  }

  tick(): void {
    const { width, height } = this.cam;
    if (this.fitPending) {
      this.fitPending = false;
      this.fit();
    } else if (width !== this.sizedFor.width || height !== this.sizedFor.height) {
      this.sizedFor = { width, height };
      this.limit(this.fittedScale());
    }
    if (this.cam.rev === this.appliedRev) return;
    this.appliedRev = this.cam.rev;
    for (const layer of this.layers) layer.onViewport(this.cam);
  }
}
