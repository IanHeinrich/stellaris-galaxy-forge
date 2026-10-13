import { MOON_RING_FIRST } from "../../generated/constants";
import {
  DRAG_HINTS,
  GEOMETRY_REASONS,
  lockedHint,
  lockedToName,
  toMoonHint,
  toStarHint,
  type BodyEditing,
  type BodyRefusal,
  type GeometryIntent,
} from "../../lib/details/orbitIntent";
import { isCentreStar, orbitParent, overlapOf } from "../../lib/details/orbitReach";
import { near, polarAbout, wrapDegrees, type BodyPlacement } from "../../lib/details/orbits";
import type { Pt } from "../../lib/geometry/pt";
import {
  captureReach,
  change,
  degrees,
  heldAbout,
  holdFrom,
  holdHint,
  nearestRing,
  nearestWithin,
  NO_MARKS,
  ORIGIN,
  pixelsFromPointer,
  SHARED_SNAP_PX,
  snapAngle,
  whole,
  type Drag,
  type DragFrame,
  type DragMarks,
  type DragPointer,
  type DragReadout,
  type DragStep,
  type Hold,
} from "./drag";
import { drawnDisc, DISC_ONLY } from "./geometry";

/** How far past the ring a dragged body would land on, in screen pixels, a host takes it. */
const CAPTURE_RING_PX = 8;
/** How near, in world units, the pointer must come for a star off the centre to take a body. */
const STAR_CAPTURE_UNITS = 40;
/** A host keeps a body it has taken until the pointer is this many times its reach away. */
const CAPTURE_HOLD = 1.5;
/** A body dropped on a star off the centre orbits at least this many world units past its disc. */
const STAR_ORBIT_PAST = 5;
/** The least orbit, in world units, a body dropped on a star off the centre takes. */
const STAR_ORBIT_LEAST = 10;
/**
 * A moon comes away from its planet once the pointer is past this many times the planet's
 * outermost moon ring, and this many screen pixels beyond that.
 */
const DETACH_RING_FACTOR = 2;
const DETACH_PAST_PX = 30;

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

/** What the readout calls a body that refuses to be orbited, by why it refuses. */
const REFUSING_HOST: Readonly<Record<BodyRefusal, string>> = {
  star: "the star at the centre",
  orbitsCentre: "the star it orbits",
  starMoon: "a star",
  hasMoons: "a planet with moons",
  moonHost: "a moon",
  asteroidHost: "an asteroid",
  aboutPlanet: "a body orbiting a planet",
  ringworld: "a ring world segment",
  noOrbit: "a moon",
};

/** Where a drag would put the body, before what it is marked with. */
interface Landing {
  parent: number | null;
  radius: number;
  angle: number;
  shared: number | null;
}

/**
 * A planet, moon or star off the centre dragged: freely, its orbit and angle both following the pointer; with Ctrl, along
 * its orbit or across orbits from where it stood as Ctrl went down, as the travel so far chose;
 * onto another body to become its moon, or onto a star to orbit it; or, for a moon or a planet of a
 * star off the centre, far enough from what it orbits, or onto the star at the centre, to orbit
 * what that orbits. A locked body, or one held with Ctrl, does neither: it moves only about what it
 * orbits.
 */
export class BodyDrag implements Drag {
  private constructor(
    private readonly frame: DragFrame,
    private readonly system: number,
    private readonly body: BodyPlacement & { ring: NonNullable<BodyPlacement["ring"]> },
    private readonly own: BodyEditing,
    /** From the pointer to the body's centre, as it was grabbed. */
    private readonly grab: Pt,
    /** Bodies it can never be dropped on: itself, its moons and what it orbits now. */
    private readonly passed: ReadonlySet<number>,
    /** Its planet's outermost moon ring, for a moon that may come away; null otherwise. */
    private readonly outerMoonRing: number | null,
    /** What it is locked to, as the readout names it; null while it is not locked. */
    private readonly lockedTo: string | null,
  ) {
    const centre = { x: body.ring.cx, y: body.ring.cy };
    this.last = { radius: body.ring.radius, angle: polarAbout(body, centre).angle };
  }

  /** The host that took the body on the last move, which keeps it while the pointer stays near. */
  private holder: number | null = null;
  /** Where the last move put the body about what it orbits. */
  private last: Pick<Landing, "radius" | "angle">;
  /** Ctrl's hold, while Ctrl is down. */
  private hold: Hold | null = null;

