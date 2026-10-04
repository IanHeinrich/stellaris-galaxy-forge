import { beltLabel } from "../../lib/details/labels";
import { DRAG_HINTS } from "../../lib/details/orbitIntent";
import { near, polarAbout, wrapDegrees } from "../../lib/details/orbits";
import type { Pt } from "../../lib/geometry/pt";
import {
  change,
  degrees,
  nearestRing,
  NO_MARKS,
  ORIGIN,
  SHARED_SNAP_PX,
  snapAngle,
  type Drag,
  type DragFrame,
  type DragMarks,
  type DragPointer,
  type DragStep,
  type HandleRef,
} from "./bodyDrag";
import type { SceneWormhole, SystemContext } from "./context";

/**
 * A natural wormhole dragged freely about the centre, in whole units and degrees, or Shift's steps.
 * Nothing takes it and it takes nothing.
 */
export class WormholeDrag implements Drag {
  private constructor(
    private readonly system: number,
    private readonly wormhole: SceneWormhole,
    /** From the pointer to the wormhole's point, as it was grabbed. */
    private readonly grab: Pt,
  ) {}

  /** The drag of wormhole `id`, pressed at `from`, or null when it may not move. */
  static start(frame: WormholeFrame, id: number, from: Pt): WormholeDrag | null {
    const wormhole = frame.wormholes.find((w) => w.id === id);
    if (frame.id === null || !wormhole?.movable) return null;
    return new WormholeDrag(frame.id, wormhole, { x: wormhole.x - from.x, y: wormhole.y - from.y });
  }

  move(pointer: DragPointer): DragStep {
    const at = { x: pointer.wx + this.grab.x, y: pointer.wy + this.grab.y };
    const radius = Math.max(1, Math.round(Math.hypot(at.x, at.y)));
    const angle = snapAngle(polarAbout(at, ORIGIN).angle, pointer.shift);
    const id = this.wormhole.id;
    const was = polarAbout(this.wormhole, ORIGIN);
    const same = near(radius, was.radius) && near(wrapDegrees(angle - was.angle + 180), 180);
    return {
      intent: { kind: "moveWormhole", system: this.system, wormhole: id, radius, angle },
      marks: { ...NO_MARKS, wormhole: id },
      readout: { text: `r ${change(was.radius, radius)} · ${degrees(angle)}` },
      hint: DRAG_HINTS.wormhole,
      changed: !same,
    };
  }
}

/** What a wormhole's drag reads of the scene as it starts. */
export type WormholeFrame = Pick<SystemContext, "id" | "wormholes">;

/** A belt's or the inner radius's handle dragged out or in about the centre, in whole units. */
export class HandleDrag implements Drag {
  private constructor(
    private readonly frame: DragFrame,
    private readonly system: number,
    private readonly handle: HandleRef,
    private readonly radius: number,
    /** From the pointer's distance to the handle's radius, as it was grabbed. */
    private readonly grab: number,
  ) {}

  /** The drag of `handle`, pressed at `from`, or null when it may not be edited. */
  static start(frame: DragFrame, handle: HandleRef, from: Pt): HandleDrag | null {
    const { editing, layout } = frame;
    if (frame.id === null) return null;
    let radius: number;
    if (handle.kind === "belt") {
      const belt = layout.belts[handle.index];
      if (!editing.belts || !belt) return null;
      radius = belt.radius;
    } else {
      if (!editing.innerRadius) return null;
      radius = layout.innerRadius;
    }
    const grab = radius - Math.hypot(from.x, from.y);
    return new HandleDrag(frame, frame.id, handle, radius, grab);
  }

  move(pointer: DragPointer): DragStep {
    const distance = Math.hypot(pointer.wx, pointer.wy) + this.grab;
    const marks: DragMarks = { ...NO_MARKS, handle: this.handle };
    const system = this.system;
    if (this.handle.kind === "innerRadius") {
      const radius = Math.max(this.frame.editing.innerFloor, Math.round(distance));
      return {
        intent: { kind: "innerRadius", system, radius },
        marks,
        readout: { text: `Inner radius ${change(this.radius, radius)}` },
        hint: DRAG_HINTS.innerRadius,
        changed: !near(radius, this.radius),
      };
    }
    const index = this.handle.index;
    const rings = this.frame.layout.bodies.flatMap((b) =>
      b.ring && b.ring.cx === 0 && b.ring.cy === 0 ? [{ id: b.id, radius: b.ring.radius }] : [],
    );
    const shared = nearestRing(rings, distance, SHARED_SNAP_PX / pointer.scale);
    const radius = shared?.radius ?? Math.max(1, Math.round(distance));
    const kind = beltLabel(this.frame.layout.belts[index]?.kind ?? "");
    return {
      intent: { kind: "setBeltRadius", system, index, radius },
      marks: shared ? { ...marks, tone: "shared", other: shared.id } : marks,
      readout: { text: `Belt · ${kind} · r ${change(this.radius, radius)}` },
      hint: DRAG_HINTS.belt,
      changed: !near(radius, this.radius),
    };
  }
}
