/**
 * What may be edited in a system's layout and what an edit draws, whatever the document is, and
 * the save's adapter, which turns an intent into the save's geometry ops. `geometryAdapterFor` is
 * the one place a source is chosen, and this is the only file that names the geometry ops.
 */
import type { Bounds } from "../../generated/Bounds";
import type { Capabilities } from "../../generated/Capabilities";
import type { DocumentKind } from "../../generated/DocumentKind";
import type { Op } from "../../generated/Op";
import { BELT_SCATTER, VANILLA_SYSTEM_RADII } from "../../generated/constants";
import { systemLabel } from "../systemLabel";
import { counted } from "../text";
import {
  GEOMETRY_REASONS,
  innerTooSmall,
  isNaturalWormhole,
  type BodyEditing,
  type BodyRefusal,
  type GeometryAdapter,
  type GeometryFrame,
  type GeometryIntent,
  type GeometryOp,
  type SceneEditing,
  type Span,
} from "./orbitIntent";
import {
  angleGap,
  asOrbitParent,
  atCentre,
  grownInner,
  innerFloorOf,
  isCentreStar,
  isOrphan,
  nextMoonRing,
  nextStarRing,
  orbitParent,
  storedRadius,
  under,
} from "./orbitReach";
import {
  near,
  polar,
  rounded,
  saveAngle,
  SAME,
  wrapDegrees,
  type BodyOrbit,
  type BodyPlacement,
  type LayoutOverride,
  type SystemLayout,
} from "./orbits";

type Belt = { kind: string; radius: number };

const NOTHING_EDITABLE: SceneEditing = {
  bodies: new Map(),
  belts: false,
  innerRadius: false,
  innerFloor: VANILLA_SYSTEM_RADII.min_inner,
  wormholes: new Set(),
};

/** Nothing about the system's geometry may be edited. */
export const NO_GEOMETRY: GeometryAdapter = {
  ranges: false,
  editing: () => NOTHING_EDITABLE,
  preview: () => ({}),
  op: () => null,
};

/** Whether the install's classes make `planetClass` an asteroid. */
function isAsteroid(planetClass: string | undefined, classes: GeometryFrame["planetClasses"]) {
  return planetClass !== undefined && classes.get(planetClass)?.asteroid === true;
}

/** Whether the install's classes make `planetClass` a ring world segment. */
function isRingSegment(planetClass: string | undefined, classes: GeometryFrame["planetClasses"]) {
  return planetClass !== undefined && classes.get(planetClass)?.ringworld === true;
}

const FIXED_RING_SEGMENT: BodyEditing = {
  move: false,
  host: false,
  reparent: false,
  asMoon: false,
  refusal: "ringworld",
  hostRefusal: "ringworld",
};

/** Why another body may not orbit `body`, or undefined when it may. */
function hostRefusalOf(body: BodyPlacement, asteroid: boolean): BodyRefusal | undefined {
  if (body.star) return undefined;
  if (body.moon) return "moonHost";
  if (asteroid) return "asteroidHost";
  return undefined;
}

function bodyEditing(
  body: BodyPlacement,
  frame: GeometryFrame,
  byId: ReadonlyMap<number, BodyPlacement>,
  classOf: ReadonlyMap<number, string>,
  parents: ReadonlySet<number>,
): BodyEditing {
  if (isCentreStar(body)) {
    const off = { move: false, host: false, reparent: false, asMoon: false };
    return { ...off, refusal: "star", hostRefusal: "orbitsCentre" };
  }
  if (body.star) {
    const moonRing = nextStarRing(frame, body.id);
    return {
      move: true,
      host: true,
      reparent: false,
      asMoon: false,
      moonRing,
      refusal: "starMoon",
    };
  }
  if (isRingSegment(classOf.get(body.id), frame.planetClasses)) {
    return { ...FIXED_RING_SEGMENT, hostRefusal: body.moon ? "moonHost" : "ringworld" };
  }
  const asteroid = isAsteroid(classOf.get(body.id), frame.planetClasses);
  const hasMoons = parents.has(body.id);
  const hostRefusal = hostRefusalOf(body, asteroid);
  const editing: BodyEditing = {
    move: body.ring !== null,
    host: hostRefusal === undefined,
    reparent: true,
    asMoon: !hasMoons,
  };
  if (editing.host) editing.moonRing = nextMoonRing(frame, body.id);
  else editing.hostRefusal = hostRefusal;
  const parent = orbitParent(frame.layout, body);
  if (parent !== null) {
    const above = byId.get(parent);
    editing.detachTo = above ? orbitParent(frame.layout, above) : null;
  } else if (body.moon) editing.detachTo = null;
  if (isOrphan(body)) {
    editing.detachOnly = true;
    editing.refusal = "noOrbit";
    return editing;
  }
  const refusal = hostRefusal ?? (hasMoons ? "hasMoons" : undefined);
  if (refusal !== undefined) editing.refusal = refusal;
  return editing;
}

