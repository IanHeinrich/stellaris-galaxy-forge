/**
 * A system's geometry as the scene, the panels and the nudge read it, and the one way an intent to
 * change it reaches the editor.
 */
import type { SystemDetails } from "../generated/SystemDetails";
import { documentCapabilities } from "../lib/capabilities";
import { geometryOf, type SystemGeometry } from "../lib/details/geometry";
import { bodyOrbit, inspectedBody, nudged, type GeometryIntent } from "../lib/details/orbitIntent";
import { geometryAdapterFor } from "../lib/details/saveGeometry";
import { shownRoll, useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { systemLabelOf } from "./galaxyStore";
import { moonScaleOf, systemRadiiOf, useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { useMapChromeStore } from "./mapChromeStore";
import { sceneSystem } from "./sceneStore";

export type { SystemGeometry };

/** System `system`'s layout, what of it may be edited, and the adapter that edits it. */
export function systemGeometry(system: number | null): SystemGeometry {
  const details = useDetailsStore.getState();
  const data = useGameDataStore.getState();
  const session = useFileSessionStore.getState();
  return geometryOf({
    details: system === null ? null : (details.details.get(system) ?? null),
    roll: shownRoll(details.rolls, system),
    planetClasses: data.planetClasses,
    moonScale: moonScaleOf(data),
    radii: systemRadiiOf(data),
    adapter: geometryAdapterFor(session.kind, documentCapabilities(session), system),
  });
}

/** `systemGeometry` as a panel reads it, following the stores. */
export function useSystemGeometry(system: number | null): SystemGeometry {
  const details = useDetailsStore((s) =>
    system === null ? null : (s.details.get(system) ?? null),
  );
  const roll = useDetailsStore((s) => shownRoll(s.rolls, system));
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const moonScale = useGameDataStore(moonScaleOf);
  const radii = useGameDataStore(systemRadiiOf);
  const kind = useFileSessionStore((s) => s.kind);
  const capabilities = useFileSessionStore(documentCapabilities);
  const adapter = geometryAdapterFor(kind, capabilities, system);
  return geometryOf({ details, roll, planetClasses, moonScale, radii, adapter });
}

/** How long an edit waits for its system's fresh details before the next one builds anyway. */
const REFRESH_WAIT_MS = 3000;

/** Says why an intent was refused. */
export type RefusalSink = (reason: string) => void;

const inSceneHint: RefusalSink = (reason) => useMapChromeStore.getState().setSceneHint(reason);

/** The geometry edits in the order they were asked for, each after the last has settled. */
let queue: Promise<unknown> = Promise.resolve();

function serialised(run: () => Promise<boolean>): Promise<boolean> {
  const next = queue.then(run);
  queue = next.catch(() => false);
  return next;
}

/**
 * Resolves once system `system`'s details are no longer `read`, or once none are on their way.
 * It gives up after `REFRESH_WAIT_MS`, so a lost answer holds nothing up for long.
 */
function detailsAfter(system: number, read: SystemDetails | null): Promise<void> {
  return new Promise((resolve) => {
    const settled = () => {
      const s = useDetailsStore.getState();
      return s.details.get(system) !== read || !s.pending.has(system);
    };
    let unsubscribe = () => {};
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, REFRESH_WAIT_MS);
    useDetailsStore.getState().request([system]);
    if (settled()) {
      done();
      return;
    }
    unsubscribe = useDetailsStore.subscribe(() => {
      if (settled()) done();
    });
  });
}

/**
 * Builds the intent from system `system`'s geometry as it stands when the edits before it have
 * landed, and sends the op it makes. After an applied op it waits for the system's fresh details,
 * so the next edit builds on what this one did.
 */
async function applyBuilt(
  system: number,
  build: (geometry: SystemGeometry) => GeometryIntent | null,
  onRefused: RefusalSink,
): Promise<boolean> {
  const geometry = systemGeometry(system);
  const intent = build(geometry);
  if (intent === null) return false;
  const made = geometry.adapter.op(intent, {
    ...geometry.frame,
    systemLabel: systemLabelOf(system),
  });
  if (made === null) return false;
  if ("refused" in made) {
    onRefused(made.refused);
    return false;
  }
  const applied = await useEditorStore.getState().applyOp(made.op);
  if (applied) await detailsAfter(system, geometry.frame.details);
  return applied;
}

/**
 * Sends the op `build` makes of system `system`'s geometry, read once the geometry edits asked for
 * before it have landed. Resolves as `applyGeometry` does.
 */
export function applyGeometryFrom(
  system: number,
  build: (geometry: SystemGeometry) => GeometryIntent | null,
  onRefused: RefusalSink = inSceneHint,
): Promise<boolean> {
  return serialised(() => applyBuilt(system, build, onRefused));
}

/**
 * Sends the op `intent` makes, after the geometry edits asked for before it. Resolves true when it
 * applied; a refusal goes to `onRefused` (the status bar unless a caller says it itself), and it,
 * an intent that changes nothing and an op the editor refuses all resolve false.
 */
export function applyGeometry(
  intent: GeometryIntent,
  onRefused: RefusalSink = inSceneHint,
): Promise<boolean> {
  return applyGeometryFrom(intent.system, () => intent, onRefused);
}

/**
 * Turns the body the inspector shows in the system on screen `turn` degrees and steps it `out`
 * units, one op per press, each from where the press before left it. Resolves false when there is
 * no such body or it cannot move.
 */
export async function nudgeBody(step: { turn: number; out: number }): Promise<boolean> {
  const system = sceneSystem();
  if (system === null) return false;
  const stack = useInspectorStore.getState().stack;
  const ref = stack[stack.length - 1].ref;
  let moved = false;
  const applied = await applyGeometryFrom(system, ({ layout, editing }) => {
    const body = inspectedBody(layout, system, ref);
    if (body === null || !editing.bodies.get(body)?.move) return null;
    const orbit = bodyOrbit(layout, body);
    if (orbit === null) return null;
    moved = true;
    const { radius, angle } = nudged(orbit, step);
    return { kind: "move", system, body, radius, angle };
  });
  return applied && moved;
}
