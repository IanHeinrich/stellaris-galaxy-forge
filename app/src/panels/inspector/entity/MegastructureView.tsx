import { documentCapabilities } from "../../../lib/capabilities";
import { MEGASTRUCTURE_ICON_KEY } from "../../../lib/details/icons";
import { megastructureName } from "../../../lib/details/labels";
import { editableId, originOf } from "../../../lib/details/placedRows";
import { systemOfMegastructure } from "../../../lib/details/megastructureRemoval";
import { openSystem } from "../../../store/commands";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { Icon } from "../../parts";
import { Empty, LinkRow, Properties, PropertyRow } from "../parts";
import { ChildView } from "./ChildView";
import { EntityView } from "./EntityView";
import { MegastructurePosition } from "./MegastructurePosition";
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

/** A save's megastructure: the generic entity view, its position where it has one, its deletion. */
function SaveMegastructure({ entry, id }: { entry: Entry; id: number }) {
  const tab = useInspectorStore((s) => s.tab);
  const removable = useFileSessionStore((s) => documentCapabilities(s).remove_megastructures);
  if (tab !== "overview") return <EntityView entry={entry} />;
  return (
    <>
      <EntityView entry={entry} fields={<MegastructurePosition id={id} />} />
      {removable && <DeleteAction id={id} name={entry.label} />}
    </>
  );
}

/**
 * A ruin a scenario system's own block places: its position where it has one, then what it is,
 * and its deletion where the editor edits it as it stands.
 */
function ScenarioMegastructure({ id, label }: { id: number; label: string }) {
  const system = useDetailsStore((s) => systemOfMegastructure(s.details, id));
  const row = useDetailsStore((s) =>
    system === null ? undefined : s.details.get(system)?.megastructures.find((m) => m.id === id),
  );
  const systemName = useGalaxyStore((s) => s.systemName);
  const names = useGameDataStore((s) => s.names);
  const head = (
    <div className="ins-head">
      <Icon className="gi" keys={[MEGASTRUCTURE_ICON_KEY]} glyph="◈" />
      <span className="name">{label}</span>
    </div>
  );
  if (system === null || row === undefined) {
    return (
      <>
        {head}
        <Empty>This megastructure is not in the system.</Empty>
      </>
    );
  }
  return (
    <>
      {head}
      <div className="ins-sub muted">Megastructure in {systemName(system)}</div>
      <MegastructurePosition id={id} />
      <div className="edit-block-title ins-about">About</div>
      <Properties>
        <PropertyRow label="Type">{megastructureName(row.kind, names)}</PropertyRow>
        <LinkRow label="System" title="Open the system's page" onOpen={() => openSystem(system)}>
          {systemName(system)}
        </LinkRow>
      </Properties>
      {editableId(originOf(row)) !== null && (
        <RemovalAction target={{ kind: "ruin", system, id, name: label }} />
      )}
    </>
  );
}

/**
 * A megastructure: a save's from its entity, a scenario's own ruin from its system's details, or
 * the placeholder where the document holds neither.
 */
export function MegastructureView({ entry }: { entry: Entry }) {
  const capabilities = useFileSessionStore(documentCapabilities);
  const ref = entry.ref;
  if (ref.kind !== "megastructure") return <EntityView entry={entry} />;
  if (capabilities.details) return <SaveMegastructure entry={entry} id={ref.id} />;
  if (capabilities.place_structures)
    return <ScenarioMegastructure id={ref.id} label={entry.label} />;
  return <ChildView entry={entry} />;
}
