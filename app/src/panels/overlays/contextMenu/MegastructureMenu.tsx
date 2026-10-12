import type { MegastructureSummary } from "../../../generated/MegastructureSummary";
import { documentCapabilities, supports } from "../../../lib/capabilities";
import {
  DELETE_MEGASTRUCTURE,
  deleteMegastructureOp,
  megastructureName,
} from "../../../lib/details/megastructureRemoval";
import { snapBody, snapLabel } from "../../../lib/details/megastructureMoves";
import { isRingRow } from "../../../lib/details/ringWorldRemoval";
import { capabilityFor } from "../../../lib/entities";
import { backToGalaxy } from "../../../store/commands";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { megastructureEntry, useInspectorStore } from "../../../store/inspectorStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { deleteMegastructure } from "../../../store/megastructureRemoval";
import { useSceneStore } from "../../../store/sceneStore";
import { applyGeometry, useSystemGeometry } from "../../../store/systemGeometry";
import { useSystemBodyNames } from "../../inspector/entity/useBodyName";
import { useOpCheck } from "../../useOpCheck";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";
import { RingWorldItem } from "./RingWorldItem";

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
      {removable &&
        name !== undefined &&
        row !== undefined &&
        (isRingRow(row.kind) ? (
          <RingWorldItem system={target.system} />
        ) : (
          <DeleteItem system={target.system} id={target.id} name={name} />
        ))}
      <MenuItem className="context-menu-separated" run={backToGalaxy}>
        Back to galaxy
      </MenuItem>
    </MenuFrame>
  );
}

/** Deletes the megastructure, or says why it cannot: offered once the core has answered. */
function DeleteItem({ system, id, name }: { system: number; id: number; name: string }) {
  const refusal = useOpCheck(deleteMegastructureOp(id), system);
  return (
    <MenuItem
      disabled={refusal !== null}
      className={refusal ? "hinted" : undefined}
      title={refusal ?? undefined}
      run={() => deleteMegastructure(id, name, system)}
    >
      {DELETE_MEGASTRUCTURE}
      {refusal && <span className="muted">{refusal}</span>}
    </MenuItem>
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
