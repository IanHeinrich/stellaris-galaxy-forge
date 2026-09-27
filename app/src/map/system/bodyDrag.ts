import { MOON_RING_FIRST } from "../../generated/constants";
import {
  DRAG_HINTS,
  GEOMETRY_REASONS,
  isCentreStar,
  orbitParent,
  overlapOf,
  toMoonHint,
  toStarHint,
  type BodyEditing,
  type GeometryIntent,
} from "../../lib/details/orbitEdits";
import { wrapDegrees, type BodyPlacement } from "../../lib/details/orbits";
import type { Pt } from "../../lib/geometry/pt";
import type { SystemContext } from "./context";
import { drawnDisc } from "./geometry";

/** Within this many screen pixels of another ring about the same centre, a drag takes its radius. */
const SHARED_SNAP_PX = 6;
/** How far past its drawn disc, in screen pixels, a body takes a dragged one as its moon. */
const CAPTURE_PAST_PX = 10;
/** The least reach, in screen pixels, at which a body takes a dragged one as its moon. */
const CAPTURE_MIN_PX = 18;
/** The angle steps Shift snaps to, in degrees. */
const SHIFT_STEP_DEG = 15;
/**
 * A moon comes away from its planet once the pointer is past this many times the planet's
 * outermost moon ring, and this many screen pixels beyond that.
 */
export const DETACH_RING_FACTOR = 2;
export const DETACH_PAST_PX = 30;

/** A handle the scene draws on a belt or the inner radius, which a drag moves. */
export type HandleRef =
  { readonly kind: "belt"; readonly index: number } | { readonly kind: "innerRadius" };

export function sameHandle(a: HandleRef | null, b: HandleRef | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "belt") return b.kind === "belt" && a.index === b.index;
  return a.kind === b.kind;
}

/**
 * How the ring a dragged body lands on is marked: its own, one it shares with another body, on top
 * of another body, or held where it is while another body refuses it.
 */
export type DragTone = "own" | "shared" | "overlap" | "refused";

/** What the scene marks while something is dragged. */
export interface DragMarks {
  /** The body dragged, whose ring in the shown layout is the one it lands on; null for a handle. */
  readonly body: number | null;
  /** Where the body stood before the drag, drawn faint. */
  readonly ghost: { readonly x: number; readonly y: number; readonly disc: number } | null;
  readonly tone: DragTone;
  /** The body it shares its ring with, stands on top of, or is refused by. */
  readonly other: number | null;
  /** The body it would become a moon of. */
  readonly host: number | null;
  readonly handle: HandleRef | null;
}

/** The text at the pointer while something is dragged. */
export interface DragReadout {
  readonly text: string;
  readonly tone?: "warn";
}

/** One move of a drag: where it would put things, what the scene marks and what it says. */
export interface DragStep {
  readonly intent: GeometryIntent;
  readonly marks: DragMarks;
  readonly readout: DragReadout;
  /** What the status bar says. */
  readonly hint: string;
  /** Why releasing here changes nothing; the body stays about its own parent meanwhile. */
  readonly refused?: string;
  /** Whether releasing here would change anything. */
  readonly changed: boolean;
}

/** The pointer as a drag reads it: its scene point, Shift, Ctrl, and screen pixels per world unit. */
export interface DragPointer {
  readonly wx: number;
  readonly wy: number;
  readonly shift: boolean;
  /** Holds a body's drag to the axis its first few pixels picked. */
  readonly ctrl: boolean;
  readonly scale: number;
}

/** What a drag reads of the scene as it starts. */
export type DragFrame = Pick<SystemContext, "id" | "layout" | "editing" | "bodyById">;

/** Anything a gesture drags. */
export interface Drag {
  move(pointer: DragPointer): DragStep;
}

const ORIGIN: Pt = { x: 0, y: 0 };

