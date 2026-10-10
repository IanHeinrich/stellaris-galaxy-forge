import { useMapChromeStore } from "../../store/mapChromeStore";
import type { Camera } from "../Camera";
import type { InputKind } from "./MapIntent";

/** `PointerEvent.buttons` bits. */
const LEFT_BUTTONS = 1;
const MIDDLE_BUTTONS = 4;
/** `PointerEvent.button` values. */
const LEFT = 0;
const MIDDLE = 1;

/** What the bridge reads of an input: the pointer on the screen. */
interface ScreenInput {
  kind: InputKind;
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
  /** `input` measured again under the camera as it stands now, at the same screen point. */
  remeasure?(input: I): I;
}

/**
 * Turns the canvas's pointer events into a scene's inputs, through its picker, and feeds them to
 * its model: it captures the pointer, closes the context menu on a press, pans the camera when the
 * model asks and shows the model's cursor. The middle button pressed during a left-button gesture
 * pans the map while it is held, and the gesture goes on when it is released.
 */
export class PointerBridge<I extends ScreenInput> {
  private panFrom: { sx: number; sy: number } | null = null;
  /** The button whose press the model holds, until it hears the release. */
  private pressed: number | null = null;
  /** Whether a middle button pressed during a left-button gesture is panning the map. */
  private chordPan = false;
  /** The last move the model saw during a press, which a camera move replays. */
  private lastMove: I | null = null;
  /** The camera's revision when the model last saw the pointer. */
  private rev = -1;
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
      this.pressed = e.button;
      this.lastMove = null;
      canvas.setPointerCapture(e.pointerId);
      this.handle(input);
    });
    on("pointermove", (e) => {
      if (this.chorded(e)) return;
      this.move(this.pick("move", e));
    });
    on("pointerup", (e) => {
      this.endChord();
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      this.release(this.pick("up", e));
    });
    on("pointercancel", (e) => {
      this.endChord();
      this.release(this.pick("cancel", e));
    });
    on("pointerleave", () => this.hooks.left());
    // Windows starts autoscroll, and Linux pastes, on a middle press the page lets through.
    on("mousedown", (e) => {
      if (e.button === MIDDLE) e.preventDefault();
    });
  }

  unbind(): void {
    for (const off of this.listeners.splice(0)) off();
    this.pressed = null;
    this.drop();
  }

  /** Forgets a pan in progress. */
  drop(): void {
    this.panFrom = null;
    this.chordPan = false;
    this.lastMove = null;
  }

  /** Hands `input` to the model and shows the cursor it asks for. */
  handle(input: I): "consumed" | "pan" {
    const result = this.model.handle(input);
    if (input.kind === "move" && this.pressed !== null) this.lastMove = input;
    this.rev = this.cam.rev;
    this.canvas.style.cursor = this.chordPan ? "grabbing" : this.model.cursor();
    return result;
  }

  /**
   * The camera moved under a held press without the pointer moving, as the pan keys move it: the
   * model sees the last move again, so what it drags stays under the pointer.
   */
  follow(): void {
    if (this.rev === this.cam.rev) return;
    this.rev = this.cam.rev;
    const last = this.lastMove;
    if (this.pressed === null || this.chordPan || !last || !this.hooks.remeasure) return;
    this.move(this.hooks.remeasure(last));
  }

  private move(input: I): void {
    const panned = this.handle(input) === "pan";
    if (panned) this.panTo(input);
    this.hooks.moved?.(input, panned);
  }

  private release(input: I): void {
    this.pressed = null;
    this.lastMove = null;
    this.handle(input);
    this.hooks.released?.();
  }

  /** Pans the camera by the pointer's travel since the last pan, or starts a pan from here. */
  private panTo(input: I): void {
    const from = this.panFrom;
    if (from) this.cam.panBy(input.sx - from.sx, input.sy - from.sy);
    this.panFrom = { sx: input.sx, sy: input.sy };
    this.rev = this.cam.rev;
  }

  /**
   * While one button is held, the browser sends another's press or release as a move with
   * `button` set to it. A middle press during a left-button gesture pans the map, and the moves
   * while it is held pan it rather than reach the model. A left release in that time ends the
   * gesture there. Returns whether the bridge dealt with the event itself.
   */
  private chorded(e: PointerEvent): boolean {
    const middleDown = (e.buttons & MIDDLE_BUTTONS) !== 0;
    if (!this.chordPan) {
      if (e.button !== MIDDLE || !middleDown || this.pressed !== LEFT) return false;
      this.chordPan = true;
      const input = this.pick("move", e);
      this.panFrom = { sx: input.sx, sy: input.sy };
      this.canvas.style.cursor = "grabbing";
      this.hooks.moved?.(input, true);
      return true;
    }
    if (e.button === MIDDLE && !middleDown) {
      this.endChord();
      return false;
    }
    if (e.button === LEFT && (e.buttons & LEFT_BUTTONS) === 0 && this.pressed === LEFT) {
      this.release(this.pick("up", e));
      return true;
    }
    const input = this.pick("move", e);
    this.panTo(input);
    this.hooks.moved?.(input, true);
    return true;
  }

  private endChord(): void {
    this.chordPan = false;
    this.panFrom = null;
  }
}
