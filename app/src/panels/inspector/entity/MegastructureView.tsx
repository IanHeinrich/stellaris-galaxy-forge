import { documentCapabilities } from "../../../lib/capabilities";
import {
  DELETE_MEGASTRUCTURE,
  deleteMegastructureOp,
  systemOfMegastructure,
} from "../../../lib/details/megastructureRemoval";
import { isRingRow } from "../../../lib/details/ringWorldRemoval";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { deleteMegastructure } from "../../../store/megastructureRemoval";
import { useOpCheck } from "../../useOpCheck";
import { EntityView } from "./EntityView";
import { DeleteRingWorldAction, RemovalAction } from "./PlanetRemoval";

/** Deletes megastructure `id`, named `name`, or says why the core refuses. */
function DeleteMegastructureAction({ id, name }: { id: number; name: string }) {
  const system = useDetailsStore((s) => systemOfMegastructure(s.details, id));
  const refusal = useOpCheck(deleteMegastructureOp(id), system);
  return (
    <RemovalAction
      refusal={refusal}
      label={DELETE_MEGASTRUCTURE}
      run={() => deleteMegastructure(id, name, system)}
    />
  );
}

/** Deletes megastructure `id`, or the ring world it belongs to, whole. */
function DeleteAction({ id, name }: { id: number; name: string }) {
  const system = useDetailsStore((s) => systemOfMegastructure(s.details, id));
  const kind = useDetailsStore((s) =>
    system === null
      ? undefined
      : s.details.get(system)?.megastructures.find((m) => m.id === id)?.kind,
  );
  const types = useGameDataStore((s) => s.megastructureTypes);
  if (system !== null && kind !== undefined && isRingRow(kind, types)) {
    return <DeleteRingWorldAction system={system} />;
  }
  return <DeleteMegastructureAction id={id} name={name} />;
}

/** A megastructure: the generic entity view, with its deletion under the Overview. */
export function MegastructureView({ entry }: { entry: Entry }) {
  const tab = useInspectorStore((s) => s.tab);
  const removable = useFileSessionStore((s) => documentCapabilities(s).remove_megastructures);
  const ref = entry.ref;
  if (tab !== "overview" || ref.kind !== "megastructure" || !removable) {
    return <EntityView entry={entry} />;
  }
  return (
    <>
      <EntityView entry={entry} />
      <DeleteAction id={ref.id} name={entry.label} />
    </>
  );
}
