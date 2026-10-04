import type { GeometryIntent } from "../../lib/details/orbitIntent";
import type { Pt } from "../../lib/geometry/pt";
import type { ContextTarget } from "../../store/mapChromeStore";
import type { InputKind } from "../interaction/MapIntent";
import { doubles, pastThreshold, type Tap } from "../interaction/press";
import { BodyDrag, type Drag, type DragPointer, type DragStep } from "./bodyDrag";
import type { SystemContext } from "./context";
import { HandleDrag, WormholeDrag } from "./drags";
import type { SceneTarget } from "./picking";

/** One pointer event in the system scene, with the body, wormhole, handle or arrow under it. */
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
  ctrl: boolean;
  /** Screen pixels per world unit. */
  scale: number;
  /** The event's `timeStamp` in milliseconds. */
  time: number;
  /** The system the scene shows, or null while it shows none. */
  system: number | null;
  /** What the pointer is over, or null for empty space. */
  target: SceneTarget | null;
  /**
   * Whether a left drag from here moves something: the body or wormhole picked can move, or a
   * handle is.
   */
  draggable: boolean;
}

/** What the scene's gestures ask of the scene and the stores. */
export interface SystemIntent {
  /** What the pointer rests on, at (sx, sy); null when it rests on nothing or pans. */
  hover(target: SceneTarget | null, sx: number, sy: number): void;
  /** Highlights the lane to `neighbour`, or drops the highlight. */
  selectLane(neighbour: number | null): void;
  enterSystem(id: number): void;
  contextMenu(target: ContextTarget, sx: number, sy: number): void;
  /** Opens body `id`'s page, straight above the system's. */
  openBody(system: number, id: number): void;
  /** Opens wormhole `id`'s page, straight above the system's. */
  openWormhole(system: number, id: number): void;
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
  system: number | null;
  target: SceneTarget | null;
  draggable: boolean;
  wx: number;
  wy: number;
};

type State =
  | { kind: "idle" }
  | { kind: "pressed"; press: Press }
  | { kind: "panning" }
  | { kind: "drag"; drag: Drag; step: DragStep };

const IDLE: State = { kind: "idle" };

function pointerOf(input: SystemInput): DragPointer {
  const { wx, wy, shift, ctrl, scale } = input;
  return { wx, wy, shift, ctrl, scale };
}

/** The menu a right-click opens: a body's, a belt's, or the space's at the pointer. */
function menuTarget(system: number, { target, wx, wy }: SystemInput): ContextTarget {
  if (target?.kind === "body") return { kind: "body", system, id: target.id };
  if (target?.kind === "handle" && target.ref.kind === "belt") {
    return { kind: "belt", system, index: target.ref.index };
  }
  return { kind: "systemSpace", system, x: wx, y: wy };
}

/** The drag of what `target` names, pressed at `from`, or null where it may not move. */
function dragOf(target: SceneTarget, frame: SystemContext, from: Pt): Drag | null {
  switch (target.kind) {
    case "body":
      return BodyDrag.start(frame, target.id, from);
    case "wormhole":
      return WormholeDrag.start(frame, target.id, from);
    case "handle":
      return HandleDrag.start(frame, target.ref, from);
    case "exit":
      return null;
  }
}

/**
 * The system scene's pointer gestures: pans, hover, body and wormhole clicks, the hyperlane arrows' clicks, and
 * drags of a body, a wormhole or a handle, previewed as they move and sent on release.
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

  /** Whether a body, a wormhole or a handle is being dragged. */
  dragging(): boolean {
    return this.state.kind === "drag";
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
      if (input.system === null) return;
      intent.contextMenu(menuTarget(input.system, input), input.sx, input.sy);
    } else if (input.button === 1) {
      this.state = { kind: "panning" };
    } else if (input.button === 0) {
      const { sx, sy, wx, wy, time, system, target, draggable } = input;
      const press = { sx, sy, wx, wy, time, system, target, draggable };
      this.state = { kind: "pressed", press };
    }
  }

  private move(input: SystemInput, intent: SystemIntent): "consumed" | "pan" {
    const state = this.state;
    switch (state.kind) {
      case "idle":
        intent.hover(input.target, input.sx, input.sy);
        return "consumed";
      case "pressed":
        if (!pastThreshold(state.press, input)) return "consumed";
        this.lastExit = null;
        intent.hover(null, input.sx, input.sy);
        if (state.press.draggable && this.startDrag(state.press, input, intent)) return "consumed";
        this.state = { kind: "panning" };
        return "pan";
      case "panning":
        intent.hover(null, input.sx, input.sy);
        return "pan";
      case "drag": {
        const step = state.drag.move(pointerOf(input));
        this.state = { ...state, step };
        intent.preview(step);
        return "consumed";
      }
    }
  }

  /** Starts the drag the press asks for, if the scene lets it; a body's or wormhole's page opens first. */
  private startDrag(press: Press, input: SystemInput, intent: SystemIntent): boolean {
    const { target } = press;
    if (target === null) return false;
    const drag = dragOf(target, intent.frame(), { x: press.wx, y: press.wy });
    if (drag === null) return false;
    this.open(press, intent);
    const step = drag.move(pointerOf(input));
    this.state = { kind: "drag", drag, step };
    intent.preview(step);
    return true;
  }

  /** Opens the page of the body or wormhole pressed, if it is one. */
  private open({ system, target }: Press, intent: SystemIntent): void {
    if (system === null || target === null) return;
    if (target.kind === "body") intent.openBody(system, target.id);
    else if (target.kind === "wormhole") intent.openWormhole(system, target.id);
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
      case "drag": {
        if (input.button !== 0) {
          this.cancel(intent);
          return;
        }
        this.state = IDLE;
        const { step } = state;
        if (step.changed) intent.commit(step.intent);
        else intent.preview(null);
        intent.hover(input.target, input.sx, input.sy);
        if (step.refused !== undefined) intent.refuse(step.refused);
      }
    }
  }

  private click(press: Press, intent: SystemIntent): void {
    const last = this.lastExit;
    this.lastExit = null;
    const { target } = press;
    if (target?.kind === "exit") {
      const exit = target.id;
      if (last?.exit === exit && doubles(last, press)) {
        intent.enterSystem(exit);
        return;
      }
      intent.selectLane(exit);
      this.lastExit = { exit, sx: press.sx, sy: press.sy, time: press.time };
    } else if (target?.kind === "body" || target?.kind === "wormhole") {
      this.open(press, intent);
    } else {
      intent.selectLane(null);
      intent.showSystem();
    }
  }
}