/** What may be edited in a system's layout: its bodies, belts, inner radius and natural wormholes. */
export function layoutEditing(frame: GeometryFrame): SceneEditing {
  const { layout, details } = frame;
  if (details === null) return NOTHING_EDITABLE;
  const byId = new Map(layout.bodies.map((b) => [b.id, b]));
  const classOf = new Map(details.planets.map((p) => [p.id, p.class]));
  const parents = new Set(layout.bodies.flatMap((b) => (b.parent === null ? [] : [b.parent])));
  const bodies = new Map(
    layout.bodies.map((b) => [b.id, bodyEditing(b, frame, byId, classOf, parents)]),
  );
  return {
    bodies,
    belts: true,
    innerRadius: details.inner_radius !== null,
    innerFloor: innerFloorOf(frame),
    wormholes: new Set(details.wormholes.filter(isNaturalWormhole).map((w) => w.id)),
  };
}

/** The asteroids about the centre within a belt's scatter of `radius`. */
function beltAsteroids(frame: GeometryFrame, radius: number): BodyPlacement[] {
  const classOf = new Map((frame.details?.planets ?? []).map((p) => [p.id, p.class]));
  return frame.layout.bodies.filter(
    (b) =>
      b.parent === null &&
      b.ring !== null &&
      Math.abs(b.ring.radius - radius) <= BELT_SCATTER &&
      isAsteroid(classOf.get(b.id), frame.planetClasses),
  );
}

function shownBelts(layout: SystemLayout): Belt[] {
  return layout.belts.map(({ kind, radius }) => ({ kind, radius }));
}

/** The belt asteroids a belt moved from `from` to `to` carries with it, by the same step. */
function carriedAsteroids(frame: GeometryFrame, from: number, to: number): Map<number, BodyOrbit> {
  return new Map(
    beltAsteroids(frame, from).map((b) => [
      b.id,
      { parent: null, radius: storedRadius(frame, b) + to - from, angle: b.angle },
    ]),
  );
}

/** `override`, with the inner radius the bodies and belts it moves grow. */
function grown(frame: GeometryFrame, override: LayoutOverride): LayoutOverride {
  const inner = grownInner(frame, override);
  return inner === frame.layout.innerRadius ? override : { ...override, innerRadius: inner };
}

/** A range's middle, where the scene draws a value left to a draw; a value itself. */
function shownValue(span: Span): number {
  return typeof span === "number" ? span : (span.min + span.max) / 2;
}

/** What the scene draws while `intent` is shown, whatever the document is. */
export function layoutPreview(intent: GeometryIntent, frame: GeometryFrame): LayoutOverride {
  const { layout } = frame;
  const belts = shownBelts(layout);
  switch (intent.kind) {
    case "move": {
      const body = layout.bodies.find((b) => b.id === intent.body);
      if (!body) return {};
      const radius = shownValue(intent.radius);
      const to = { parent: body.parent, radius, angle: shownValue(intent.angle) };
      return grown(frame, { bodies: new Map([[intent.body, to]]) });
    }
    case "reparent": {
      const to = {
        parent: intent.parent,
        radius: shownValue(intent.radius),
        angle: shownValue(intent.angle),
      };
      return grown(frame, { bodies: new Map([[intent.body, to]]) });
    }
    case "addBelt":
      return grown(frame, { belts: [...belts, { kind: intent.beltKind, radius: intent.radius }] });
    case "setBeltRadius": {
      const belt = belts[intent.index];
      if (!belt) return {};
      belts[intent.index] = { ...belt, radius: intent.radius };
      const carried = carriedAsteroids(frame, belt.radius, intent.radius);
      return grown(frame, carried.size === 0 ? { belts } : { belts, bodies: carried });
    }
    case "setBeltKind": {
      const belt = belts[intent.index];
      if (!belt) return {};
      belts[intent.index] = { ...belt, kind: intent.beltKind };
      return { belts };
    }
    case "removeBelt":
      return { belts: belts.filter((_, i) => i !== intent.index) };
    case "innerRadius":
      return { innerRadius: intent.radius };
    case "moveWormhole":
      return {
        wormholes: new Map([[intent.wormhole, polar(0, 0, intent.radius, intent.angle)]]),
      };
  }
}

