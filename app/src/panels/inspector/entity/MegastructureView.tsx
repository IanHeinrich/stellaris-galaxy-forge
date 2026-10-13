import { documentCapabilities } from "../../../lib/capabilities";
import { systemOfMegastructure } from "../../../lib/details/megastructureRemoval";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { EntityView } from "./EntityView";
import { RemovalAction } from "./PlanetRemoval";

/** Deletes megastructure `id`, named `name`, or the ring world it belongs to, whole. */
function DeleteAction({ id, name }: { id: number; name: string }) {
  const system = useDetailsStore((s) => systemOfMegastructure(s.details, id));
  const row = useDetailsStore((s) =>
    system === null
      ? undefined
      : s.details.get(system)?.megastructures.find((m) => m.id === id)?.kind,
  );
  return <RemovalAction target={{ kind: "megastructure", system, id, name, row: row ?? "" }} />;
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
