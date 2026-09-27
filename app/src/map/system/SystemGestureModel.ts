import type { GeometryIntent } from "../../lib/details/orbitEdits";
import type { ContextTarget } from "../../store/mapChromeStore";
import type { InputKind } from "../interaction/MapIntent";
import { doubles, pastThreshold, type Tap } from "../interaction/press";
import {
  BodyDrag,
  HandleDrag,
  type Drag,
  type DragPointer,
  type DragStep,
  type HandleRef,
} from "./bodyDrag";
import type { SystemContext } from "./context";

/** One pointer event in the system scene, with the body, handle or hyperlane arrow under it. */
export interface SystemInput {
  kind: InputKind;
  sx: number;
  sy: number;
  /** The pointer in the scene's own coordinates. */
  wx: number;
  wy: number;
  /** 0 left, 1 middle, 2 right; -1 on a move. */
  button: number;
  shift: boolean;
  /** Screen pixels per world unit. */
  scale: number;
  /** The event's `timeStamp` in milliseconds. */
  time: number;
  /** The system the scene shows. */
  system: number;
  body: number | null;
  /** The belt or inner-radius handle under the pointer, where no body is. */
  handle: HandleRef | null;
  /** The neighbour whose hyperlane arrow is under the pointer. */
  exit: number | null;
  /** Whether a left drag from here moves something: the body picked can move, or a handle is. */
  draggable: boolean;
}

/** What the scene's gestures ask of the scene and the stores. */
export interface SystemIntent {
  /** What the pointer rests on, at (sx, sy); all null when it rests on nothing or pans. */
  hover(
    body: number | null,
    exit: number | null,
    handle: HandleRef | null,
    sx: number,
    sy: number,
  ): void;
  /** Highlights the lane to `neighbour`, or drops the highlight. */
  selectLane(neighbour: number | null): void;
  enterSystem(id: number): void;
  contextMenu(target: ContextTarget, sx: number, sy: number): void;
  /** Opens body `id`'s page, straight above the system's. */
  openBody(system: number, id: number): void;
  /** Takes the inspector back to the system's page. */
  showSystem(): void;
  /** The scene as a drag starts from it, with no preview. */
  frame(): SystemContext;
  /** Shows where a drag would put things, or drops what was shown. */
  preview(step: DragStep | null): void;
  /** Makes the drag's last intent so; the preview stays until the edit lands. */
  commit(intent: GeometryIntent): void;
  /** A drag released where it may not land, and why. */
  refuse(reason: string): void;
}

type Press = Tap & {
  system: number;
  body: number | null;
  handle: HandleRef | null;
  exit: number | null;
  draggable: boolean;
  wx: number;
  wy: number;
};

type State =
  | { kind: "idle" }
  | { kind: "pressed"; press: Press }
  | { kind: "panning" }
  | { kind: "bodyDrag" | "handleDrag"; drag: Drag; step: DragStep };

const IDLE: State = { kind: "idle" };

function pointerOf(input: SystemInput): DragPointer {
  return { wx: input.wx, wy: input.wy, shift: input.shift, scale: input.scale };
}

/**
 * The system scene's pointer gestures: pans, hover, body clicks, the hyperlane arrows' clicks, and
 * drags of a body or a handle, previewed as they move and sent on release.
 */
export class SystemGestureModel {
  private state: State = IDLE;
  /** The last click on an arrow, which a second one soon after on the same arrow doubles. */
  private lastExit: (Tap & { exit: number }) | null = null;

  handle(input: SystemInput, intent: SystemIntent): "consumed" | "pan" {
    switch (input.kind) {
      case "down":
        this.down(input, intent);
        return "consumed";
      case "move":
        return this.move(input, intent);
      case "up":
        this.up(input, intent);
        return "consumed";
      case "cancel":
        this.cancel(intent);
        return "consumed";
    }
  }

  cursor(): string {
    return this.state.kind === "idle" || this.state.kind === "pressed" ? "" : "grabbing";
  }

  busy(): boolean {
    return this.state.kind !== "idle";
  }

  /** Whether a body or a handle is being dragged. */
  dragging(): boolean {
    return this.state.kind === "bodyDrag" || this.state.kind === "handleDrag";
  }