/** Degrees from `from` to `to` in the save frame, in [0, 360). */
function angleAbout(from: Pt, to: Pt): number {
  return wrapDegrees((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

/** `angle` in whole degrees, or in Shift's steps. */
function snapAngle(angle: number, shift: boolean): number {
  const step = shift ? SHIFT_STEP_DEG : 1;
  return wrapDegrees(Math.round(angle / step) * step);
}

/** How near two values must be to count as the same. */
const SAME = 1e-6;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < SAME;
}

function whole(value: number): string {
  return String(Math.round(value));
}

function degrees(angle: number): string {
  return `${Math.round(angle) % 360}°`;
}

/** A belt kind as a readout names it: `rocky_asteroid_belt` is "rocky". */
export function beltLabel(kind: string): string {
  return kind.replace(/_asteroid_belt$|_belt$/, "").replace(/_/g, " ");
}

/** The ring nearest `radius` among `rings`, within `within` world units, or null. */
function nearestRing(
  rings: readonly { id: number | null; radius: number }[],
  radius: number,
  within: number,
): { id: number | null; radius: number } | null {
  let best: { id: number | null; radius: number } | null = null;
  for (const ring of rings) {
    const gap = Math.abs(ring.radius - radius);
    if (gap <= within && (best === null || gap < Math.abs(best.radius - radius))) best = ring;
  }
  return best;
}

/** The body `id` and every body that orbits it, however far down. */
function subtree(bodies: readonly BodyPlacement[], id: number): Set<number> {
  const found = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const b of bodies) {
      if (b.parent !== null && found.has(b.parent) && !found.has(b.id)) {
        found.add(b.id);
        grew = true;
      }
    }
  }
  return found;
}

/** Why `target` cannot take a moon, and what the readout calls it. */
function hostRefusal(target: BodyPlacement, editing: BodyEditing | undefined) {
  if (isCentreStar(target)) {
    return { reason: GEOMETRY_REASONS.orbitsCentre, what: "the star it orbits" };
  }
  if (target.moon) return { reason: GEOMETRY_REASONS.moonHost, what: "a moon" };
  if (editing?.reason === GEOMETRY_REASONS.ringworld) {
    return { reason: GEOMETRY_REASONS.ringworld, what: "a ring world segment" };
  }
  return { reason: editing?.reason ?? GEOMETRY_REASONS.asteroidHost, what: "an asteroid" };
}

type Axis = "along" | "across";

/** Where a drag would put the body, before what it is marked with. */
interface Landing {
  parent: number | null;
  radius: number;
  angle: number;
  shared: number | null;
}

/**
 * A planet, moon or star off the centre dragged: freely, its orbit and angle both following the pointer; with Ctrl, along
 * its orbit or across orbits, as the first few pixels of the drag chose; onto another body to become
 * its moon, or onto a star to orbit it; or, for a moon or a planet of a star off the centre, far
 * enough from what it orbits, or onto the star at the centre, to orbit what that orbits.
 */
export class BodyDrag implements Drag {
  private constructor(
    private readonly frame: DragFrame,
    private readonly system: number,
    private readonly body: BodyPlacement & { ring: NonNullable<BodyPlacement["ring"]> },
    private readonly own: BodyEditing,
    private readonly axis: Axis,
    /** From the pointer to the body's centre, as it was grabbed. */
    private readonly grab: Pt,
    /** Bodies it can never be dropped on: itself, its moons and what it orbits now. */
    private readonly passed: ReadonlySet<number>,
    /** Its planet's outermost moon ring, for a moon that may come away; null otherwise. */
    private readonly outerMoonRing: number | null,
  ) {}