function moveOp(system: number, body: BodyPlacement, radius: number, angle: number): GeometryOp {
  if (!body.ring) return { refused: GEOMETRY_REASONS.noOrbit };
  if (near(body.ring.radius, radius) && angleGap(body.angle, angle) < SAME) return null;
  return { op: { type: "MoveBody", system, body: body.id, radius, angle: wrapDegrees(angle) } };
}

/** The words for `refusal`, where there is one. */
function reasonOf(refusal: BodyRefusal | undefined): string | undefined {
  return refusal === undefined ? undefined : GEOMETRY_REASONS[refusal];
}

/** An intent whose radius and angle are each one value, as a save's ops take them. */
type Fixed<T> = T extends { kind: "move" | "reparent" } ? T & { radius: number; angle: number } : T;
type FixedIntent = Fixed<GeometryIntent>;

function reparentOp(
  intent: Extract<FixedIntent, { kind: "reparent" }>,
  frame: GeometryFrame,
): GeometryOp {
  const { system, radius, angle } = intent;
  const { layout } = frame;
  const body = layout.bodies.find((b) => b.id === intent.body);
  if (!body) return { refused: GEOMETRY_REASONS.elsewhere };
  const parent = asOrbitParent(layout, intent.parent);
  const current = orbitParent(layout, body);
  if (isCentreStar(body)) return { refused: GEOMETRY_REASONS.star };
  if (body.star && parent !== current) return { refused: GEOMETRY_REASONS.starMoon };
  if (isRingSegment(classOfBody(frame, body.id), frame.planetClasses)) {
    return { refused: GEOMETRY_REASONS.ringworld };
  }
  if (!isOrphan(body) && parent === current) return moveOp(system, body, radius, angle);
  const editing = layoutEditing(frame).bodies;
  const own = editing.get(body.id);
  if (!own?.reparent) return { refused: reasonOf(own?.refusal) ?? GEOMETRY_REASONS.hasMoons };
  if (parent !== null) {
    if (under(layout, parent, body.id)) return { refused: GEOMETRY_REASONS.itself };
    const host = layout.bodies.find((b) => b.id === parent);
    if (!host) return { refused: GEOMETRY_REASONS.elsewhere };
    const hostEditing = editing.get(parent);
    if (!hostEditing?.host) {
      const asteroid = isAsteroid(classOfBody(frame, parent), frame.planetClasses);
      const refusal = hostRefusalOf(host, asteroid) ?? hostEditing?.refusal;
      return { refused: reasonOf(refusal) ?? GEOMETRY_REASONS.moonHost };
    }
    if (!host.star && !own.asMoon) return { refused: GEOMETRY_REASONS.hasMoons };
  }
  return {
    op: {
      type: "SetBodyParent",
      system,
      body: body.id,
      parent: parent === null ? "Centre" : { Body: parent },
      radius,
      angle: wrapDegrees(angle),
    },
  };
}

function beltRadiusOp(
  intent: Extract<GeometryIntent, { kind: "setBeltRadius" }>,
  frame: GeometryFrame,
): GeometryOp {
  const { system, index, radius } = intent;
  const belt = frame.layout.belts[index];
  if (!belt || near(belt.radius, radius)) return null;
  const op: Op = { type: "SetBeltRadius", system, index, radius };
  const carried = [...carriedAsteroids(frame, belt.radius, radius)];
  if (carried.some(([, to]) => !(to.radius > 0))) return { refused: GEOMETRY_REASONS.asteroidPast };
  if (carried.length === 0) return { op };
  const moves: Op[] = carried.map(([body, to]) => ({
    type: "MoveBody",
    system,
    body,
    radius: to.radius,
    angle: to.angle,
  }));
  const description =
    `Moved the belt at radius ${rounded(belt.radius)} in ${frame.systemLabel ?? systemLabel("", system, false)} to ` +
    `${rounded(radius)}, with ${counted(moves.length, "asteroid")}`;
  return { op: { type: "Batch", description, ops: [op, ...moves] } };
}

function wormholeOp(
  intent: Extract<GeometryIntent, { kind: "moveWormhole" }>,
  frame: GeometryFrame,
): GeometryOp {
  const { wormhole: id, radius, angle } = intent;
  const wormhole = frame.details?.wormholes.find((w) => w.id === id);
  if (!wormhole) return { refused: GEOMETRY_REASONS.wormholeElsewhere };
  if (!isNaturalWormhole(wormhole)) return { refused: GEOMETRY_REASONS.lockedWormhole };
  if (!(radius > 0)) return { refused: GEOMETRY_REASONS.wormholeAtCentre };
  const { x, y } = wormhole;
  const unmoved = near(Math.hypot(x, y), radius) && angleGap(saveAngle(0, 0, x, y), angle) < SAME;
  if (unmoved) return null;
  return { op: { type: "MoveWormhole", wormhole: id, radius, angle: wrapDegrees(angle) } };
}

