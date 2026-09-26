import { useMapChromeStore } from "../../store/mapChromeStore";
import type { Camera } from "../Camera";
import type { InputKind } from "./MapIntent";

/** What the bridge reads of an input: the pointer on the screen. */
interface ScreenInput {
  sx: number;
  sy: number;
}

/** The scene's gesture model, bound to the scene's intents. */
export interface BridgedModel<I> {
  /** "pan" from a move asks the bridge to pan the camera by the pointer's travel. */
  handle(input: I): "consumed" | "pan";
  cursor(): string;
}

/** What a scene's controller does around the bridge's own handling of each event. */
export interface PointerHooks<I> {
  /** Before the press reaches the model. */
  pressed?(input: I): void;
  /** After the move has reached the model, and the camera followed it when `panned`. */
  moved?(input: I, panned: boolean): void;
  /** After a release or a cancel has reached the model. */
  released?(): void;
  left(): void;
}

/**
 * Turns the canvas's pointer events into a scene's inputs, through its picker, and feeds them to
 * its model: it captures the pointer, closes the context menu on a press, pans the camera when the
 * model asks and shows the model's cursor.
 */
export class PointerBridge<I extends ScreenInput> {
  private panFrom: { sx: number; sy: number } | null = null;
  private readonly listeners: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cam: Camera,
    private readonly pick: (kind: InputKind, e: PointerEvent) => I,
    private readonly model: BridgedModel<I>,
    private readonly hooks: PointerHooks<I>,
  ) {}

  get bound(): boolean {
    return this.listeners.length > 0;
  }

  bind(): void {
    if (this.bound) return;
    const canvas = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
    ) => {
      canvas.addEventListener(type, handler);
      this.listeners.push(() => canvas.removeEventListener(type, handler));
    };

    on("pointerdown", (e) => {
      useMapChromeStore.getState().closeContextMenu();
      const input = this.pick("down", e);
      this.hooks.pressed?.(input);
      this.panFrom = { sx: input.sx, sy: input.sy };
      canvas.setPointerCapture(e.pointerId);
      this.handle(input);
    });
    on("pointermove", (e) => {
      const input = this.pick("move", e);
      const from = this.handle(input) === "pan" ? this.panFrom : null;
      if (from) {
        this.cam.panBy(input.sx - from.sx, input.sy - from.sy);
        this.panFrom = { sx: input.sx, sy: input.sy };
      }
      this.hooks.moved?.(input, from !== null);
    });
    on("pointerup", (e) => {
      this.panFrom = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      this.handle(this.pick("up", e));
      this.hooks.released?.();
    });
    on("pointercancel", (e) => {
      this.panFrom = null;
      this.handle(this.pick("cancel", e));
      this.hooks.released?.();
    });
    on("pointerleave", () => this.hooks.left());
  }

  unbind(): void {
    for (const off of this.listeners.splice(0)) off();
    this.drop();
  }

  /** Forgets a pan in progress. */
  drop(): void {
    this.panFrom = null;
  }

  /** Hands `input` to the model and shows the cursor it asks for. */
  handle(input: I): "consumed" | "pan" {
    const result = this.model.handle(input);
    this.canvas.style.cursor = this.model.cursor();
    return result;
  }
}