  /** The drag of body `id`, pressed at `from`, or null when it may not move. */
  static start(frame: DragFrame, id: number, from: Pt): BodyDrag | null {
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
    const passed = subtree(frame.layout.bodies, id);
    if (body.parent !== null) passed.add(body.parent);
    const siblings = frame.layout.bodies.filter((b) => b.parent === body.parent && b.ring);
    const outer = own.detachTo !== undefined && body.parent !== null;
    const locked = own.move && frame.lockedBodies.has(id);
    const nameOf = (parent: number) => frame.bodyById.get(parent)?.name;
    return new BodyDrag(
      frame,
      frame.id,
      { ...body, ring },
      own,
      { x: body.x - from.x, y: body.y - from.y },
      passed,
      outer ? Math.max(...siblings.map((b) => b.ring!.radius)) : null,
      locked ? lockedToName(orbitParent(frame.layout, body), nameOf) : null,
    );
  }

  move(pointer: DragPointer): DragStep {
    this.hold = pointer.ctrl ? (this.hold ?? this.holdAt(pointer)) : null;
    if (this.lockedTo !== null) {
      const lead = `${lockedHint(this.lockedTo)} · `;
      return this.marked(this.landing(pointer), lead + this.hint(), lead);
    }
    if (this.hold !== null) {
      this.holder = null;
      return this.onOrbit(pointer);
    }
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
    if (this.detaches(pointer)) return this.detached(pointer);
    return this.onOrbit(pointer);
  }

  /**
   * Ctrl's hold from where the last move put the body: across orbits when the travel so far runs
   * more out from its ring's centre than round it, else along its orbit.
   */
  private holdAt(pointer: DragPointer): Hold {
    return holdFrom(this.last, this.body, this.held(pointer));
  }

  /**
   * Over a body while it may not be given that body as a parent: it says why, and moves on its axis.
   * Landing on top of that body is said instead.
   */
  private unmoored(pointer: DragPointer, why?: string): DragStep {
    const step = this.onOrbit(pointer);
    if (step.marks.tone === "overlap") return step;
    const own = this.own.refusal === undefined ? undefined : GEOMETRY_REASONS[this.own.refusal];
    const text =
      why ?? (this.body.star ? GEOMETRY_REASONS.starMoon : (own ?? GEOMETRY_REASONS.hasMoons));
    return { ...step, readout: { text, tone: "warn" } };
  }

  private name(id: number): string {
    return this.frame.bodyById.get(id)?.name ?? `#${id}`;
  }

  /**
   * The body the pointer is within capture reach of, nearest first, other than those passed. The
   * host that took it last keeps it until the pointer is well clear, so it does not flicker away.
   * No star takes it while it is still near what it orbits.
   */
  private captured(pointer: DragPointer): BodyPlacement | null {
    const stars = !this.nearParent(pointer);
    const takes = (b: BodyPlacement) => stars || !b.star;
    const holder =
      this.holder === null ? undefined : this.frame.bodyById.get(this.holder)?.placement;
    const keeps = (h: BodyPlacement) =>
      takes(h) && pixelsFromPointer(pointer, h) <= this.reach(h, pointer.scale) * CAPTURE_HOLD;
    if (holder && keeps(holder)) return holder;
    const best = nearestWithin(
      this.frame.layout.bodies,
      pointer,
      (b) => b,
      (b) => (this.passed.has(b.id) || !takes(b) ? null : this.reach(b, pointer.scale)),
    );
    this.holder = best?.id ?? null;
    return best;
  }

  /** How near, in screen pixels, the pointer must come for `b` to take the dragged body. */
  private reach(b: BodyPlacement, scale: number): number {
    const least = captureReach(b.disc, this.lookOf(b.id), scale);
    if (b.star) return isCentreStar(b) ? least : Math.max(least, STAR_CAPTURE_UNITS * scale);
    const ring = this.frame.editing.bodies.get(b.id)?.moonRing;
    return ring === undefined ? least : Math.max(least, ring * scale + CAPTURE_RING_PX);
  }

  private lookOf(id: number) {
    return this.frame.bodyById.get(id)?.look ?? DISC_ONLY;
  }

  private detaches(pointer: DragPointer): boolean {
    if (this.outerMoonRing === null || this.body.parent === null) return false;
    const planet = this.pointOf(this.body.parent);
    const away = Math.hypot(pointer.wx - planet.x, pointer.wy - planet.y);
    return away >= DETACH_RING_FACTOR * this.outerMoonRing + DETACH_PAST_PX / pointer.scale;
  }