/** The class of body `id`, as the details give it. */
function classOfBody(frame: GeometryFrame, id: number): string | undefined {
  return frame.details?.planets.find((p) => p.id === id)?.class;
}

/** `span` as one value: itself, or a range that holds only one; null for a range of more. */
function fixedValue(span: Span): number | null {
  if (typeof span === "number") return span;
  return isFixed(span) ? span.min : null;
}

function isFixed(bounds: Bounds): boolean {
  return bounds.min === bounds.max;
}

/** `intent` with each radius and angle one value, or null when one is a range of more. */
function fixedIntent(intent: GeometryIntent): FixedIntent | null {
  if (intent.kind !== "move" && intent.kind !== "reparent") return intent;
  const radius = fixedValue(intent.radius);
  const angle = fixedValue(intent.angle);
  return radius === null || angle === null ? null : { ...intent, radius, angle };
}

/** Whether every radius and angle `intent` names is a number. */
function finite(intent: FixedIntent): boolean {
  const values = ["radius" in intent ? intent.radius : 0, "angle" in intent ? intent.angle : 0];
  return values.every(Number.isFinite);
}

function saveOp(asked: GeometryIntent, frame: GeometryFrame): GeometryOp {
  const intent = fixedIntent(asked);
  if (intent === null) return { refused: GEOMETRY_REASONS.range };
  if (!finite(intent)) return { refused: GEOMETRY_REASONS.notANumber };
  const { layout } = frame;
  switch (intent.kind) {
    case "move": {
      const body = layout.bodies.find((b) => b.id === intent.body);
      if (!body) return { refused: GEOMETRY_REASONS.elsewhere };
      if (body.star && atCentre(body)) return { refused: GEOMETRY_REASONS.star };
      if (isRingSegment(classOfBody(frame, body.id), frame.planetClasses)) {
        return { refused: GEOMETRY_REASONS.ringworld };
      }
      return moveOp(intent.system, body, intent.radius, intent.angle);
    }
    case "reparent":
      return reparentOp(intent, frame);
    case "addBelt":
      return {
        op: {
          type: "AddBelt",
          system: intent.system,
          kind: intent.beltKind,
          radius: intent.radius,
        },
      };
    case "setBeltRadius":
      return beltRadiusOp(intent, frame);
    case "setBeltKind": {
      const belt = layout.belts[intent.index];
      if (!belt || belt.kind === intent.beltKind) return null;
      const { system, index, beltKind: kind } = intent;
      return { op: { type: "SetBeltKind", system, index, kind } };
    }
    case "removeBelt": {
      if (!layout.belts[intent.index]) return null;
      return { op: { type: "RemoveBelt", system: intent.system, index: intent.index } };
    }
    case "innerRadius": {
      if (near(layout.innerRadius, intent.radius)) return null;
      const least = innerFloorOf(frame);
      if (intent.radius < least) return { refused: innerTooSmall(least) };
      return { op: { type: "SetInnerRadius", system: intent.system, radius: intent.radius } };
    }
    case "moveWormhole":
      return wormholeOp(intent, frame);
  }
}

/** A save's geometry: its bodies, belts and inner radius, edited by the save's own ops. */
export const SAVE_GEOMETRY: GeometryAdapter = {
  ranges: false,
  editing: layoutEditing,
  preview: layoutPreview,
  op: saveOp,
};

/** The adapter each kind of document edits its geometry with, where its capabilities allow. */
const GEOMETRY_ADAPTERS: Readonly<Record<DocumentKind, GeometryAdapter>> = {
  save: SAVE_GEOMETRY,
  scenario: NO_GEOMETRY,
};

/**
 * The adapter that edits system `system`'s geometry in a document of `kind` that supports
 * `capabilities`: the one place a source is chosen. Before a document reports its kind, a save's,
 * as `documentCapabilities` assumes. Without the geometry capability or a system there is nothing
 * to edit.
 */
export function geometryAdapterFor(
  kind: DocumentKind | null,
  capabilities: Capabilities,
  system: number | null,
): GeometryAdapter {
  if (!capabilities.geometry || system === null) return NO_GEOMETRY;
  return GEOMETRY_ADAPTERS[kind ?? "save"];
}
