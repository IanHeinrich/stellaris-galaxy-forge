/**
 * Taking out what a scenario system's own block places, a ruin or an ambient object, once the
 * user confirms. Ids are places in the block, so the pages of the row and of every later one of
 * its kind close.
 */
import type { Op } from "../generated/Op";
import type { RowOrigin } from "../generated/RowOrigin";
import type { SystemDetails } from "../generated/SystemDetails";
import { ambientObjectsOf, removeAmbientObjectOp } from "../lib/details/ambientObjects";
import { placedFrom, removePlacedQuestion } from "../lib/details/megastructureRemoval";
import { confirmDeletion } from "./confirmDeletion";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { useGalaxyStore } from "./galaxyStore";
import type { GonePages } from "./inspectorStore";

/** What a removal of a placed row reads and sends. */
export interface PlacedRemoval {
  id: number;
  name: string;
  /** Its system, or null where no system read lists it. */
  system: number | null;
  /** The origins of the rows of its kind, from its system's details. */
  origins(details: SystemDetails | undefined): readonly (RowOrigin | undefined)[];
  op: Op;
  /** The pages that go, by the ids taken or renumbered. */
  gone(ids: number[]): GonePages;
}

export function removePlaced(removal: PlacedRemoval): Promise<boolean> {
  const { id, name, system } = removal;
  return confirmDeletion({
    title: name,
    read: () => {
      const read = system === null ? undefined : useDetailsStore.getState().details.get(system);
      return Promise.resolve(placedFrom(removal.origins(read), id));
    },
    question() {
      const where = system === null ? null : useGalaxyStore.getState().systemName(system);
      return removePlacedQuestion(name, where);
    },
    apply: () => useEditorStore.getState().applyOp(removal.op),
    gone: removal.gone,
  });
}

/** Takes ambient object `id`, named `name`, out of scenario system `system` once the user confirms. */
export function removeAmbientObject(
  id: number,
  name: string,
  system: number | null,
): Promise<boolean> {
  return removePlaced({
    id,
    name,
    system,
    origins: (details) => ambientObjectsOf(details).map((o) => o.origin),
    op: removeAmbientObjectOp(id),
    gone: (ambientObjects) => ({ ambientObjects }),
  });
}
