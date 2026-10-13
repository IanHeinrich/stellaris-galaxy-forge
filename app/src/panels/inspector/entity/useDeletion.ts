import type { DocumentKind } from "../../../generated/DocumentKind";
import type { MegastructureView } from "../../../generated/MegastructureView";
import type { Op } from "../../../generated/Op";
import {
  deleteMegastructureOp,
  DELETE_MEGASTRUCTURE,
} from "../../../lib/details/megastructureRemoval";
import {
  deleteLabel,
  deleteOp,
  REMOVE_COLONY,
  removeColonyOp,
} from "../../../lib/details/planetRemoval";
import {
  DELETE_RING_WORLD,
  deleteRingWorldOp,
  isRingRow,
  isRingSegment,
} from "../../../lib/details/ringWorldRemoval";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { deleteMegastructure } from "../../../store/megastructureRemoval";
import { planetEditAdapterFor } from "../../../store/planetEditAdapter";
import { deleteRingWorld } from "../../../store/ringWorldRemoval";
import { useOpCheck } from "../../useOpCheck";

/**
 * What a page or a menu deletes, named `name`: a body of `system` with its class, the colony on a body, or a megastructure whose `row` is its type key and whose system is null where no system
 * read so far lists it.
 */
export type DeletionTarget =
  | { kind: "planet"; system: number; id: number; name: string; moon: boolean; class: string }
  | { kind: "colony"; system: number; id: number; name: string }
  | { kind: "megastructure"; system: number | null; id: number; name: string; row: string };

type Kind = DeletionTarget["kind"];

/** What the table reads besides the target: the document's kind and the install's megastructure types. */
interface Setting {
  documentKind: DocumentKind | null;
  types: ReadonlyMap<string, MegastructureView>;
}

interface Deletion {
  label: string;
  /** The op whose refusal the core is asked for. */
  op: Op;
  run: () => Promise<boolean>;
}

function ringWorld(system: number): Deletion {
  return {
    label: DELETE_RING_WORLD,
    op: deleteRingWorldOp(system),
    run: () => deleteRingWorld(system),
  };
}

/** Each kind's deletion; a ring world segment and a ring world row delete their whole ring. */
const DELETIONS: {
  [K in Kind]: (target: Extract<DeletionTarget, { kind: K }>, setting: Setting) => Deletion;
} = {
  planet: (t, { documentKind }) =>
    isRingSegment(t.class)
      ? ringWorld(t.system)
      : {
          label: deleteLabel(t.moon),
          op: deleteOp(t.id),
          run: () =>
            planetEditAdapterFor(documentKind, { system: t.system, id: t.id }).remove(
              t.name,
              t.moon,
            ),
        },
  colony: (t, { documentKind }) => ({
    label: REMOVE_COLONY,
    op: removeColonyOp(t.id),
    run: () =>
      planetEditAdapterFor(documentKind, { system: t.system, id: t.id }).removeColony(t.name),
  }),
  megastructure: (t, { types }) =>
    t.system !== null && isRingRow(t.row, types)
      ? ringWorld(t.system)
      : {
          label: DELETE_MEGASTRUCTURE,
          op: deleteMegastructureOp(t.id),
          run: () => deleteMegastructure(t.id, t.name, t.system),
        },
};

function deletionOf<K extends Kind>(
  target: Extract<DeletionTarget, { kind: K }>,
  setting: Setting,
): Deletion {
  return DELETIONS[target.kind as K](target, setting);
}

/**
 * The deletion of `target`: its label, why the core refuses it (null when it would apply,
 * undefined until the core has answered) and the confirmed deletion itself.
 */
export function useDeletion(target: DeletionTarget): {
  label: string;
  refusal: string | null | undefined;
  run: () => Promise<boolean>;
} {
  const documentKind = useFileSessionStore((s) => s.kind);
  const types = useGameDataStore((s) => s.megastructureTypes);
  const { label, op, run } = deletionOf(target, { documentKind, types });
  const refusal = useOpCheck(op, target.system);
  return { label, refusal, run };
}
