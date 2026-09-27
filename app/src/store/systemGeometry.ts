/**
 * A system's geometry as the scene, the panels and the nudge read it, and the one way an intent to
 * change it reaches the editor.
 */
import type { Capabilities } from "../generated/Capabilities";
import type { PlanetClassView } from "../generated/PlanetClassView";
import type { SystemDetails } from "../generated/SystemDetails";
import type { SystemRoll } from "../generated/SystemRoll";
import { documentCapabilities } from "../lib/capabilities";
import {
  bodyOrbit,
  geometryAdapterFor,
  inspectedBody,
  nudged,
  type GeometryAdapter,
  type GeometryFrame,
  type GeometryIntent,
  type SceneEditing,
} from "../lib/details/orbitEdits";
import { systemLayout, type SystemLayout } from "../lib/details/orbits";
import { shownRoll, useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { moonScaleOf, useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { useMapChromeStore } from "./mapChromeStore";
import { sceneSystem } from "./sceneStore";

export interface SystemGeometry {
  /** The layout the scene draws, the same object its context holds. */
  layout: SystemLayout;
  editing: SceneEditing;
  adapter: GeometryAdapter;
  frame: GeometryFrame;
}

interface Inputs {
  system: number | null;
  details: SystemDetails | null;
  roll: SystemRoll | null;
  planetClasses: ReadonlyMap<string, PlanetClassView>;
  moonScale: number;
  capabilities: Capabilities;
}

/** Each layout's editing, per adapter: the same layout and adapter give the same object. */
const edited = new WeakMap<SystemLayout, Map<GeometryAdapter, SceneEditing>>();

function geometryOf(inputs: Inputs): SystemGeometry {
  const { system, details, roll, planetClasses, moonScale, capabilities } = inputs;
  const layout = systemLayout(details, roll, planetClasses, moonScale);
  const adapter = geometryAdapterFor(capabilities, system);
  const frame = { layout, details, planetClasses };
  let byAdapter = edited.get(layout);
  if (!byAdapter) edited.set(layout, (byAdapter = new Map()));
  let editing = byAdapter.get(adapter);
  if (!editing) byAdapter.set(adapter, (editing = adapter.editing(frame)));
  return { layout, editing, adapter, frame };
}

/** System `system`'s layout, what of it may be edited, and the adapter that edits it. */
export function systemGeometry(system: number | null): SystemGeometry {
  const details = useDetailsStore.getState();
  const data = useGameDataStore.getState();
  return geometryOf({
    system,
    details: system === null ? null : (details.details.get(system) ?? null),
    roll: shownRoll(details.rolls, system),
    planetClasses: data.planetClasses,
    moonScale: moonScaleOf(data),
    capabilities: documentCapabilities(useFileSessionStore.getState()),
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
  const capabilities = useFileSessionStore(documentCapabilities);
  return geometryOf({ system, details, roll, planetClasses, moonScale, capabilities });
}

/**
 * Sends the op `intent` makes. Resolves true when it applied; a refusal is said in the status bar,
 * and it, an intent that changes nothing and an op the editor refuses all resolve false.
 */
export async function applyGeometry(intent: GeometryIntent): Promise<boolean> {
  const { adapter, frame } = systemGeometry(intent.system);
  const made = adapter.op(intent, frame);
  if (made === null) return false;
  if ("refused" in made) {
    useMapChromeStore.getState().setSceneHint(made.refused);
    return false;
  }
  return useEditorStore.getState().applyOp(made.op);
}

/**
 * Turns the body the inspector shows in the system on screen `turn` degrees and steps it `out`
 * units, one op per press. Resolves false when there is no such body or it cannot move.
 */
export async function nudgeBody(step: { turn: number; out: number }): Promise<boolean> {
  const system = sceneSystem();
  if (system === null) return false;
  const { layout, editing } = systemGeometry(system);
  const stack = useInspectorStore.getState().stack;
  const body = inspectedBody(layout, system, stack[stack.length - 1].ref);
  if (body === null || !editing.bodies.get(body)?.move) return false;
  const orbit = bodyOrbit(layout, body);
  if (orbit === null) return false;
  const { radius, angle } = nudged(orbit, step);
  return applyGeometry({ kind: "move", system, body, radius, angle });
}
