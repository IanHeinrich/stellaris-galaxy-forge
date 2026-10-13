import type { MegastructureSummary } from "../../../generated/MegastructureSummary";
import { documentCapabilities, supports } from "../../../lib/capabilities";
import { megastructureName } from "../../../lib/details/labels";
import { snapBody, snapLabel } from "../../../lib/details/megastructureMoves";
import { capabilityFor } from "../../../lib/entities";
import { backToGalaxy } from "../../../store/commands";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { megastructureEntry, useInspectorStore } from "../../../store/inspectorStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { useSceneStore } from "../../../store/sceneStore";
import { applyGeometry, useSystemGeometry } from "../../../store/systemGeometry";
import { useSystemBodyNames } from "../../useBodyName";
import { DeleteItem } from "./DeleteItem";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";

/**
 * The menu on a megastructure in the system view: its page where the document has one, a
 * floating one's way back to its planet's point, its deletion or its ring world's, and the way
 * out.
 */
export function MegastructureMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "megastructure" }>;
  frame: Frame;
}) {
  const openFromMap = useInspectorStore((s) => s.openFromMap);
  const row = useDetailsStore((s) =>
    s.details.get(target.system)?.megastructures.find((m) => m.id === target.id),
  );
  const names = useGameDataStore((s) => s.names);
  const removable = useFileSessionStore((s) => documentCapabilities(s).remove_megastructures);
  const paged = useFileSessionStore((s) =>
    supports(documentCapabilities(s), capabilityFor("megastructure")),
  );
  const name = row === undefined ? undefined : megastructureName(row.kind, names);
  const inspect = () => {
    if (name === undefined) return;
    useSceneStore.getState().clearBodies();
    openFromMap(megastructureEntry(target.id, name));
  };
  return (
    <MenuFrame {...frame} label={name}>
      {name !== undefined && <div className="context-menu-header">{name}</div>}
      {paged && (
        <MenuItem disabled={name === undefined} run={inspect}>
          Inspect
        </MenuItem>
      )}
      {row !== undefined && <SnapItem system={target.system} row={row} />}
      {removable && name !== undefined && row !== undefined && (
        <DeleteItem
          target={{
            kind: "megastructure",
            system: target.system,
            id: target.id,
            name,
            row: row.kind,
          }}
        />
      )}
      <MenuItem className="context-menu-separated" run={backToGalaxy}>
        Back to galaxy
      </MenuItem>
    </MenuFrame>
  );
}

/** Stands a floating megastructure back at its planet's point, where it stands away from it. */
function SnapItem({ system, row }: { system: number; row: MegastructureSummary }) {
  const { editing, layout } = useSystemGeometry(system);
  const type = useGameDataStore((s) => s.megastructureTypes.get(row.kind));
  const named = useSystemBodyNames(system);
  const body = editing.megastructures ? snapBody(row, type, layout.bodies) : null;
  if (body === null) return null;
  const at = { place: "body", body } as const;
  const run = () => {
    void applyGeometry({ kind: "moveMegastructure", system, megastructure: row.id, at });
  };
  return <MenuItem run={run}>{snapLabel(named(body)?.text ?? `#${body}`)}</MenuItem>;
}
