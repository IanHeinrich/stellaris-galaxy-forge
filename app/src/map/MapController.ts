import { Container, type Application } from "pixi.js";
import { documentCapabilities } from "../lib/capabilities";
import { isEditableTarget } from "../lib/keys";
import { useEditorStore } from "../store/editorStore";
import { useFileSessionStore } from "../store/fileSessionStore";
import { Camera } from "./Camera";
import { InteractionController } from "./interaction/InteractionController";
import { HighlightsLayer } from "./layers/HighlightsLayer";
import type { MapLayer } from "./layers/MapLayer";
import { layersFor } from "./layers/registry";
import { EMPTY_CONTEXT, renderContext, sameContext, type RenderContext } from "./RenderContext";
import { bindViewState, dressLayers, type MapView } from "./viewState";

const ZOOM_PER_100PX = 1.1;
const KEY_PAN_PX_PER_S = 700;
const FOCUS_SCALE = 4;
const FOCUS_MS = 350;

const PAN_KEYS: Record<string, [dx: number, dy: number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [1, 0],
  ArrowLeft: [1, 0],
  KeyD: [-1, 0],
  ArrowRight: [-1, 0],
};

/**
 * Owns the camera, the world container and the layers for one Pixi application. It assembles
 * the `RenderContext` the layers draw from and passes the stores' view state to them; pointer
 * editing belongs to the InteractionController. Nothing here is React state.
 */
export class MapController implements MapView {
  readonly cam = new Camera();
  /** Mutated in place, never replaced: the InteractionController holds this same array. */
  readonly layers: MapLayer[] = [];
  /** Outside the capability-driven set: the InteractionController holds this one instance. */
  readonly highlights = new HighlightsLayer();
  private readonly world = new Container();
  private readonly transform = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  private readonly heldKeys = new Set<string>();
  private readonly cleanups: Array<() => void> = [];
  private ctx: RenderContext = EMPTY_CONTEXT;
  private appliedRev = -1;

  constructor(
    private readonly app: Application,
    host: HTMLElement,
  ) {
    this.syncLayers();
    app.stage.addChild(this.world);
    this.cam.setViewport(app.renderer.width, app.renderer.height);

    this.rebuild();
    this.fit();
    this.cleanups.push(bindViewState(this));
    this.bindWheel(app.canvas);
    this.bindKeyboard();
    const interaction = new InteractionController(
      app.canvas,
      this.cam,
      this.highlights,
      this.layers,
    );
    this.cleanups.push(() => interaction.dispose());

    const observer = new ResizeObserver(() => app.resize());
    observer.observe(host);
    this.cleanups.push(() => observer.disconnect());

    const tick = () => this.tick(app.ticker.deltaMS);
    app.ticker.add(tick);
    this.cleanups.push(() => app.ticker.remove(tick));
  }

  dispose(): void {
    for (const c of this.cleanups.splice(0)) c();
    for (const layer of this.layers.splice(0)) layer.destroy();
    this.world.destroy();
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
      const layer = entry.create(this.app.renderer);
      this.layers.push(layer);
      this.world.addChild(layer.container);
    }
    this.layers.push(this.highlights);
    this.world.addChild(this.highlights.container);
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
    this.cam.fit(this.ctx.radius, this.app.renderer.width, this.app.renderer.height);
    this.invalidate();
  }

  /** Makes the next tick hand the camera to the layers again. */
  invalidate(): void {
    this.appliedRev = -1;
  }

  /** Frames the selected systems with the margin of the galaxy fit, or the galaxy when none are. */
  fitSelection(): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of useEditorStore.getState().selection) {
      const s = this.ctx.systems.get(id);
      if (!s) continue;
      minX = Math.min(minX, s.x);
      minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x);
      maxY = Math.max(maxY, s.y);
    }
    if (minX === Infinity) {
      this.fit();
      return;
    }
    const { width, height } = this.app.renderer;
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

  private tick(dtMs: number): void {
    const { width, height } = this.app.renderer;
    this.cam.setViewport(width, height);
    if (this.heldKeys.size > 0) {
      let dx = 0;
      let dy = 0;
      for (const code of this.heldKeys) {
        const v = PAN_KEYS[code];
        if (v) {
          dx += v[0];
          dy += v[1];
        }
      }
      const step = (KEY_PAN_PX_PER_S * dtMs) / 1000;
      this.cam.panBy(dx * step, dy * step);
    }
    this.cam.update(dtMs);
    if (this.cam.rev === this.appliedRev) return;
    this.appliedRev = this.cam.rev;
    const t = this.cam.worldTransform(this.transform);
    this.world.position.set(t.x, t.y);
    this.world.scale.set(t.scaleX, t.scaleY);
    for (const layer of this.layers) layer.onViewport(this.cam, this.ctx);
  }

  private bindWheel(canvas: HTMLCanvasElement): void {
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 33 : e.deltaY;
      this.cam.zoomAt({ x: e.offsetX, y: e.offsetY }, Math.pow(ZOOM_PER_100PX, -px / 100));
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    this.cleanups.push(() => canvas.removeEventListener("wheel", wheel));
  }

  private bindKeyboard(): void {
    const down = (e: KeyboardEvent) => {
      if (!(e.code in PAN_KEYS) || isEditableTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      this.heldKeys.add(e.code);
    };
    const up = (e: KeyboardEvent) => this.heldKeys.delete(e.code);
    const blur = () => this.heldKeys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    this.cleanups.push(() => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    });
  }
}