  /**
   * The drag of body `id`, pressed at `from` and now at `to`, or null when it may not move. The
   * travel so far picks the axis Ctrl holds it to: out from its ring's centre, or round it.
   */
  static start(frame: DragFrame, id: number, from: Pt, to: Pt): BodyDrag | null {
    const body = frame.layout.bodies.find((b) => b.id === id);
    const own = frame.editing.bodies.get(id);
    if (frame.id === null || !body || !own) return null;
    // One with no orbit of its own is dragged about the centre, where it is drawn.
    const ring = own.move
      ? body.ring
      : own.detachOnly
        ? { cx: 0, cy: 0, radius: Math.hypot(body.x, body.y) }
        : null;
    if (!ring) return null;
    const out = Math.hypot(body.x - ring.cx, body.y - ring.cy) || 1;
    const ux = (body.x - ring.cx) / out;
    const uy = (body.y - ring.cy) / out;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const radial = Math.abs(dx * ux + dy * uy);
    const round = Math.abs(dx * uy - dy * ux);
    const passed = subtree(frame.layout.bodies, id);
    if (body.parent !== null) passed.add(body.parent);
    const siblings = frame.layout.bodies.filter((b) => b.parent === body.parent && b.ring);
    const outer = own.detachTo !== undefined && body.parent !== null;
    return new BodyDrag(
      frame,
      frame.id,
      { ...body, ring },
      own,
      radial > round ? "across" : "along",
      { x: body.x - from.x, y: body.y - from.y },
      passed,
      outer ? Math.max(...siblings.map((b) => b.ring!.radius)) : null,
    );
  }

  move(pointer: DragPointer): DragStep {
    const target = this.captured(pointer);
    if (target && !this.own.reparent) return this.unmoored(pointer);
    if (target) {
      const editing = this.frame.editing.bodies.get(target.id);
      const orbitsCentre = orbitParent(this.frame.layout, this.body) === null;
      if (isCentreStar(target) && !orbitsCentre) return this.toCentre(target);
      if (!editing?.host) return this.refused(target, editing, pointer);
      if (target.star) return this.aboutStar(target, pointer);
      if (!this.own.asMoon) return this.unmoored(pointer, GEOMETRY_REASONS.hasMoons);
      return this.hosted(target, pointer);
    }
    const free = !pointer.ctrl || this.axis === "across";
    if (free && this.detaches(pointer)) return this.detached(pointer);
    return this.onOrbit(pointer);
  }

  /**
   * Over a body while it may not be given that body as a parent: it says why, and moves on its axis.
   * Landing on top of that body is said instead.
   */
  private unmoored(pointer: DragPointer, why?: string): DragStep {
    const step = this.onOrbit(pointer);
    if (step.marks.tone === "overlap") return step;
    const text =
      why ??
      (this.body.star ? GEOMETRY_REASONS.starMoon : (this.own.reason ?? GEOMETRY_REASONS.hasMoons));
    return { ...step, readout: { text, tone: "warn" } };
  }

  private name(id: number): string {
    return this.frame.bodyById.get(id)?.name ?? `#${id}`;
  }

  /** The body the pointer is within capture reach of, nearest first, other than those passed. */
  private captured(pointer: DragPointer): BodyPlacement | null {
    let best: BodyPlacement | null = null;
    let bestPx = Infinity;
    for (const b of this.frame.layout.bodies) {
      if (this.passed.has(b.id)) continue;
      const px = Math.hypot(b.x - pointer.wx, b.y - pointer.wy) * pointer.scale;
      const disc = drawnDisc(b.disc, pointer.scale) * pointer.scale;
      const reach = Math.max(CAPTURE_MIN_PX, disc + CAPTURE_PAST_PX);
      if (px <= reach && px < bestPx) {
        best = b;
        bestPx = px;
      }
    }
    return best;
  }

  private detaches(pointer: DragPointer): boolean {
    if (this.outerMoonRing === null || this.body.parent === null) return false;
    const planet = this.pointOf(this.body.parent);
    const away = Math.hypot(pointer.wx - planet.x, pointer.wy - planet.y);
    return away >= DETACH_RING_FACTOR * this.outerMoonRing + DETACH_PAST_PX / pointer.scale;
  }

  private pointOf(id: number | null): Pt {
    if (id === null) return ORIGIN;
    return this.frame.layout.bodies.find((b) => b.id === id) ?? ORIGIN;
  }

  /** Where the body's centre would be, as the pointer holds it. */
  private held(pointer: DragPointer): Pt {
    return { x: pointer.wx + this.grab.x, y: pointer.wy + this.grab.y };
  }

