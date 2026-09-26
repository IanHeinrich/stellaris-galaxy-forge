import type { Application } from "pixi.js";
import { isEditableTarget } from "../lib/keys";
import { useEditorStore } from "../store/editorStore";
import { useSceneStore, type Scene as Shown } from "../store/sceneStore";
import { GalaxyScene } from "./GalaxyScene";
import type { Scene } from "./Scene";
import { SystemScene } from "./system/SystemScene";

const ZOOM_PER_100PX = 1.1;
const KEY_PAN_PX_PER_S = 700;

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
 * Hosts the scenes of one Pixi application: it puts the shown scene's root on the stage, and pans
 * and zooms that scene's camera from the wheel and the held keys. Nothing here is React state.
 */
export class MapController {
  private readonly galaxy: GalaxyScene;
  private readonly system: SystemScene;
  private scene: Scene;
  private readonly transform = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  private readonly heldKeys = new Set<string>();
  private readonly cleanups: Array<() => void> = [];
  private appliedRev = -1;

  constructor(
    private readonly app: Application,
    host: HTMLElement,
  ) {
    this.galaxy = new GalaxyScene(app.renderer, app.canvas);
    this.system = new SystemScene(app.renderer, app.canvas);
    this.scene = this.galaxy;
    this.enter(this.scene);
    this.follow(useSceneStore.getState().scene);
    this.bindWheel(app.canvas);
    this.bindKeyboard();
    this.cleanups.push(
      useSceneStore.subscribe((state, previous) => {
        if (state.scene !== previous.scene) this.follow(state.scene);
      }),
      useEditorStore.subscribe((state, previous) => {
        if (state.fitNonce !== previous.fitNonce) this.scene.fit();
        if (state.fitSelectionNonce !== previous.fitSelectionNonce) this.scene.fitSelection();
      }),
    );

    const observer = new ResizeObserver(() => app.resize());
    observer.observe(host);
    this.cleanups.push(() => observer.disconnect());

    const tick = () => this.tick(app.ticker.deltaMS);
    app.ticker.add(tick);
    this.cleanups.push(() => app.ticker.remove(tick));
  }

  dispose(): void {
    for (const c of this.cleanups.splice(0)) c();
    this.system.dispose();
    this.galaxy.dispose();
  }

  /** Shows what the scene store says the map shows. */
  private follow(shown: Shown): void {
    if (shown.kind === "system") {
      this.system.show(shown.id);
      this.show(this.system);
    } else {
      this.show(this.galaxy);
    }
  }

  /** Swaps `next` in for the scene shown now, which keeps its state while hidden. */
  show(next: Scene): void {
    if (next === this.scene) return;
    this.scene.deactivate();
    this.app.stage.removeChild(this.scene.root);
    this.scene = next;
    this.enter(next);
  }

  /** The canvas may have changed size while `scene` was hidden, so its camera is sized before its first tick. */
  private enter(scene: Scene): void {
    this.app.stage.addChild(scene.root);
    scene.cam.setViewport(this.app.renderer.width, this.app.renderer.height);
    this.appliedRev = -1;
    scene.activate();
  }

  private tick(dtMs: number): void {
    const { cam } = this.scene;
    const { width, height } = this.app.renderer;
    cam.setViewport(width, height);
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
      cam.panBy(dx * step, dy * step);
    }
    cam.update(dtMs);
    // The scene may fit its camera in its tick, which the transform then shows in the same frame.
    this.scene.tick(dtMs);
    this.place(this.scene);
  }

  private place(scene: Scene): void {
    if (scene.cam.rev === this.appliedRev) return;
    this.appliedRev = scene.cam.rev;
    const t = scene.cam.worldTransform(this.transform);
    scene.root.position.set(t.x, t.y);
    scene.root.scale.set(t.scaleX, t.scaleY);
  }

  private bindWheel(canvas: HTMLCanvasElement): void {
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 33 : e.deltaY;
      this.scene.cam.zoomAt({ x: e.offsetX, y: e.offsetY }, Math.pow(ZOOM_PER_100PX, -px / 100));
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
