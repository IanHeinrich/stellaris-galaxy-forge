import { documentCapabilities } from "../../../lib/capabilities";
import {
  DELETE_MEGASTRUCTURE,
  deleteMegastructureOp,
  megastructureName,
} from "../../../lib/details/megastructureRemoval";
import { isRingRow } from "../../../lib/details/ringWorldRemoval";
import { backToGalaxy } from "../../../store/commands";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { megastructureEntry, useInspectorStore } from "../../../store/inspectorStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { deleteMegastructure } from "../../../store/megastructureRemoval";
import { useSceneStore } from "../../../store/sceneStore";
import { useOpCheck } from "../../useOpCheck";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";
import { RingWorldItem } from "./RingWorldItem";

/**
 * The menu on a megastructure in the system view: its page, its deletion or its ring world's, and
 * the way out.
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
  const name = row === undefined ? undefined : megastructureName(row.kind, names);
  const inspect = () => {
    if (name === undefined) return;
    useSceneStore.getState().clearBodies();
    openFromMap(megastructureEntry(target.id, name));
  };
  return (
    <MenuFrame {...frame} label={name}>
      {name !== undefined && <div className="context-menu-header">{name}</div>}
      <MenuItem disabled={name === undefined} run={inspect}>
        Inspect
      </MenuItem>
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
