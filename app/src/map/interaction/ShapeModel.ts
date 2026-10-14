import type { ShapeDragMods, ShapePick } from "../../lib/shapes/types";
import type { MapInput, MapIntent, MapModel, ShapeDrag } from "./MapIntent";
import { pastThreshold, type Tap } from "./press";

/** A left-button press: what it would drag, and whether it has moved far enough to. */
interface Held {
  drag: ShapeDrag;
  tap: Tap;
  /** Ctrl at the press, which turns snapping off for the whole drag. */
  snap: boolean;
  started: boolean;
}

function dragFor(pick: ShapePick | null, input: MapInput): ShapeDrag {
  const at = { x: input.wx, y: input.wy };
  if (pick?.kind === "handle") return { kind: "handle", id: pick.id };
  if (pick?.kind === "inside") return { kind: "move", press: at };
  return { kind: "draw", anchor: at };
}

/** The drag a press makes: with Alt where systems can be erased, an erase whatever is under it. */
function pressDrag(pick: ShapePick | null, input: MapInput, erases: boolean): ShapeDrag {
  return input.alt && erases
    ? { kind: "erase", anchor: { x: input.wx, y: input.wy } }
    : dragFor(pick, input);
}

function idleCursor(pick: ShapePick | null): string {
  switch (pick?.kind) {
    case "handle":
      return "grab";
    case "inside":
      return "move";
    case undefined:
      return "crosshair";
  }
}

/**
 * The Shape tool: a press on a handle drags it, inside the pending shape moves it, and elsewhere
 * draws a new one; with Alt, where `erases` says the document erases systems, a drag draws a
 * shape that erases what is inside it. The middle button pans. A press that never travels past
 * the drag threshold leaves the shape as it was.
 */
export class ShapeModel implements MapModel {
  private held: Held | null = null;
  private panning = false;
  private idle = "crosshair";

  constructor(private readonly erases: () => boolean = () => false) {}

  handle(input: MapInput, intent: MapIntent): "consumed" | "pan" {
    if (!this.held) this.idle = idleCursor(input.shape);
    switch (input.kind) {
      case "down":
        this.down(input);
        return "consumed";
      case "move":
        if (this.panning) return "pan";
        this.drag(input, intent);
        return "consumed";
      case "up":
        this.up(input, intent);
        return "consumed";
      case "cancel":
        this.reset(intent);
        return "consumed";
    }
  }

  cursor(): string {
    if (this.panning) return "grabbing";
    if (this.held?.started) {
      const drawing = this.held.drag.kind === "draw" || this.held.drag.kind === "erase";
      return drawing ? "crosshair" : "grabbing";
    }
    return this.idle;
  }

  busy(): boolean {
    return this.held !== null || this.panning;
  }

  reset(intent: MapIntent): void {
    if (this.held?.started) intent.endShapeDrag(true);
    this.held = null;
    this.panning = false;
  }

  private down(input: MapInput): void {
    if (this.busy()) return;
    if (input.button === 0) {
      this.held = {
        drag: pressDrag(input.shape, input, this.erases()),
        tap: { sx: input.sx, sy: input.sy, time: input.time },
        snap: !input.ctrl,
        started: false,
      };
    } else if (input.button === 1) {
      this.panning = true;
    }
  }

  private drag(input: MapInput, intent: MapIntent): void {
    const held = this.held;
    if (!held) return;
    if (!held.started && !pastThreshold(held.tap, input)) return;
    held.started = true;
    const mods: ShapeDragMods = { snap: held.snap, constrain: input.shift };
    intent.shapeDrag(held.drag, input.wx, input.wy, mods);
  }

  private up(input: MapInput, intent: MapIntent): void {
    if (input.button === 1 && this.panning) {
      this.panning = false;
    } else if (input.button === 0 && this.held) {
      if (this.held.started) intent.endShapeDrag(false);
      this.held = null;
      this.idle = idleCursor(input.shape);
    }
  }
}
