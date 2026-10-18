import type { Op } from "../generated/Op";
import type { SystemMove } from "../generated/SystemMove";
import { rotateAbout, selectionCentroid } from "./geometry/rotate";
import { type Pt, writtenPt } from "./geometry/pt";

/** What a rotation reads of the editor: the selection, the pivot it was given and the nebulae toggle. */
export interface RotationState {
  selection: readonly number[];
  /** The point the player dragged the pivot to; null turns the selection about its centroid. */
  rotatePivot: Pt | null;
  rotateNebulae: boolean;
}

/** What a rotation reads of the galaxy. */
export interface RotationGalaxy {
  systems: ReadonlyMap<number, Pt>;
}

/** Where a rotation puts the selected systems, as the file will hold them. */
export interface RotationPreview {
  pivot: Pt;
  systems: SystemMove[];
}

/** The point the selection turns about: the pivot the player placed, else the selection's centroid. */
export function rotationPivot(
  state: Pick<RotationState, "selection" | "rotatePivot">,
  systems: ReadonlyMap<number, Pt>,
): Pt | null {
  return state.rotatePivot ?? selectionCentroid(systems, state.selection);
}

/**
 * Where turning the selection by `degrees` puts its systems, rounded as the file writes them, for
 * the map's ghosts. Null for fewer than two systems or a whole number of turns.
 */
export function rotationPreview(
  state: RotationState,
  galaxy: RotationGalaxy,
  degrees: number,
): RotationPreview | null {
  if (!Number.isFinite(degrees) || degrees % 360 === 0) return null;
  const selected = state.selection.flatMap((id) => {
    const s = galaxy.systems.get(id);
    return s ? [{ id, at: s }] : [];
  });
  if (selected.length < 2) return null;
  const pivot = rotationPivot(state, galaxy.systems);
  if (pivot === null) return null;
  const systems = selected.map(({ id, at }) => ({
    system: id,
    ...writtenPt(rotateAbout(at, pivot, degrees)),
  }));
  return { pivot, systems };
}

/** The Rotate section's quarter and half turns, clockwise as the map shows it. */
export const ROTATE_TURNS = [
  { label: "90° left", degrees: -90 },
  { label: "90° right", degrees: 90 },
  { label: "180°", degrees: 180 },
] as const;

/**
 * The core's `RotateSystems` for the selected systems, turned about the pivot. The core rounds the
 * result as `rotationPreview` does and names the edit. Null for fewer than two systems or a whole
 * number of turns, so nothing is sent for a no-op.
 */
export function rotationOp(
  state: RotationState,
  galaxy: RotationGalaxy,
  degrees: number,
): Op | null {
  if (!Number.isFinite(degrees) || degrees % 360 === 0) return null;
  const systems = state.selection.filter((id) => galaxy.systems.has(id));
  if (systems.length < 2) return null;
  const pivot = rotationPivot(state, galaxy.systems);
  if (pivot === null) return null;
  return {
    type: "RotateSystems",
    systems,
    pivot: [pivot.x, pivot.y],
    degrees,
    nebulae: state.rotateNebulae,
  };
}
