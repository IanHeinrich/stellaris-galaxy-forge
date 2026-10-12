import { beltLabel } from "../../lib/details/labels";
import type { MegastructurePlace } from "../../generated/MegastructurePlace";
import { targetRefusal, type MegastructureMove } from "../../lib/details/megastructureMoves";
import { DRAG_HINTS, toStructureHint, type GeometryIntent } from "../../lib/details/orbitIntent";
import { near, polar, polarAbout, wrapDegrees } from "../../lib/details/orbits";
import type { Pt } from "../../lib/geometry/pt";
import {
  change,
  degrees,
  heldAbout,
  holdFrom,
  holdHint,
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
  type Hold,
  type Polar,
} from "./bodyDrag";
import type { SceneBody, SceneWormhole, SystemContext } from "./context";
import { drawnDisc } from "./geometry";

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

/** How far past its drawn disc, in screen pixels, a body takes a dragged megastructure. */
const STRUCTURE_CAPTURE_PAST_PX = 10;
/** The least reach, in screen pixels, at which a body takes a dragged megastructure. */
const STRUCTURE_CAPTURE_MIN_PX = 18;

/** What a megastructure's drag reads of the scene as it starts. */
export type MegastructureFrame = Pick<SystemContext, "id" | "details" | "structures" | "bodies">;

type Moving = Exclude<MegastructureMove, { place: "fixed" }>;

/**
 * A megastructure dragged: one at a point of its own freely about the centre, in whole units and
 * degrees or Shift's steps; one tied to a body onto another body of the system, the bodies its
 * type may stand on ringed while it is held. Each follows the pointer. A tied one settles on a body
 * that takes it; released anywhere else, one the game draws at its own point stays there, still
 * tied to its body, as a moon does, and one the game draws on its body goes back to it.
 */
export class MegastructureDrag implements Drag {
  private constructor(
    private readonly system: number,
    private readonly id: number,
    private readonly name: string,
    private readonly how: Moving,
    /** Where the save puts it. */
    private readonly at: Pt,
    /** From the pointer to its point, as it was grabbed. */
    private readonly grab: Pt,
    private readonly bodies: readonly SceneBody[],
    /** Why each body that will not take it refuses, by id. */
    private readonly refusals: ReadonlyMap<number, string>,
    /** The bodies that will take it. */
    private readonly targets: readonly number[],
  ) {}

  /** Ctrl's hold on a floating structure, while Ctrl is down. */
  private hold: Hold | null = null;
  /** Where the last move put a floating structure about its body. */
  private last: Polar | null = null;

  /** The drag of megastructure `id`, pressed at `from`, or null when it may not move. */
  static start(frame: MegastructureFrame, id: number, from: Pt): MegastructureDrag | null {
    const shown = frame.structures.find((s) => s.kind === "megastructure" && s.id === id);
    const rows = frame.details?.megastructures ?? [];
    const row = rows.find((r) => r.id === id);
    const how = shown?.move;
    if (frame.id === null || !shown || !row || !how || how.place === "fixed") return null;
    const at = row.at ? { x: row.at[0], y: row.at[1] } : { x: shown.x, y: shown.y };
    const refusals = new Map<number, string>();
    const targets: number[] = [];
    if (how.place === "body") {
      for (const body of frame.bodies) {
        const { id: bodyId, star } = body.placement;
        if (bodyId === how.on) continue;
        const target = { id: bodyId, star, name: body.name };
        const why = targetRefusal(how, id, shown.name, target, rows);
        if (why === null) targets.push(bodyId);
        else refusals.set(bodyId, why);
      }
    }
    const grab = { x: at.x - from.x, y: at.y - from.y };
    return new MegastructureDrag(
      frame.id,
      id,
      shown.name,
      how,
      at,
      grab,
      frame.bodies,
      refusals,
      targets,
    );
  }

  move(pointer: DragPointer): DragStep {
    const how = this.how;
    return how.place === "free" ? this.toPoint(pointer) : this.toBody(pointer, how.on, how.floats);
  }

  private intent(at: MegastructurePlace) {
    return {
      kind: "moveMegastructure" as const,
      system: this.system,
      megastructure: this.id,
      at,
    } satisfies GeometryIntent;
  }