  /** Drops the gesture in progress, and a drag's preview with it. */
  cancel(intent: SystemIntent): void {
    const dragged = this.dragging();
    this.state = IDLE;
    if (dragged) intent.preview(null);
  }

  reset(): void {
    this.state = IDLE;
    this.lastExit = null;
  }

  private down(input: SystemInput, intent: SystemIntent): void {
    if (this.state.kind !== "idle") return;
    if (input.button === 2) {
      const target: ContextTarget =
        input.body !== null
          ? { kind: "body", system: input.system, id: input.body }
          : { kind: "systemSpace", system: input.system, x: input.wx, y: input.wy };
      intent.contextMenu(target, input.sx, input.sy);
    } else if (input.button === 1) {
      this.state = { kind: "panning" };
    } else if (input.button === 0) {
      const { sx, sy, wx, wy, time, system, body, handle, exit, draggable } = input;
      const press = { sx, sy, wx, wy, time, system, body, handle, exit, draggable };
      this.state = { kind: "pressed", press };
    }
  }

  private move(input: SystemInput, intent: SystemIntent): "consumed" | "pan" {
    const state = this.state;
    switch (state.kind) {
      case "idle":
        intent.hover(input.body, input.exit, input.handle, input.sx, input.sy);
        return "consumed";
      case "pressed":
        if (!pastThreshold(state.press, input)) return "consumed";
        this.lastExit = null;
        intent.hover(null, null, null, input.sx, input.sy);
        if (state.press.draggable && this.startDrag(state.press, input, intent)) return "consumed";
        this.state = { kind: "panning" };
        return "pan";
      case "panning":
        intent.hover(null, null, null, input.sx, input.sy);
        return "pan";
      case "bodyDrag":
      case "handleDrag": {
        const step = state.drag.move(pointerOf(input));
        this.state = { ...state, step };
        intent.preview(step);
        return "consumed";
      }
    }
  }

  /** Starts the drag the press asks for, if the scene lets it; a body's page opens first. */
  private startDrag(press: Press, input: SystemInput, intent: SystemIntent): boolean {
    const frame = intent.frame();
    const to = { x: input.wx, y: input.wy };
    const from = { x: press.wx, y: press.wy };
    let state: State | null = null;
    if (press.handle !== null) {
      const drag = HandleDrag.start(frame, press.handle, from);
      if (drag) state = { kind: "handleDrag", drag, step: drag.move(pointerOf(input)) };
    } else if (press.body !== null) {
      const drag = BodyDrag.start(frame, press.body, from, to);
      if (drag) {
        intent.openBody(press.system, press.body);
        state = { kind: "bodyDrag", drag, step: drag.move(pointerOf(input)) };
      }
    }
    if (state === null) return false;
    this.state = state;
    intent.preview(state.step);
    return true;
  }

  /** A pointer up comes once the last button is released, so it ends whatever gesture is going. */
  private up(input: SystemInput, intent: SystemIntent): void {
    const state = this.state;
    switch (state.kind) {
      case "idle":
        return;
      case "pressed":
        this.state = IDLE;
        if (input.button === 0) this.click(state.press, intent);
        return;
      case "panning":
        this.state = IDLE;
        return;
      case "bodyDrag":
      case "handleDrag": {
        if (input.button !== 0) {
          this.cancel(intent);
          return;
        }
        this.state = IDLE;
        const { step } = state;
        if (step.changed) intent.commit(step.intent);
        else intent.preview(null);
        intent.hover(input.body, input.exit, input.handle, input.sx, input.sy);
        if (step.refused !== undefined) intent.refuse(step.refused);
      }
    }
  }

  private click(press: Press, intent: SystemIntent): void {
    const last = this.lastExit;
    this.lastExit = null;
    if (press.exit !== null) {
      if (last?.exit === press.exit && doubles(last, press)) {
        intent.enterSystem(press.exit);
        return;
      }
      intent.selectLane(press.exit);
      this.lastExit = { exit: press.exit, sx: press.sx, sy: press.sy, time: press.time };
    } else if (press.body !== null) {
      intent.openBody(press.system, press.body);
    } else {
      intent.selectLane(null);
      intent.showSystem();
    }
  }
}
