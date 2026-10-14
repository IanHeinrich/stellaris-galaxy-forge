import type { Capabilities } from "../generated/Capabilities";
import type { DocumentKind } from "../generated/DocumentKind";
import type { SystemNode } from "../generated/SystemNode";
import { documentCapabilities, supports } from "../lib/capabilities";
import type { Symmetry } from "../lib/geometry/symmetry";
import { mapExtent } from "../lib/guides";
import { PlacementGround } from "../lib/placement/ground";
import { shapePlacement } from "../lib/shapes/placement";
import type { PendingShape, ShapeGround, ShapePreview } from "../lib/shapes/types";
import type { SpatialGrid } from "../lib/spatialGrid";
import { toolRequires } from "../lib/tools";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useMapChromeStore } from "./mapChromeStore";
import { useToolStore } from "./toolStore";

/** Everything a shape's preview reads, each compared by identity. */
interface Inputs {
  pending: PendingShape | null;
  systems: ReadonlyMap<number, SystemNode>;
  grid: SpatialGrid | null;
  radius: number;
  symmetry: Symmetry;
  laneDensity: number;
  capabilities: Capabilities | null;
  kind: DocumentKind | null;
}

function inputsNow(): Inputs {
  const galaxy = useGalaxyStore.getState();
  const tools = useToolStore.getState();
  const session = useFileSessionStore.getState();
  return {
    pending: tools.pendingShape,
    systems: galaxy.systems,
    grid: galaxy.grid,
    radius: galaxy.galaxy?.galaxy_radius ?? 0,
    symmetry: tools.symmetry,
    laneDensity: useMapChromeStore.getState().laneDensity,
    capabilities: session.capabilities,
    kind: session.kind,
  };
}

/** The last `PlacementGround` built, kept while the galaxy and the symmetry stay the same objects. */
let placed: PlacementGround | null = null;

/** The galaxy to place into, built again only when the systems, the grid or the symmetry change. */
function placementGround(
  systems: Inputs["systems"],
  grid: SpatialGrid,
  symmetry: Symmetry,
): PlacementGround {
  if (placed?.systems !== systems || placed.grid !== grid || placed.symmetry !== symmetry) {
    placed = new PlacementGround(systems, grid, symmetry);
  }
  return placed;
}

function groundOf(inputs: Inputs): ShapeGround | null {
  const { grid, kind, radius, capabilities } = inputs;
  if (grid === null || !supports(documentCapabilities({ capabilities }), toolRequires("shape"))) {
    return null;
  }
  const extent = mapExtent(kind, radius);
  if (extent === null) return null;
  return {
    placement: placementGround(inputs.systems, grid, inputs.symmetry),
    extent,
    laneDensity: inputs.laneDensity,
  };
}

/** The galaxy a shape is placed into as it stands now; null when the open document takes no shapes. */
export function shapeGround(): ShapeGround | null {
  return groundOf(inputsNow());
}

let cached: { inputs: Inputs; preview: ShapePreview | null } | null = null;

function sameInputs(a: Inputs, b: Inputs): boolean {
  return (Object.keys(a) as Array<keyof Inputs>).every((key) => a[key] === b[key]);
}

function previewOf(inputs: Inputs): ShapePreview | null {
  if (cached && sameInputs(cached.inputs, inputs)) return cached.preview;
  const ground = inputs.pending && groundOf(inputs);
  const preview = inputs.pending && ground ? shapePlacement(inputs.pending, ground) : null;
  cached = { inputs, preview };
  return preview;
}

/**
 * What placing the pending shape would add to the galaxy as it stands; null with no pending
 * shape. Cached on the identity of its inputs, so the map and the panels share one result.
 */
export function shapePreview(): ShapePreview | null {
  return previewOf(inputsNow());
}

/** `shapePreview()`, read by a component that redraws when it changes. */
export function useShapePreview(): ShapePreview | null {
  return previewOf({
    pending: useToolStore((s) => s.pendingShape),
    systems: useGalaxyStore((s) => s.systems),
    grid: useGalaxyStore((s) => s.grid),
    radius: useGalaxyStore((s) => s.galaxy?.galaxy_radius ?? 0),
    symmetry: useToolStore((s) => s.symmetry),
    laneDensity: useMapChromeStore((s) => s.laneDensity),
    capabilities: useFileSessionStore((s) => s.capabilities),
    kind: useFileSessionStore((s) => s.kind),
  });
}