  private toPoint(pointer: DragPointer): DragStep {
    const held = { x: pointer.wx + this.grab.x, y: pointer.wy + this.grab.y };
    const radius = Math.max(1, Math.round(Math.hypot(held.x, held.y)));
    const angle = snapAngle(polarAbout(held, ORIGIN).angle, pointer.shift);
    const was = polarAbout(this.at, ORIGIN);
    const same = near(radius, was.radius) && near(wrapDegrees(angle - was.angle + 180), 180);
    const { x, y } = polar(0, 0, radius, angle);
    return {
      intent: this.intent({ place: "free", x, y }),
      marks: { ...NO_MARKS, megastructure: this.id },
      readout: { text: `r ${change(was.radius, radius)} · ${degrees(angle)}` },
      hint: DRAG_HINTS.megastructure,
      changed: !same,
    };
  }

  private toBody(pointer: DragPointer, on: number, floats: boolean): DragStep {
    const marks = { ...NO_MARKS, megastructure: this.id, targets: this.targets };
    const held = { x: pointer.wx + this.grab.x, y: pointer.wy + this.grab.y };
    const stay = { ...this.intent({ place: "body", body: on }), shown: held };
    this.hold = floats && pointer.ctrl ? this.holdAbout(on, held) : null;
    const over = this.hold === null ? this.over(pointer) : null;
    if (over === null || over.placement.id === on) {
      if (floats) return this.beside(on, held, pointer, marks);
      const readout = { text: this.name };
      return { intent: stay, marks, readout, hint: DRAG_HINTS.toBody, changed: false };
    }
    const id = over.placement.id;
    const why = this.refusals.get(id);
    if (why !== undefined) {
      return {
        intent: stay,
        marks: { ...marks, tone: "refused", other: id },
        readout: { text: why, tone: "warn" },
        hint: why,
        refused: why,
        changed: false,
      };
    }
    return {
      intent: this.intent({ place: "body", body: id }),
      marks: { ...marks, host: id },
      readout: { text: `${this.name} · to ${over.name}` },
      hint: toStructureHint(over.name),
      changed: true,
    };
  }

  /** Body `on`'s point, about which a floating structure moves as a moon about its planet. */
  private homeOf(on: number): Pt {
    const home = this.bodies.find((b) => b.placement.id === on)?.placement;
    return home ? { x: home.x, y: home.y } : ORIGIN;
  }

  /** Ctrl's hold about body `on`, taken from where the last move put the structure. */
  private holdAbout(on: number, held: Pt): Hold {
    if (this.hold !== null) return this.hold;
    const last = this.last ?? polarAbout(this.at, this.homeOf(on));
    return holdFrom(last, this.at, held);
  }

  /**
   * Where a floating structure stands while it stays tied to body `on`, moved as a moon about its
   * planet: in whole units and degrees about the body, Shift's steps, or Ctrl's axis.
   */
  private beside(on: number, held: Pt, pointer: DragPointer, marks: DragMarks): DragStep {
    const home = this.homeOf(on);
    const radiusOf = () => ({
      radius: Math.max(1, Math.round(Math.hypot(held.x - home.x, held.y - home.y))),
      shared: null,
    });
    const { radius, angle } = heldAbout(held, home, this.hold, pointer.shift, radiusOf);
    this.last = { radius, angle };
    const was = polarAbout(this.at, home);
    const { x, y } = polar(home.x, home.y, radius, angle);
    const name = this.bodies.find((b) => b.placement.id === on)?.name ?? `#${on}`;
    return {
      intent: this.intent({ place: "beside", body: on, x, y }),
      marks,
      readout: { text: `r ${change(was.radius, radius)} · ${degrees(angle)} about ${name}` },
      hint: holdHint(this.hold, DRAG_HINTS.floating),
      changed: !(near(x, this.at.x) && near(y, this.at.y)),
    };
  }

  /** The body the pointer is within reach of, nearest first, or null. */
  private over(pointer: DragPointer): SceneBody | null {
    let best: SceneBody | null = null;
    let bestPx = Infinity;
    for (const body of this.bodies) {
      const { x, y, disc } = body.placement;
      const px = Math.hypot(x - pointer.wx, y - pointer.wy) * pointer.scale;
      const reach = Math.max(
        STRUCTURE_CAPTURE_MIN_PX,
        drawnDisc(disc, pointer.scale, body.look) * pointer.scale + STRUCTURE_CAPTURE_PAST_PX,
      );
      if (px <= reach && px < bestPx) {
        best = body;
        bestPx = px;
      }
    }
    return best;
  }
}