  /** Whether it may come away from what it orbits, and the pointer is not yet far enough to. */
  private nearParent(pointer: DragPointer): boolean {
    return this.outerMoonRing !== null && this.body.parent !== null && !this.detaches(pointer);
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
    const { parent, ring } = this.body;
    const centre = { x: ring.cx, y: ring.cy };
    const radiusOf = () => this.radiusAbout(parent, centre, pointer);
    const at = heldAbout(this.held(pointer), centre, this.hold, pointer.shift, radiusOf);
    const landing: Landing = { parent, ...at };
    this.last = landing;
    return landing;
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
      marks: { ...NO_MARKS, body, ghost: { x, y, disc }, ...marks },
      readout,
      hint,
      changed: refused === undefined && (reparents || !same),
    };
    return refused === undefined ? step : { ...step, refused };
  }

  /** About its own parent: its own ring, one shared with another body, or on top of one. */
  private onOrbit(pointer: DragPointer): DragStep {
    return this.marked(this.landing(pointer), this.hint());
  }

  private hint(): string {
    return holdHint(this.hold, DRAG_HINTS.free);
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
    const note = this.own.note === undefined ? "" : ` · ${this.own.note}`;
    return this.step(landing, marks, { text: lead + this.orbitText(landing) + note }, hint);
  }

  private orbitText({ parent, radius, angle }: Landing): string {
    const from = this.body.ring.radius;
    const orbit = parent !== this.body.parent ? whole(radius) : change(from, radius);
    return `orbit ${orbit} · ${degrees(angle)}`;
  }

  /** Dropped on `host`, it would orbit it on its next moon ring at the pointer's angle about it. */
  private hosted(host: BodyPlacement, pointer: DragPointer): DragStep {
    const radius = this.frame.editing.bodies.get(host.id)?.moonRing ?? MOON_RING_FIRST;
    const angle = snapAngle(
      polarAbout({ x: pointer.wx, y: pointer.wy }, host).angle,
      pointer.shift,
    );
    const landing = { parent: host.id, radius, angle, shared: null };
    const name = this.name(host.id);
    const text = `moon of ${name} · orbit ${whole(radius)} · ${degrees(angle)}`;
    return this.step(landing, { host: host.id }, { text }, toMoonHint(name));
  }

  /**
   * Dropped on a star off the centre, it would orbit it where the pointer is, clear of its disc,
   * or on one of its orbits within reach.
   */
  private aboutStar(star: BodyPlacement, pointer: DragPointer): DragStep {
    const at = { x: pointer.wx, y: pointer.wy };
    const angle = snapAngle(polarAbout(at, star).angle, pointer.shift);
    const disc = drawnDisc(star.disc, pointer.scale, DISC_ONLY);
    const floor = Math.max(STAR_ORBIT_LEAST, Math.ceil(disc + STAR_ORBIT_PAST));
    const { radius, shared } = this.radiusAt(star.id, star, at, pointer.scale);
    const landing = {
      parent: star.id,
      radius: shared === null ? Math.max(floor, radius) : radius,
      angle,
      shared,
    };
    const name = this.name(star.id);
    return this.marked(landing, toStarHint(name), `orbits ${name} · `, { host: star.id });
  }

  /** Dropped on the star at the centre, it would orbit the centre where it stands now. */
  private toCentre(star: BodyPlacement): DragStep {
    const landing = { parent: null, ...polarAbout(this.body, ORIGIN), shared: null };
    const lead = `orbits ${this.name(star.id)} · `;
    return this.marked(landing, DRAG_HINTS.toPlanet, lead, { host: star.id });
  }

  /** Over a body that cannot take it: held about its own parent, and releasing does nothing. */
  private refused(
    target: BodyPlacement,
    editing: BodyEditing | undefined,
    pointer: DragPointer,
  ): DragStep {
    const refusal = editing?.hostRefusal ?? "asteroidHost";
    const reason = GEOMETRY_REASONS[refusal];
    const text = `${this.name(target.id)} is ${REFUSING_HOST[refusal]}`;
    const marks = { tone: "refused" as const, other: target.id };
    return this.step(this.landing(pointer), marks, { text, tone: "warn" }, reason, reason);
  }

  /** Far enough from its planet, a moon becomes a planet about what its planet orbits. */
  private detached(pointer: DragPointer): DragStep {
    const parent = this.own.detachTo ?? null;
    const centre = this.pointOf(parent);
    const angle = snapAngle(polarAbout(this.held(pointer), centre).angle, pointer.shift);
    const landing = { parent, angle, ...this.radiusAbout(parent, centre, pointer) };
    return this.marked(landing, DRAG_HINTS.toPlanet, "planet · ");
  }
}
