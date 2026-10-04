import type { Bounds } from "../../../generated/Bounds";
import { MOON_RING_FIRST } from "../../../generated/constants";
import {
  bodyOrbit,
  fieldIntent,
  GEOMETRY_REASONS,
  type BodyOrbit,
  type GeometryIntent,
  type Span,
} from "../../../lib/details/orbitIntent";
import { orbitParent } from "../../../lib/details/orbitReach";
import { NO_GEOMETRY } from "../../../lib/details/saveGeometry";
import { polarAbout, type BodyPlacement, type Point } from "../../../lib/details/orbits";
import { useDetailsStore } from "../../../store/detailsStore";
import { useSystemGeometry, type SystemGeometry } from "../../../store/systemGeometry";
import { EditBlock, EditNote, EditRow, PickerField } from "../../EditField";
import type { IconPickerItem } from "../../IconPicker";
import { Empty } from "../parts";
import { RadiusAngleFields } from "../RadiusAngleFields";
import { useGeometryEdit } from "../useGeometryEdit";
import { useSystemBodyNamer } from "./useBodyName";

const READING = "Reading the system…";
const THE_STAR = "star";
const ORIGIN: Point = { x: 0, y: 0 };

/** Builds an intent from the system's geometry as it stands when the edit runs. */
type Build = (geometry: SystemGeometry) => GeometryIntent | null;

/**
 * The reparent picking `key` makes of `body`: onto the next moon ring of a host, or the next orbit
 * of a star off the centre, at its angle about it; or about the centre where it stands.
 */
function reparentTo(key: string, system: number, body: number): Build {
  return ({ layout, editing }) => {
    const placed = new Map(layout.bodies.map((b) => [b.id, b]));
    const self = placed.get(body);
    if (!self) return null;
    if (key === THE_STAR) {
      return { kind: "reparent", system, body, parent: null, ...polarAbout(self, ORIGIN) };
    }
    const host = Number(key);
    const { angle } = polarAbout(self, placed.get(host) ?? ORIGIN);
    const radius = editing.bodies.get(host)?.moonRing ?? MOON_RING_FIRST;
    return { kind: "reparent", system, body, parent: host, radius, angle };
  };
}

/**
 * The move that typing `typed` into the radius or angle field of an orbit asks for; a range
 * where the two ends differ.
 */
function movedTo(
  from: BodyOrbit,
  field: "radius" | "angle",
  typed: Bounds,
): { radius: Span; angle: Span } | null {
  const low = fieldIntent(from, field, typed.min);
  const high = fieldIntent(from, field, typed.max);
  if (!low || !high) return null;
  const span = (key: "radius" | "angle") =>
    low[key] === high[key] ? low[key] : { min: low[key], max: high[key] };
  return { radius: span("radius"), angle: span("angle") };
}

/**
 * What a body orbits, as a field: the star at the centre, a star off it, or, for a body with no
 * moons of its own, one of the system's planets that can have moons. Nothing when the star it
 * orbits is all there is to pick.
 */
function OrbitsField({
  system,
  body,
  geometry,
  send,
}: {
  system: number;
  body: BodyPlacement;
  geometry: SystemGeometry;
  send: (build: Build) => void;
}) {
  const named = useSystemBodyNamer(system);
  const nameOf = (id: number) => named(id) ?? `#${id}`;
  const { layout, editing, frame } = geometry;
  const own = editing.bodies.get(body.id);
  const hosts = own?.detachOnly
    ? []
    : layout.bodies.filter(
        (b) => b.id !== body.id && editing.bodies.get(b.id)?.host && (b.star || own?.asMoon),
      );
  const byKind = [...hosts.filter((b) => b.star), ...hosts.filter((b) => !b.star)];
  const star: IconPickerItem = { key: THE_STAR, label: "The star" };
  const items = [star, ...byKind.map((b) => ({ key: String(b.id), label: nameOf(b.id) }))];
  // A moon whose planet is missing is drawn with no parent, but the details still name its planet.
  const parent =
    body.moon && body.parent === null
      ? (frame.details?.planets.find((p) => p.id === body.id)?.parent ?? null)
      : orbitParent(layout, body);
  const current = parent !== null ? { key: String(parent), label: nameOf(parent) } : star;
  const pick = (key: string) => {
    if (key !== current.key) send(reparentTo(key, system, body.id));
  };
  if (items.length === 1 && current === star) return null;
  return (
    <EditRow label="Orbits">
      <PickerField
        label="Orbits"
        title="Make it a planet of a star, or a moon of another planet"
        current={current}
        items={items}
        onPick={pick}
      />
    </EditRow>
  );
}

/**
 * Where a body stands in its system, as fields: what it orbits, its orbit radius and its angle.
 * Shown only for a body its system lets move, once the system's details are read; a moon whose
 * planet is missing gets only what it orbits.
 */
export function OrbitBlock({ system, body }: { system: number; body: number }) {
  const geometry = useSystemGeometry(system);
  const failed = useDetailsStore((s) => s.failed.has(system));
  const nameOf = useSystemBodyNamer(system);
  const { send, note } = useGeometryEdit(system);
  const { layout, editing, frame, adapter } = geometry;
  if (frame.details === null) {
    return adapter === NO_GEOMETRY || failed ? null : <Empty>{READING}</Empty>;
  }
  const orbit = bodyOrbit(layout, body);
  const own = editing.bodies.get(body);
  const placed = layout.bodies.find((b) => b.id === body);
  const moves = orbit !== null && own?.move === true;
  if (placed === undefined || !own || !(moves || own.detachOnly)) return null;
  const commit = (field: "radius" | "angle", typed: Bounds) =>
    send(({ layout: now }) => {
      const from = bodyOrbit(now, body);
      const to = from && movedTo(from, field, typed);
      return to && { kind: "move", system, body, ...to };
    });
  const measuredFrom = orbit !== null ? orbitParent(layout, placed) : null;
  const hostPlanet =
    measuredFrom !== null ? frame.details.planets.find((p) => p.id === measuredFrom) : undefined;
  return (
    <EditBlock title="Orbit">
      {own.reparent && (
        <OrbitsField system={system} body={placed} geometry={geometry} send={send} />
      )}
      {moves && (
        <RadiusAngleFields
          radius={orbit.radius}
          angle={orbit.angle}
          radiusLabel="Orbit radius"
          radiusTitle="How far it stands from what it orbits"
          angleTitle="Where it stands on its orbit, in degrees"
          ranges={adapter.ranges}
          onCommit={commit}
        />
      )}
      {own.detachOnly && <EditNote>{GEOMETRY_REASONS.noOrbit}</EditNote>}
      {hostPlanet && <EditNote>Measured from {nameOf(hostPlanet.id)}</EditNote>}
      {note()}
    </EditBlock>
  );
}