  /** Where the body is held from `centre` in whole units, or another ring's there within reach. */
  private radiusAbout(
    parent: number | null,
    centre: Pt,
    pointer: DragPointer,
  ): { radius: number; shared: number | null } {
    return this.radiusAt(parent, centre, this.held(pointer), pointer.scale);
  }

  /** `point`'s distance from `centre` in whole units, or another ring's there within reach. */
  private radiusAt(
    parent: number | null,
    centre: Pt,
    point: Pt,
    scale: number,
  ): { radius: number; shared: number | null } {
    const distance = Math.hypot(point.x - centre.x, point.y - centre.y);
    const rings = this.frame.layout.bodies.flatMap((b) =>
      b.id !== this.body.id && b.parent === parent && b.ring
        ? [{ id: b.id, radius: b.ring.radius }]
        : [],
    );
    const shared = nearestRing(rings, distance, SHARED_SNAP_PX / scale);
    if (shared) return { radius: shared.radius, shared: shared.id };
    return { radius: Math.max(1, Math.round(distance)), shared: null };
  }

  /** Where the pointer puts it about its own parent: freely, or on Ctrl's axis. */
  private landing(pointer: DragPointer): Landing {
    const { parent, ring, angle } = this.body;
    const centre = { x: ring.cx, y: ring.cy };
    if (!pointer.ctrl) {
      const turned = snapAngle(angleAbout(centre, this.held(pointer)), pointer.shift);
      return { parent, angle: turned, ...this.radiusAbout(parent, centre, pointer) };
    }
    if (this.axis === "along") {
      const turned = snapAngle(angleAbout(centre, this.held(pointer)), pointer.shift);
      return { parent, radius: ring.radius, angle: turned, shared: null };
    }
    return { parent, angle, ...this.radiusAbout(parent, centre, pointer) };
  }

  private step(
    landing: Landing,
    marks: Partial<DragMarks>,
    readout: DragReadout,
    hint: string,
    refused?: string,
  ): DragStep {
    const { parent, radius, angle } = landing;
    const system = this.system;
    const body = this.body.id;
    const reparents = parent !== this.body.parent || this.own.detachOnly === true;
    const intent: GeometryIntent = reparents
      ? { kind: "reparent", system, body, parent, radius, angle }
      : { kind: "move", system, body, radius, angle };
    const same =
      near(radius, this.body.ring.radius) && near(wrapDegrees(angle - this.body.angle + 180), 180);
    const { x, y, disc } = this.body;
    const step: DragStep = {
      intent,
      marks: {
        body,
        ghost: { x, y, disc },
        tone: "own",
        other: null,
        host: null,
        handle: null,
        ...marks,
      },
      readout,
      hint,
      changed: refused === undefined && (reparents || !same),
    };
    return refused === undefined ? step : { ...step, refused };
  }

  /** About its own parent: its own ring, one shared with another body, or on top of one. */
  private onOrbit(pointer: DragPointer): DragStep {
    return this.marked(this.landing(pointer), this.hint(pointer));
  }

  private hint(pointer: DragPointer): string {
    if (!pointer.ctrl) return DRAG_HINTS.free;
    return this.axis === "along" ? DRAG_HINTS.along : DRAG_HINTS.across;
  }

  /** `landing` marked as overlapping another body before sharing its ring. */
  private marked(
    landing: Landing,
    hint: string,
    lead = "",
    marks: Partial<DragMarks> = {},
  ): DragStep {
    const { parent, radius, angle, shared } = landing;
    const over = overlapOf(this.frame.layout, this.body.id, parent, radius, angle);
    if (over !== null) {
      const text = `overlaps ${this.name(over)}`;
      const overlap = { ...marks, tone: "overlap" as const, other: over };
      return this.step(landing, overlap, { text, tone: "warn" }, hint);
    }
    if (shared !== null) {
      const text = `${lead}orbit ${whole(radius)} · shared with ${this.name(shared)}`;
      return this.step(landing, { ...marks, tone: "shared", other: shared }, { text }, hint);
    }
    return this.step(landing, marks, { text: lead + this.orbitText(landing) }, hint);
  }

