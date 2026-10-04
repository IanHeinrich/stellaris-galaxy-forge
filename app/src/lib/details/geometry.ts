import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemRadii } from "../../generated/SystemRadii";
import type { SystemRoll } from "../../generated/SystemRoll";
import type { GeometryAdapter, GeometryFrame, SceneEditing } from "./orbitIntent";
import { systemLayout, type SystemLayout } from "./orbits";

/** A system's geometry as the scene, the panels and the nudge read it. */
export interface SystemGeometry {
  /** The layout the scene draws, the same object its context holds. */
  layout: SystemLayout;
  editing: SceneEditing;
  adapter: GeometryAdapter;
  frame: GeometryFrame;
}

/** What a system's geometry is worked out from. */
export interface GeometryInputs {
  details: SystemDetails | null;
  roll: SystemRoll | null;
  planetClasses: ReadonlyMap<string, PlanetClassView>;
  moonScale: number;
  radii: SystemRadii;
  /** The adapter that edits it. */
  adapter: GeometryAdapter;
}

/**
 * Each layout's editing, per adapter and radii: the same layout, adapter and radii give the same
 * object.
 */
const edited = new WeakMap<SystemLayout, Map<GeometryAdapter, Map<SystemRadii, SceneEditing>>>();

/** The layout `inputs` give, what of it their adapter lets be edited, and the frame it edits in. */
export function geometryOf(inputs: GeometryInputs): SystemGeometry {
  const { details, roll, planetClasses, moonScale, radii, adapter } = inputs;
  const layout = systemLayout(details, roll, planetClasses, moonScale);
  const frame = { layout, details, planetClasses, radii };
  let byAdapter = edited.get(layout);
  if (!byAdapter) edited.set(layout, (byAdapter = new Map()));
  let byRadii = byAdapter.get(adapter);
  if (!byRadii) byAdapter.set(adapter, (byRadii = new Map()));
  let editing = byRadii.get(radii);
  if (!editing) byRadii.set(radii, (editing = adapter.editing(frame)));
  return { layout, editing, adapter, frame };
}
