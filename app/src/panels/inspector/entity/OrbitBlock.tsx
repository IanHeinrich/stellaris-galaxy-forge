import { MOON_RING_FIRST } from "../../../generated/constants";
import { bodyName } from "../../../lib/details/labels";
import { bodyOrbit, fieldIntent, GEOMETRY_REASONS } from "../../../lib/details/orbitIntent";
import { orbitParent } from "../../../lib/details/orbitReach";
import { NO_GEOMETRY } from "../../../lib/details/saveGeometry";
import { wrapDegrees, type BodyPlacement, type Point } from "../../../lib/details/orbits";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useState } from "react";
import type { GeometryIntent } from "../../../lib/details/orbitIntent";
import {
  applyGeometryFrom,
  useSystemGeometry,
  type SystemGeometry,
} from "../../../store/systemGeometry";
import { EditBlock, EditNote, EditRow, PickerField, TextField } from "../../EditField";
import type { IconPickerItem } from "../../IconPicker";
import { Empty } from "../parts";

const READING = "Reading the system…";
const THE_STAR = "star";
const ORIGIN: Point = { x: 0, y: 0 };

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Where `body` stands about `centre`, as a radius and an angle in `polar`'s degrees. */
function about(body: Point, centre: Point): { radius: number; angle: number } {
  const dx = body.x - centre.x;
  const dy = body.y - centre.y;
  return { radius: Math.hypot(dx, dy), angle: wrapDegrees((Math.atan2(dy, dx) * 180) / Math.PI) };
}

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
      return { kind: "reparent", system, body, parent: null, ...about(self, ORIGIN) };
    }
    const host = Number(key);
    const { angle } = about(self, placed.get(host) ?? ORIGIN);
    const radius = editing.bodies.get(host)?.moonRing ?? MOON_RING_FIRST;
    return { kind: "reparent", system, body, parent: host, radius, angle };
  };
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
  const names = useGameDataStore((s) => s.names);
  const { layout, editing, frame } = geometry;
  const own = editing.bodies.get(body.id);
  const nameOf = (id: number) => {
    const planet = frame.details?.planets.find((p) => p.id === id);
    return planet ? bodyName(planet, names) : `#${id}`;
  };
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
  const names = useGameDataStore((s) => s.names);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { layout, editing, frame, adapter } = geometry;
  if (frame.details === null) {
    return adapter === NO_GEOMETRY || failed ? null : <Empty>{READING}</Empty>;
  }
  const orbit = bodyOrbit(layout, body);
  const own = editing.bodies.get(body);
  const placed = layout.bodies.find((b) => b.id === body);
  const moves = orbit !== null && own?.move === true;
  if (placed === undefined || !own || !(moves || own.detachOnly)) return null;
  const send = (build: Build) => {
    setRefusal(null);
    void applyGeometryFrom(system, build, setRefusal);
  };
  const commit = (field: "radius" | "angle", typed: number) =>
    send(({ layout: now }) => {
      const from = bodyOrbit(now, body);
      const to = from && fieldIntent(from, field, typed);
      return to && { kind: "move", system, body, radius: to.radius, angle: to.angle };
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
        <>
          <EditRow label="Orbit radius">
            <TextField
              kind="number"
              label="Orbit radius"
              title="How far it stands from what it orbits"
              value={rounded(orbit.radius)}
              onCommit={(typed) => commit("radius", typed)}
            />
          </EditRow>
          <EditRow label="Angle">
            <TextField
              kind="number"
              label="Angle"
              title="Where it stands on its orbit, in degrees"
              value={rounded(orbit.angle)}
              display={String(Math.round(orbit.angle) % 360)}
              onCommit={(typed) => commit("angle", typed)}
            />
          </EditRow>
        </>
      )}
      {own.detachOnly && <EditNote>{GEOMETRY_REASONS.noOrbit}</EditNote>}
      {hostPlanet && <EditNote>Measured from {bodyName(hostPlanet, names)}</EditNote>}
      {refusal !== null && (
        <EditNote>
          <span className="warn">{refusal}</span>
        </EditNote>
      )}
    </EditBlock>
  );
}
