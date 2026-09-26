import type { ContextTarget } from "../../store/mapChromeStore";
import type { InputKind } from "../interaction/MapIntent";
import { DRAG_THRESHOLD_PX, doubles, type Tap } from "../interaction/press";

/** One pointer event in the system scene, with the body or hyperlane arrow under it. */
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
  /** The event's `timeStamp` in milliseconds. */
  time: number;
  /** The system the scene shows. */
  system: number;
  body: number | null;
  /** The neighbour whose hyperlane arrow is under the pointer. */
  exit: number | null;
}

/** What the scene's gestures ask of the scene and the stores. */
export interface SystemIntent {
  /** What the pointer rests on, at (sx, sy); both null when it rests on nothing or pans. */
  hover(body: number | null, exit: number | null, sx: number, sy: number): void;
  /** Highlights the lane to `neighbour`, or drops the highlight. */
  selectLane(neighbour: number | null): void;
  enterSystem(id: number): void;
  contextMenu(target: ContextTarget, sx: number, sy: number): void;
}

type Press = Tap & { body: number | null; exit: number | null };

/** The system scene's pointer gestures: pans, hover, and the hyperlane arrows' clicks. */
export class SystemGestureModel {
  private press: Press | null = null;
  private panning = false;
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
        this.reset();
        return "consumed";
    }
  }

  cursor(): string {
    return this.panning ? "grabbing" : "";
  }

  busy(): boolean {
    return this.press !== null;
  }

  reset(): void {
    this.press = null;
    this.panning = false;
    this.lastExit = null;
  }

  private down(input: SystemInput, intent: SystemIntent): void {
    if (this.press) return;
    if (input.button === 2) {
      const target: ContextTarget =
        input.body !== null
          ? { kind: "body", system: input.system, id: input.body }
          : { kind: "systemSpace", system: input.system, x: input.wx, y: input.wy };
      intent.contextMenu(target, input.sx, input.sy);
    } else if (input.button === 0 || input.button === 1) {
      this.press = {
        sx: input.sx,
        sy: input.sy,
        time: input.time,
        body: input.body,
        exit: input.exit,
      };
      this.panning = input.button === 1;
    }
  }

  private move(input: SystemInput, intent: SystemIntent): "consumed" | "pan" {
    const press = this.press;
    if (!press) {
      intent.hover(input.body, input.exit, input.sx, input.sy);
      return "consumed";
    }
    if (!this.panning) {
      if (Math.hypot(input.sx - press.sx, input.sy - press.sy) < DRAG_THRESHOLD_PX) {
        return "consumed";
      }
      this.panning = true;
      this.lastExit = null;
    }
    intent.hover(null, null, input.sx, input.sy);
    return "pan";
  }

  private up(input: SystemInput, intent: SystemIntent): void {
    const press = this.press;
    if (!press || (input.button !== 0 && input.button !== 1)) return;
    const panned = this.panning;
    this.press = null;
    this.panning = false;
    if (!panned && input.button === 0) this.click(press, intent);
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
    } else if (press.body === null) {
      intent.selectLane(null);
    }
  }
}
