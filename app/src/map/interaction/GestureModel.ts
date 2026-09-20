import type { LaneTarget, MapInput, MapIntent, MapModel } from "./MapIntent";
import { groupOf, pastThreshold, pressFrom, type Press } from "./press";

type Drag =
  | { kind: "pan" }
  | { kind: "none" }
  | { kind: "marquee" }
  | { kind: "move"; id: number }
  | { kind: "moveGroup"; ids: number[] }
  | { kind: "lane"; from: number; target: LaneTarget | null }
  | { kind: "lanes"; from: number[]; target: LaneTarget | null }
  | { kind: "nebula"; index: number }
  | { kind: "nebulaRadius"; index: number };

function idleCursor(input: MapInput): string {
  if (input.zone === "port" || (input.zone === "star" && input.shift)) return "crosshair";
  if (input.zone === "star") return "move";
  if (input.midpointHit) return "pointer";
  if (input.nebula) return input.nebula.part === "centre" ? "move" : "pointer";
  return "";
}

/** ADR 0003: no modes; what is under the pointer at press (star, port band, lane, nothing) decides. */
export class GestureModel implements MapModel {
  private press: Press | null = null;
  private drag: Drag | null = null;
  private idle = "";

  handle(input: MapInput, intent: MapIntent): "consumed" | "pan" {
    this.idle = idleCursor(input);
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
        this.reset(intent);
        return "consumed";
    }
  }

  cursor(): string {
    switch (this.drag?.kind) {
      case "lane":
      case "lanes":
      case "marquee":
        return "crosshair";
      case "move":
      case "moveGroup":
      case "nebula":
      case "nebulaRadius":
      case "pan":
        return "grabbing";
      default:
        return this.idle;
    }
  }

  busy(): boolean {
    return this.drag !== null;
  }

  reset(intent: MapIntent): void {
    switch (this.drag?.kind) {
      case "move":
      case "moveGroup":
        intent.cancelMove();
        break;
      case "lane":
      case "lanes":
        intent.endLane();
        break;
      case "marquee":
        intent.endMarquee();
        break;
      case "nebula":
      case "nebulaRadius":
        intent.endNebula();
        break;
    }
    this.press = null;
    this.drag = null;
  }

  private down(input: MapInput, intent: MapIntent): void {
    if (this.press) return;
    if (input.button === 2) {
      if (input.system !== null) {
        intent.contextMenu({ kind: "system", id: input.system }, input.sx, input.sy);
      } else if (input.lane) {
        intent.contextMenu({ kind: "lane", lane: input.lane }, input.sx, input.sy);
      } else if (input.nebula) {
        intent.contextMenu({ kind: "nebula", index: input.nebula.index }, input.sx, input.sy);
      } else {
        intent.contextMenu({ kind: "space", x: input.wx, y: input.wy }, input.sx, input.sy);
      }
    } else if (input.button === 0) {
      this.press = pressFrom(input);
    } else if (input.button === 1) {
      this.press = pressFrom(input);
      this.drag = { kind: "pan" };
    }
  }

  private move(input: MapInput, intent: MapIntent): "consumed" | "pan" {
    const press = this.press;
    if (!press) return "consumed";
    if (!this.drag) {
      if (!pastThreshold(press, input)) return "consumed";
      this.drag = dragFrom(press);
    }
    switch (this.drag.kind) {
      case "pan":
        return "pan";
      case "none":
        return "consumed";
      case "marquee":
        intent.previewMarquee(press.sx, press.sy, input.sx, input.sy);
        return "consumed";
      case "move":
        intent.previewMove(this.drag.id, input.wx, input.wy);
        return "consumed";
      case "moveGroup":
        intent.previewMoveGroup(this.drag.ids, input.wx - press.wx, input.wy - press.wy);
        return "consumed";
      case "lane":
        this.drag.target = input.snap;
        intent.previewLane(this.drag.from, input.wx, input.wy, this.drag.target);
        return "consumed";
      case "lanes":
        this.drag.target = input.snap;
        intent.previewLanes(this.drag.from, input.wx, input.wy, this.drag.target);
        return "consumed";
      case "nebula":
        intent.previewNebula(this.drag.index, input.wx, input.wy);
        return "consumed";
      case "nebulaRadius":
        intent.previewNebulaRadius(this.drag.index, input.wx, input.wy);
        return "consumed";
    }
  }

  private up(input: MapInput, intent: MapIntent): void {
    const press = this.press;
    const drag = this.drag;
    if (!press || (input.button !== 0 && input.button !== 1)) return;
    this.press = null;
    this.drag = null;
    if (!drag) {
      this.click(press, intent);
      return;
    }
    switch (drag.kind) {
      case "marquee":
        intent.selectInRect(
          Math.min(press.wx, input.wx),
          Math.min(press.wy, input.wy),
          Math.max(press.wx, input.wx),
          Math.max(press.wy, input.wy),
          input.ctrl ? "add" : "replace",
        );
        intent.endMarquee();
        break;
      case "move":
        intent.commitMove(drag.id, input.wx, input.wy);
        break;
      case "moveGroup":
        intent.commitMoveGroup(drag.ids, input.wx - press.wx, input.wy - press.wy);
        break;
      case "lane":
        if (drag.target?.valid) intent.connect(drag.from, drag.target.id);
        intent.endLane();
        break;
      case "lanes":
        if (drag.target?.valid) intent.connectMany(drag.from, drag.target.id);
        intent.endLane();
        break;
      case "nebula":
        intent.commitNebula(drag.index, input.wx, input.wy);
        break;
      case "nebulaRadius":
        intent.commitNebulaRadius(drag.index, input.wx, input.wy);
        break;
    }
  }

  private click(press: Press, intent: MapIntent): void {
    if (press.system !== null) {
      if (press.ctrl || press.shift) intent.toggleSelect(press.system);
      else intent.select(press.system);
    } else if (press.lane && (press.shift || press.midpointHit)) {
      intent.cut(press.lane.a, press.lane.b);
    } else if (press.lane) {
      intent.selectLane(press.lane);
    } else if (press.nebula) {
      intent.selectNebula(press.nebula.index);
    } else if (!press.ctrl && !press.shift) {
      intent.clearSelection();
    }
  }
}

function dragFrom(press: Press): Drag {
  if (press.system === null) {
    if (press.shift) return press.lane ? { kind: "none" } : { kind: "marquee" };
    if (press.nebula) {
      const index = press.nebula.index;
      return press.nebula.part === "centre"
        ? { kind: "nebula", index }
        : { kind: "nebulaRadius", index };
    }
    return { kind: "none" };
  }
  const group = groupOf(press.selection, press.system);
  if (press.shift || press.zone === "port") {
    return group
      ? { kind: "lanes", from: group, target: null }
      : { kind: "lane", from: press.system, target: null };
  }
  return group ? { kind: "moveGroup", ids: group } : { kind: "move", id: press.system };
}
