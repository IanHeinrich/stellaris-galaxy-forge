import type { Op } from "../generated/Op";
import type { SystemMove } from "../generated/SystemMove";
import { convexHull, inConvexHull, rotateAbout, selectionCentroid } from "./geometry/rotate";
import { type Pt, writtenPt } from "./geometry/pt";
import { counted } from "./text";

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
  /** In file order, which is each nebula's index. */
  nebulae: readonly Pt[];
}

export interface NebulaMove {
  index: number;
  x: number;
  y: number;
}

/** Where a rotation puts everything it moves, as the file will hold it. */
export interface RotationPreview {
  pivot: Pt;
  systems: SystemMove[];
  nebulae: NebulaMove[];
}

/** The point the selection turns about: the pivot the player placed, else the selection's centroid. */
export function rotationPivot(
  state: Pick<RotationState, "selection" | "rotatePivot">,
  systems: ReadonlyMap<number, Pt>,
): Pt | null {
  return state.rotatePivot ?? selectionCentroid(systems, state.selection);
}

/**
 * Where turning the selection by `degrees` puts its systems and, with `rotateNebulae`, each
 * nebula whose centre lies in their hull, rounded as the file writes them. The map's preview and
 * `rotationOp` both read it, so the drag shows what lands. Null for fewer than two systems or a
 * whole number of turns.
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
  const turned = (p: Pt) => writtenPt(rotateAbout(p, pivot, degrees));
  const systems = selected.map(({ id, at }) => ({ system: id, ...turned(at) }));
  if (!state.rotateNebulae) return { pivot, systems, nebulae: [] };
  const hull = convexHull(selected.map(({ at }) => at));
  const nebulae = galaxy.nebulae.flatMap((n, index) =>
    inConvexHull(n, hull) ? [{ index, ...turned(n) }] : [],
  );
  return { pivot, systems, nebulae };
}

/** The Rotate section's quarter and half turns, clockwise as the map shows it. */
export const ROTATE_TURNS = [
  { label: "90° left", degrees: -90 },
  { label: "90° right", degrees: 90 },
  { label: "180°", degrees: 180 },
] as const;

/** `45` → `45°`, `12.5` → `12.5°`, to two decimals at most. */
function angle(degrees: number): string {
  return `${Number(degrees.toFixed(2))}°`;
}

/**
 * The rotation `rotationPreview` describes as one undo step: a Batch of one MoveSystems and a
 * MoveNebula per nebula it carries, named "Rotated 6 systems and 1 nebula by 45°". Null when the
 * preview is.
 */
export function rotationOp(
  state: RotationState,
  galaxy: RotationGalaxy,
  degrees: number,
): Op | null {
  const preview = rotationPreview(state, galaxy, degrees);
  if (preview === null) return null;
  const { systems, nebulae } = preview;
  const what =
    nebulae.length === 0
      ? counted(systems.length, "system")
      : `${counted(systems.length, "system")} and ${counted(nebulae.length, "nebula", "nebulae")}`;
  return {
    type: "Batch",
    description: `Rotated ${what} by ${angle(degrees)}`,
    ops: [
      { type: "MoveSystems", moves: systems },
      ...nebulae.map((n): Op => ({ type: "MoveNebula", ...n })),
    ],
  };
}
