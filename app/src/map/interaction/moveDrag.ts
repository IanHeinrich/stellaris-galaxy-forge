import { rotationPreview } from "../../lib/rotation";
import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import {
  movedIds,
  movePlan,
  plannedMoveOp,
  plannedMoves,
  type MoveOp,
  type MovePlan,
} from "../../store/symmetricEdits";
import type { DrawnPositions } from "../drawnPositions";
import type { DragState, MapLayer } from "../layers/MapLayer";
import type { SystemMove } from "../../generated/SystemMove";
import type { MoveGhost } from "../moveGhosts";
import { SettlingPreview } from "./settlingPreview";

/** The systems of `ids` the galaxy holds, each offset by (dx, dy). */
function groupGhosts(ids: readonly number[], dx: number, dy: number): SystemMove[] {
  const systems = useGalaxyStore.getState().systems;
  return ids.flatMap((id) => {
    const s = systems.get(id);
    return s ? [{ system: id, x: s.x + dx, y: s.y + dy }] : [];
  });
}

/** Where turning the selection by `degrees` puts its systems, as the edit would write them. */
function turnedGhosts(degrees: number): SystemMove[] {
  return (
    rotationPreview(useEditorStore.getState(), useGalaxyStore.getState(), degrees)?.systems ?? []
  );
}

/**
 * Previews `ghosts` on `layers`, each where its system would draw at its destination, with what
 * they leave behind faded, and the `turn` a rotate drag gives them; none ends the preview.
 */
export function showGhosts(
  layers: readonly MapLayer[],
  drawn: DrawnPositions,
  ghosts: readonly MoveGhost[],
  turn: number | null = null,
): void {
  let drag: DragState | null = null;
  if (ghosts.length > 0) {
    const systems = useGalaxyStore.getState().systems;
    const placed = ghosts.map((g) => {
      const s = systems.get(g.id);
      return s ? { id: g.id, ...drawn.atPoint(s, g) } : g;
    });
    drag = { ghosts: placed, byId: new Map(placed.map((g) => [g.id, g])), turn };
  }
  for (const layer of layers) layer.setDragState?.(drag);
}

/**
 * The move side of `MapIntent`: one system or a group dragged, with the counterparts symmetry
 * carries found once when the drag starts, or the selection turned about its pivot, shown as
 * ghosts on `layers` until the edit it sends settles. A move is a place on the plane; each ghost
 * draws where its system would draw there.
 */
export class MoveDrag {
  private readonly preview: SettlingPreview;
  private plan: MovePlan | null = null;

  constructor(
    private readonly layers: readonly MapLayer[],
    private readonly drawn: DrawnPositions,
  ) {
    this.preview = new SettlingPreview(() => this.show([]));
  }

  /** System `id` with its centre at (x, y). */
  move(id: number, x: number, y: number): void {
    this.update([id], [{ system: id, x, y }]);
  }

  commitMove(id: number, x: number, y: number): void {
    this.commit({ type: "MoveSystem", system: id, x, y });
  }

  /** The systems of `ids`, each offset by (dx, dy). */
  moveGroup(ids: readonly number[], dx: number, dy: number): void {
    this.update(ids, groupGhosts(ids, dx, dy));
  }

  commitGroup(ids: readonly number[], dx: number, dy: number): void {
    this.commit({ type: "MoveSystems", moves: groupGhosts(ids, dx, dy) });
  }

  /** The selection turned by `degrees` about its pivot; symmetry does not apply. */
  rotate(degrees: number): void {
    this.showMoves(turnedGhosts(degrees), degrees);
  }

  commitRotate(degrees: number): void {
    this.preview.settle(useEditorStore.getState().rotateSelection(degrees));
  }

  cancel(): void {
    this.plan = null;
    this.preview.drop();
  }

  private planFor(ids: readonly number[]): MovePlan {
    return (this.plan ??= movePlan(ids));
  }

  private update(ids: readonly number[], moves: SystemMove[]): void {
    this.showMoves(plannedMoves(this.planFor(ids), moves));
  }

  private showMoves(moves: readonly SystemMove[], turn: number | null = null): void {
    this.preview.update();
    this.show(
      moves.map(({ system, x, y }) => ({ id: system, x, y })),
      turn,
    );
  }

  private commit(op: MoveOp): void {
    const planned = plannedMoveOp(this.planFor(movedIds(op)), op);
    this.plan = null;
    this.preview.settle(useEditorStore.getState().applyOp(planned));
  }

  private show(ghosts: MoveGhost[], turn: number | null = null): void {
    showGhosts(this.layers, this.drawn, ghosts, turn);
  }
}
