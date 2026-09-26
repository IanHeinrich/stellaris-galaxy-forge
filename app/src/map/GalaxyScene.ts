import { Container, type Renderer } from "pixi.js";
import { documentCapabilities } from "../lib/capabilities";
import { useEditorStore } from "../store/editorStore";
import { useFileSessionStore } from "../store/fileSessionStore";
import { Camera } from "./Camera";
import { InteractionController } from "./interaction/InteractionController";
import { HighlightsLayer } from "./layers/HighlightsLayer";
import type { MapLayer } from "./layers/MapLayer";
import { layersFor } from "./layers/registry";
import { EMPTY_CONTEXT, renderContext, sameContext, type RenderContext } from "./RenderContext";
import type { Scene } from "./Scene";
import { selectionFrame } from "./selectionFrame";
import { bindViewState, dressLayers, type MapView } from "./viewState";

const FOCUS_SCALE = 4;
const FOCUS_MS = 350;

/**
 * Owns the galaxy's camera, its root container and the layers. It assembles the `RenderContext`
 * the layers draw from and passes the stores' view state to them; pointer editing belongs to the
 * InteractionController. Nothing here is React state.
 */
export class GalaxyScene implements Scene, MapView {
  readonly cam = new Camera();
  /** Mutated in place, never replaced: the InteractionController holds this same array. */
  readonly layers: MapLayer[] = [];
  /** Outside the capability-driven set: the InteractionController holds this one instance. */
  readonly highlights = new HighlightsLayer();
  readonly root = new Container();
  private readonly interaction: InteractionController;
  private readonly cleanups: Array<() => void> = [];
  private ctx: RenderContext = EMPTY_CONTEXT;
  private appliedRev = -1;

  constructor(
    private readonly renderer: Renderer,
    canvas: HTMLCanvasElement,
  ) {
    this.syncLayers();
    this.cam.setViewport(renderer.width, renderer.height);

    this.rebuild();
    this.fit();
    this.cleanups.push(bindViewState(this));
    this.interaction = new InteractionController(canvas, this.cam, this.highlights, this.layers);
    this.cleanups.push(() => this.interaction.dispose());
  }

  activate(): void {
    this.interaction.activate();
    this.invalidate();
  }

  deactivate(): void {
    this.interaction.deactivate();
  }

  dispose(): void {
    for (const c of this.cleanups.splice(0)) c();
    for (const layer of this.layers.splice(0)) layer.destroy();
    this.root.destroy();
  }

  /** Instantiates the layers the open document can answer for, leaving the set alone when it stands. */
  syncLayers(): void {
    const entries = layersFor(documentCapabilities(useFileSessionStore.getState()));
    const wanted = [...entries.map((entry) => entry.id), this.highlights.id].join(" ");
    if (wanted === this.layers.map((layer) => layer.id).join(" ")) return;
    for (const layer of this.layers.splice(0)) {
      if (layer !== this.highlights) layer.destroy();
    }
    for (const entry of entries) {
      const layer = entry.create(this.renderer);
      this.layers.push(layer);
      this.root.addChild(layer.container);
    }
    this.layers.push(this.highlights);
    this.root.addChild(this.highlights.container);
    for (const layer of this.layers) layer.rebuild(this.ctx);
    dressLayers(this);
  }

  /** Re-reads the stores and hands the layers the new context, unless nothing they draw moved. */
  refreshContext(): void {
    const next = renderContext();
    if (sameContext(next, this.ctx)) return;
    this.ctx = next;
    for (const layer of this.layers) layer.rebuild(next);
    this.invalidate();
  }

  rebuild(): void {
    this.ctx = renderContext();
    this.syncLayers();
    for (const layer of this.layers) layer.rebuild(this.ctx);
  }

  fit(): void {
    if (this.ctx.radius === 0) return;
    this.cam.fit(this.ctx.radius, this.renderer.width, this.renderer.height);
    this.invalidate();
  }

  /** Makes the next tick hand the camera to the layers again. */
  invalidate(): void {
    this.appliedRev = -1;
  }

  /** Frames what Shift+F frames with the margin of the galaxy fit, or the galaxy when nothing is selected. */
  fitSelection(): void {
    const { selection, selectedNebula } = useEditorStore.getState();
    const nebula = selectedNebula === null ? undefined : this.ctx.nebulae[selectedNebula];
    const frame = selectionFrame(this.ctx.systems, selection, nebula);
    if (!frame) {
      this.fit();
      return;
    }
    const { minX, minY, maxX, maxY } = frame;
    const { width, height } = this.renderer;
    const scale = Math.min(
      this.cam.fitScale((maxX - minX) / 2, width, width),
      this.cam.fitScale((maxY - minY) / 2, height, height),
      FOCUS_SCALE,
    );
    this.cam.easeTo((minX + maxX) / 2, (minY + maxY) / 2, scale, FOCUS_MS);
  }

  focusOn(id: number): void {
    const s = this.ctx.systems.get(id);
    if (!s) return;
    this.cam.easeTo(s.x, s.y, Math.max(this.cam.scale, FOCUS_SCALE), FOCUS_MS);
  }

  panTo(x: number, y: number): void {
    this.cam.easeTo(x, y, this.cam.scale, FOCUS_MS);
  }

  tick(): void {
    if (this.cam.rev === this.appliedRev) return;
    this.appliedRev = this.cam.rev;
    for (const layer of this.layers) layer.onViewport(this.cam, this.ctx);
  }
}
