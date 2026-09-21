import type { NebulaPick } from "../picking";
import type { LaneSource, LaneTarget, MapInput, MapIntent, MapModel } from "./MapIntent";
import { groupOf, laneSourceOf, pastThreshold, pressFrom, type Press } from "./press";

type Drag =
  | { kind: "pan" }
  | { kind: "none" }
  | { kind: "marquee" }
  | { kind: "move"; id: number }
  | { kind: "moveGroup"; ids: number[] }
  | { kind: "lane"; from: LaneSource; target: LaneTarget | null }
  | { kind: "nebula"; index: number }
  | { kind: "nebulaRadius"; index: number }
  | { kind: "feZone"; anchor: number };

function idleCursor(input: MapInput): string {
  if (input.zone === "port" || (input.zone !== null && input.shift)) return "crosshair";
  if (input.zone !== null) return "move";
  if (input.midpointHit) return "pointer";
  if (input.nebula) return nebulaCursor(input.nebula);
  return "";
}

function nebulaCursor(pick: NebulaPick): string {
  switch (pick.part) {
    case "ring":
      return "move";
    case "handle":
      return pick.axis === "y" ? "ns-resize" : "ew-resize";
    case "centre":
      return "pointer";
  }
}

/** No modes: what is under the pointer at press decides what a drag does. */
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
      case "marquee":
        return "crosshair";
      case "move":
      case "moveGroup":
      case "nebula":
      case "nebulaRadius":
      case "feZone":
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
        intent.endLane();
        break;
      case "marquee":
        intent.endMarquee();
        break;
      case "nebula":
      case "nebulaRadius":
        intent.endNebula();
        break;
      case "feZone":
        intent.endFeZone();
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
      } else if (input.edge?.kind === "lane") {
        intent.contextMenu({ kind: "lane", lane: input.edge.lane }, input.sx, input.sy);
      } else if (input.edge) {
        intent.contextMenu({ kind: "feZone", anchor: input.edge.anchor }, input.sx, input.sy);
      } else if (input.feZone) {
        intent.contextMenu({ kind: "feZone", anchor: input.feZone.anchor }, input.sx, input.sy);
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
      case "nebula":
        intent.previewNebula(this.drag.index, input.wx, input.wy);
        return "consumed";
      case "nebulaRadius":
        intent.previewNebulaRadius(this.drag.index, input.wx, input.wy);
        return "consumed";
      case "feZone":
        intent.previewFeZone(this.drag.anchor, input.wx, input.wy);
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
        if (drag.target?.valid) intent.connect(drag.from, drag.target);
        intent.endLane();
        break;
      case "nebula":
        intent.commitNebula(drag.index, input.wx, input.wy);
        break;
      case "nebulaRadius":
        intent.commitNebulaRadius(drag.index, input.wx, input.wy);
        break;
      case "feZone":
        intent.commitFeZone(drag.anchor, input.wx, input.wy);
        break;
    }
  }

  private click(press: Press, intent: MapIntent): void {
    if (press.system !== null) {
      if (press.ctrl || press.shift) intent.toggleSelect(press.system);
      else intent.select(press.system);
    } else if (press.edge && (press.shift || press.midpointHit)) {
      intent.cut(press.edge);
    } else if (press.edge?.kind === "lane") {
      intent.selectLane(press.edge.lane);
    } else if (press.edge) {
      intent.selectFeZone(press.edge.anchor);
    } else if (press.feZone) {
      intent.selectFeZone(press.feZone.anchor);
    } else if (press.nebula) {
      intent.selectNebula(press.nebula.index);
    } else if (!press.ctrl && !press.shift) {
      intent.clearSelection();
    }
  }
}

function dragFrom(press: Press): Drag {
  const from = laneSourceOf(press);
  if (from) return { kind: "lane", from, target: null };
  if (press.system === null) {
    if (press.shift) return press.edge ? { kind: "none" } : { kind: "marquee" };
    if (press.feZone) return { kind: "feZone", anchor: press.feZone.anchor };
    if (press.nebula) {
      const index = press.nebula.index;
      switch (press.nebula.part) {
        case "ring":
          return { kind: "nebula", index };
        case "handle":
          return { kind: "nebulaRadius", index };
        case "centre":
          return { kind: "none" };
      }
    }
    return { kind: "none" };
  }
  const group = groupOf(press.selection, press.system);
  return group ? { kind: "moveGroup", ids: group } : { kind: "move", id: press.system };
}
