import { Container, type Renderer } from "pixi.js";
import type { GeometryIntent } from "../../lib/details/orbitEdits";
import { laneLabel } from "../../lib/names";
import { useDetailsStore } from "../../store/detailsStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import type { EntityRef } from "../../store/inspectorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { applyGeometry } from "../../store/systemGeometry";
import { Camera } from "../Camera";
import type { Scene } from "../Scene";
import { bindSystemScene, type SceneView } from "./bindings";
import type { DragStep, HandleRef } from "./bodyDrag";
import { fitScale, zoomLimits } from "./camera";
import { EMPTY_SYSTEM_CONTEXT, selectedBody, systemContext, type SystemContext } from "./context";
import { readSystemSources, sameSources } from "./sources";
import { EXIT_REACH_PX } from "./geometry";
import { moveMarks } from "./moveMarks";
import { pickPlate } from "./picking";
import { BeltsLayer } from "./layers/BeltsLayer";
import { BodiesLayer } from "./layers/BodiesLayer";
import { ExitsLayer } from "./layers/ExitsLayer";
import { HandlesLayer } from "./layers/HandlesLayer";
import { HighlightLayer } from "./layers/HighlightLayer";
import { LabelsLayer } from "./layers/LabelsLayer";
import { LocksLayer } from "./layers/LocksLayer";
import { NebulaLayer } from "./layers/NebulaLayer";
import { OrbitsLayer } from "./layers/OrbitsLayer";
import { RadiiLayer } from "./layers/RadiiLayer";
import { RolledLayer } from "./layers/RolledLayer";
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
  private readonly labels = new LabelsLayer();
  private readonly highlights = new HighlightLayer();
  private readonly handles = new HandlesLayer();
  private readonly interaction: SystemInteraction;
  private readonly textures: SceneTextures;
  /** What the stores give, with no preview: what a drag starts from. */
  private base: SystemContext = EMPTY_SYSTEM_CONTEXT;
  /** What is drawn: `base`, or `base` with the step's preview once a frame has applied it. */
  private ctx: SystemContext = EMPTY_SYSTEM_CONTEXT;
  /** A drag's last step, shown in place of `base` until it is dropped or the edit lands. */
  private step: DragStep | null = null;
  /** The step was released and sent; it stays until the system's details are replaced. */
  private held = false;
  /** The step changed since a frame last applied it. */
  private stepPending = false;
  private highlight: SceneHighlight = NO_HIGHLIGHT;
  private id: number | null = null;
  /** The scene store's count of systems entered, as it stood when this system was shown. */
  private visit: number | null = null;
  private shown = false;
  /** The page on top of the inspector's stack, whose body is ringed when it is one of this system's. */
  private inspected: EntityRef | null = null;
  private appliedRev = -1;
  private fitPending = false;
  /** Where the last fit left the camera: still there means nobody has panned or zoomed since. */
  private fitted = { x: NaN, y: NaN, scale: NaN };
  private sizedFor = { width: 0, height: 0 };
  private readonly unbind: () => void;

  constructor(renderer: Renderer, canvas: HTMLCanvasElement) {
    const textures = bakeSceneTextures(renderer);
    this.textures = textures;
    this.layers = [
      new NebulaLayer(textures.nebula),
      new OrbitsLayer(),
      new RolledLayer(),
      new BeltsLayer(textures.belt),
      new ExitsLayer(),
      new RadiiLayer(),
      new BodiesLayer(textures),
      new LocksLayer(),
      this.handles,
      this.labels,
      this.highlights,
    ];
    for (const layer of this.layers) this.root.addChild(layer.container);
    this.interaction = new SystemInteraction(canvas, this.cam, this);
    this.unbind = bindSystemScene(this);
  }

  /**
   * Shows system `id`, fitting the camera to it on a new `visit`. An edit that renumbers the system
   * shown keeps the visit, and the camera where it is, but drops the lane and arrow marked: the
   * neighbours' ids have moved too.
   */
  show(id: number, visit: number): void {
    if (visit !== this.visit) {
      this.visit = visit;
      this.highlight = NO_HIGHLIGHT;
      this.fitPending = true;
    } else if (id !== this.id) {
      this.interaction.dropExit();
      this.setHighlight({ lane: null, hoverExit: null });
    }
    this.id = id;
    this.showMove();
    this.refresh();
  }

  activate(): void {
    this.shown = true;
    this.fitPending = true;
    this.base = EMPTY_SYSTEM_CONTEXT;
    this.ctx = EMPTY_SYSTEM_CONTEXT;
    this.setStep(null);
    this.refresh();
    this.drawHighlight();
    this.interaction.activate();
  }

  deactivate(): void {
    this.shown = false;
    this.interaction.deactivate();
    this.setHighlight({ hoverBody: null, hoverExit: null, lane: null });
    useMapChromeStore.getState().setSceneHint(null);
  }

  dispose(): void {
    this.deactivate();
    this.unbind();
    for (const layer of this.layers.splice(0)) layer.destroy();
    this.root.destroy({ children: true });
    releaseSceneTextures(this.textures);
  }

  context(): SystemContext {
    return this.ctx;
  }

  frame(): SystemContext {
    return this.base;
  }

  preview(step: DragStep | null): void {
    this.setStep(step);
    if (step) useMapChromeStore.getState().setSceneHint(step.hint);
    else this.showLane();
  }

  /**
   * Sends `intent` and keeps the preview up: the edit only stales the details, so dropping it now
   * would show the old place until the fresh details land. An edit refused drops it.
   */
  commit(intent: GeometryIntent): void {
    this.held = true;
    const step = this.step;
    this.showLane();
    const drop = () => {
      if (this.held && this.step === step) this.setStep(null);
    };
    applyGeometry(intent).then((applied) => {
      if (!applied) drop();
    }, drop);
  }

  holding(): boolean {
    return this.held && this.step !== null;
  }

  private setStep(step: DragStep | null): void {
    if (step === null && this.step === null) return;
    this.step = step;
    this.held = false;
    this.stepPending = true;
  }

  plateAt(sx: number, sy: number): number | null {
    return pickPlate(this.labels.plates(), this.cam, { x: sx, y: sy });
  }

  /** Does nothing while the scene is hidden: showing it reads the stores again. */
  refresh(): void {
    if (!this.shown) return;
    const details = useDetailsStore.getState();
    if (this.id !== null) details.request([this.id]);
    // No fresh details will come to end the hold.
    if (this.holding() && this.id !== null && details.failed.has(this.id)) this.setStep(null);
    const sources = readSystemSources(this.id);
    if (sameSources(sources, this.base)) return;
    // Another system, or its details answered afresh after an edit, undo or reload: a drag's
    // preview was measured on what went.
    const rebased = sources.id !== this.base.id || sources.details !== this.base.details;
    const before = this.ctx.layout.fitRadius;
    this.base = systemContext(sources);
    if (rebased && this.step) {
      this.interaction.cancelDrag();
      this.setStep(null);
    }
    this.apply();
    if (!this.step && this.ctx.layout.fitRadius !== before && this.untouched()) {
      this.fitPending = true;
    }
    if (!this.step || this.held) this.showLane();
  }

  /** Draws `base`, or the step's preview over it. */
  private apply(): void {
    this.stepPending = false;
    const step = this.step;
    const base = this.base;
    if (step) {
      const frame = {
        layout: base.layout,
        details: base.details,
        planetClasses: base.planetClasses,
        radii: base.radii,
      };
      const override = base.geometry.preview(step.intent, frame);
      this.ctx = systemContext(base, { override, marks: step.marks });
    } else {
      this.ctx = base;
    }
    for (const layer of this.layers) layer.rebuild(this.ctx);
    this.selectBody(this.inspected);
    this.appliedRev = -1;
    this.interaction.contextChanged();
  }

  selectBody(top: EntityRef | null): void {
    this.inspected = top;
    this.setHighlight({ selectedBody: selectedBody(this.ctx, top) });
  }

  hover(body: number | null, exit: number | null, handle: HandleRef | null): void {
    this.setHighlight({ hoverBody: body, hoverExit: exit });
    this.highlights.hoverHandle(handle);
  }

  revealHandles(owner: HandleRef | null): void {
    this.handles.reveal(owner);
  }

  linkBody(id: number | null): void {
    this.setHighlight({ linkedBody: id });
  }

  showMove(): void {
    this.setHighlight(moveMarks(this.id));
  }

  selectLane(neighbour: number | null): void {
    this.setHighlight({ lane: neighbour });
    this.showLane();
  }

  /** Kept while the scene is hidden, and drawn once it is shown. */
  private setHighlight(change: Partial<SceneHighlight>): void {
    this.highlight = { ...this.highlight, ...change };
    if (this.shown) this.drawHighlight();
  }

  private drawHighlight(): void {
    for (const layer of this.layers) layer.setHighlighted?.(this.highlight);
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

  /** Out to half the fit, in until the largest body fills the view's short side. */
  private limit(scale: number): void {
    const { width, height } = this.cam;
    const { fitRadius, largestDisc } = this.ctx.layout;
    const limits = zoomLimits(fitRadius, width, height, largestDisc);
    this.cam.minScale = Math.min(limits.minScale, scale / 2);
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
    if (this.stepPending) this.apply();
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
    for (const layer of this.layers) layer.onViewport?.(this.cam);
  }
}
