import type { Capabilities } from "../generated/Capabilities";
import type { SystemNode } from "../generated/SystemNode";
import type { Symmetry } from "../lib/geometry/symmetry";
import { reachOf } from "../lib/guides";
import { needsGameData } from "../lib/text";
import { groundFor } from "../lib/placement/ground";
import { arrangement } from "../lib/shapes/arrange";
import { shapePlacement } from "../lib/shapes/placement";
import { PLACEMENT_RULES, shapePath, type PlacementPath } from "../lib/placement/rules";
import { starWeights } from "../lib/shapes/stars";
import type { PendingShape, ShapeGround, ShapePreview } from "../lib/shapes/types";
import type { SpatialGrid } from "../lib/spatialGrid";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGeneratorStore, type GeneratorStarClass } from "./generatorStore";
import { useMapChromeStore } from "./mapChromeStore";
import { useToolStore } from "./toolStore";

/** Why a shape cannot be rolled into a save without the generator's star classes. */
export const SHAPE_NEEDS_GAME_DATA = needsGameData("place a shape in a save");

/** Why a shape cannot be rolled when none of the stars it may take can be rolled. */
export const SHAPE_NO_STARS = "None of the ticked stars can be rolled. Tick another.";

/**
 * Why `preview` cannot be placed on `path`, or null when it can: an arrange as it says, and a
 * save's shape needs a star class rolled for every point.
 */
export function shapeRefusal(preview: ShapePreview, path: PlacementPath | null): string | null {
  if (preview.arranged) return preview.arranged.refusal;
  if (path !== "rolled") return null;
  if (preview.classes === null) return SHAPE_NEEDS_GAME_DATA;
  return preview.classes.length < preview.points.length ? SHAPE_NO_STARS : null;
}

/** Everything a shape's preview reads, each compared by identity. */
interface Inputs {
  pending: PendingShape | null;
  systems: ReadonlyMap<number, SystemNode>;
  grid: SpatialGrid | null;
  radius: number;
  symmetry: Symmetry;
  laneDensity: number;
  capabilities: Capabilities | null;
  /** The generator's star classes, which a save's shape rolls its stars among; null until read. */
  starClasses: readonly GeneratorStarClass[] | null;
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
    starClasses: useGeneratorStore.getState().starClasses,
  };
}

function groundOf(inputs: Inputs, pending: PendingShape): ShapeGround | null {
  const { grid, radius, starClasses } = inputs;
  const path = shapePath(inputs.capabilities);
  if (grid === null || path === null) return null;
  const rules = PLACEMENT_RULES[path];
  const extent = reachOf(rules.edge, radius);
  if (extent === null) return null;
  return {
    placement: groundFor(inputs.systems, grid, inputs.symmetry),
    extent,
    laneDensity: inputs.laneDensity,
    rules,
    starWeights:
      path === "rolled" && starClasses !== null ? starWeights(pending.stars, starClasses) : null,
  };
}

/** The galaxy `pending` is placed into as it stands now; null when the open document takes no shapes. */
export function shapeGround(pending: PendingShape): ShapeGround | null {
  return groundOf(inputsNow(), pending);
}

/** What placing `pending` would do to the galaxy as it stands now, worked out afresh; null when the document takes no shapes. */
export function placementNow(pending: PendingShape): ShapePreview | null {
  return placementOf(inputsNow(), pending);
}

let cached: { inputs: Inputs; preview: ShapePreview | null } | null = null;

function sameInputs(a: Inputs, b: Inputs): boolean {
  return (Object.keys(a) as Array<keyof Inputs>).every((key) => a[key] === b[key]);
}

/** What placing `pending` does to the galaxy `inputs` read: the systems it adds or the arrange it makes. */
function placementOf(inputs: Inputs, pending: PendingShape): ShapePreview | null {
  const ground = groundOf(inputs, pending);
  if (ground === null) return null;
  if (pending.purpose.kind === "add") return shapePlacement(pending, ground);
  return arrangement(
    { ...pending, purpose: pending.purpose },
    {
      systems: inputs.systems,
      extent: ground.extent,
      rules: ground.rules,
      symmetry: inputs.symmetry,
      laneDensity: inputs.laneDensity,
    },
  );
}

function previewOf(inputs: Inputs): ShapePreview | null {
  if (cached && sameInputs(cached.inputs, inputs)) return cached.preview;
  const preview = inputs.pending && placementOf(inputs, inputs.pending);
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
    starClasses: useGeneratorStore((s) => s.starClasses),
  });
}
