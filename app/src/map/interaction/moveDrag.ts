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
import type { DragState, MapLayer } from "../layers/MapLayer";
import type { MoveGhost } from "../moveGhosts";
import { SettlingPreview } from "./settlingPreview";

function dragState(ghosts: MoveGhost[]): DragState | null {
  if (ghosts.length === 0) return null;
  return { ghosts, byId: new Map(ghosts.map((g) => [g.id, g])) };
}

/** The systems of `ids` the galaxy holds, each offset by (dx, dy). */
function groupGhosts(ids: readonly number[], dx: number, dy: number): MoveGhost[] {
  const systems = useGalaxyStore.getState().systems;
  return ids.flatMap((id) => {
    const s = systems.get(id);
    return s ? [{ id, x: s.x + dx, y: s.y + dy }] : [];
  });
}

/**
 * The move side of `MapIntent`: one system or a group dragged, with the counterparts symmetry
 * carries found once when the drag starts, shown as ghosts on `layers` until the edit it sends
 * settles.
 */
export class MoveDrag {
  private readonly preview: SettlingPreview;
  private plan: MovePlan | null = null;

  constructor(private readonly layers: readonly MapLayer[]) {
    this.preview = new SettlingPreview(() => this.show([]));
  }

  /** System `id` with its centre at (x, y). */
  move(id: number, x: number, y: number): void {
    this.update([id], [{ id, x, y }]);
  }

  commitMove(id: number, x: number, y: number): void {
    this.commit({ type: "MoveSystem", id, x, y });
  }

  /** The systems of `ids`, each offset by (dx, dy). */
  moveGroup(ids: readonly number[], dx: number, dy: number): void {
    this.update(ids, groupGhosts(ids, dx, dy));
  }

  commitGroup(ids: readonly number[], dx: number, dy: number): void {
    this.commit({ type: "MoveSystems", moves: groupGhosts(ids, dx, dy) });
  }

  cancel(): void {
    this.plan = null;
    this.preview.drop();
  }

  private planFor(ids: readonly number[]): MovePlan {
    return (this.plan ??= movePlan(ids));
  }

  private update(ids: readonly number[], moves: MoveGhost[]): void {
    this.preview.update();
    this.show(plannedMoves(this.planFor(ids), moves));
  }

  private commit(op: MoveOp): void {
    const planned = plannedMoveOp(this.planFor(movedIds(op)), op);
    this.plan = null;
    this.preview.settle(useEditorStore.getState().applyOp(planned));
  }

  private show(ghosts: MoveGhost[]): void {
    const drag = dragState(ghosts);
    for (const layer of this.layers) layer.setDragState?.(drag);
  }
}