  private orbitText({ parent, radius, angle }: Landing): string {
    const from = whole(this.body.ring.radius);
    const to = whole(radius);
    const orbit = from === to || parent !== this.body.parent ? to : `${from} → ${to}`;
    return `orbit ${orbit} · ${degrees(angle)}`;
  }

  /** Dropped on `host`, it would orbit it on its next moon ring at the pointer's angle about it. */
  private hosted(host: BodyPlacement, pointer: DragPointer): DragStep {
    const radius = this.frame.editing.bodies.get(host.id)?.moonRing ?? MOON_RING_FIRST;
    const angle = snapAngle(angleAbout(host, { x: pointer.wx, y: pointer.wy }), pointer.shift);
    const landing = { parent: host.id, radius, angle, shared: null };
    const name = this.name(host.id);
    const text = `moon of ${name} · orbit ${whole(radius)} · ${degrees(angle)}`;
    return this.step(landing, { host: host.id }, { text }, toMoonHint(name));
  }

  /** Dropped on a star off the centre, it would orbit it on its next orbit at the pointer's angle. */
  private aboutStar(star: BodyPlacement, pointer: DragPointer): DragStep {
    const angle = snapAngle(angleAbout(star, { x: pointer.wx, y: pointer.wy }), pointer.shift);
    const radius = this.frame.editing.bodies.get(star.id)?.moonRing ?? MOON_RING_FIRST;
    const landing = { parent: star.id, radius, angle, shared: null };
    const name = this.name(star.id);
    return this.marked(landing, toStarHint(name), `orbits ${name} · `, { host: star.id });
  }

  /** Dropped on the star at the centre, it would orbit the centre where it stands now. */
  private toCentre(star: BodyPlacement): DragStep {
    const radius = Math.hypot(this.body.x, this.body.y);
    const landing = { parent: null, radius, angle: angleAbout(ORIGIN, this.body), shared: null };
    const lead = `orbits ${this.name(star.id)} · `;
    return this.marked(landing, DRAG_HINTS.toPlanet, lead, { host: star.id });
  }

  /** Over a body that cannot take it: held about its own parent, and releasing does nothing. */
  private refused(
    target: BodyPlacement,
    editing: BodyEditing | undefined,
    pointer: DragPointer,
  ): DragStep {
    const { reason, what } = hostRefusal(target, editing);
    const text = `${this.name(target.id)} is ${what}`;
    const marks = { tone: "refused" as const, other: target.id };
    return this.step(this.landing(pointer), marks, { text, tone: "warn" }, reason, reason);
  }

  /** Far enough from its planet, a moon becomes a planet about what its planet orbits. */
  private detached(pointer: DragPointer): DragStep {
    const parent = this.own.detachTo ?? null;
    const centre = this.pointOf(parent);
    const angle = snapAngle(angleAbout(centre, this.held(pointer)), pointer.shift);
    const landing = { parent, angle, ...this.radiusAbout(parent, centre, pointer) };
    return this.marked(landing, DRAG_HINTS.toPlanet, "planet · ");
  }
}

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
    const marks: DragMarks = {
      body: null,
      ghost: null,
      tone: "own",
      other: null,
      host: null,
      handle: this.handle,
    };
    const system = this.system;
    const from = whole(this.radius);
    if (this.handle.kind === "innerRadius") {
      const radius = Math.max(this.frame.editing.innerFloor, Math.round(distance));
      const to = whole(radius);
      return {
        intent: { kind: "innerRadius", system, radius },
        marks,
        readout: { text: from === to ? `Inner radius ${to}` : `Inner radius ${from} → ${to}` },
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
    const to = whole(radius);
    const kind = beltLabel(this.frame.layout.belts[index]?.kind ?? "");
    const r = from === to ? `r ${to}` : `r ${from} → ${to}`;
    return {
      intent: { kind: "setBeltRadius", system, index, radius },
      marks: shared ? { ...marks, tone: "shared", other: shared.id } : marks,
      readout: { text: `Belt · ${kind} · ${r}` },
      hint: DRAG_HINTS.belt,
      changed: !near(radius, this.radius),
    };
  }
}
