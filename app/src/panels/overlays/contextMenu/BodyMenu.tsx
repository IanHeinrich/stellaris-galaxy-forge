import { bodyName } from "../../../lib/details/labels";
import { lockedToName, orbitParent } from "../../../lib/details/orbitEdits";
import { deleteLabel, deleteOp } from "../../../lib/details/planetRemoval";
import { backToGalaxy } from "../../../store/commands";
import { useDetailsStore } from "../../../store/detailsStore";
import { useCanEdit } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { deletePlanet } from "../../../store/planetRemoval";
import { bodyEntry, useInspectorStore } from "../../../store/inspectorStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { useSceneStore } from "../../../store/sceneStore";
import { useSystemGeometry } from "../../../store/systemGeometry";
import { useOpCheck } from "../../useOpCheck";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";
import { CutItem } from "./PlanetMoveItems";

/**
 * The menu on a body in the system view: its page, the selection's cut, its lock, its deletion,
 * and the way back out.
 */
export function BodyMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "body" }>;
  frame: Frame;
}) {
  const openFromMap = useInspectorStore((s) => s.openFromMap);
  const details = useDetailsStore((s) => s.details.get(target.system));
  const names = useGameDataStore((s) => s.names);
  const { layout, editing } = useSystemGeometry(target.system);
  const locked = useSceneStore((s) => s.lockedBodies.has(target.id));
  const lockBody = useSceneStore((s) => s.lockBody);
  const unlockBody = useSceneStore((s) => s.unlockBody);
  const nameOf = (id: number) => {
    const planet = details?.planets.find((p) => p.id === id);
    return planet === undefined ? undefined : bodyName(planet, names);
  };
  const name = nameOf(target.id);
  const moon = details?.planets.find((p) => p.id === target.id)?.moon === true;
  const deletable = useCanEdit("deposits");
  const placed = layout.bodies.find((b) => b.id === target.id);
  const lockable = placed !== undefined && editing.bodies.get(target.id)?.move === true;
  return (
    <MenuFrame {...frame} label={name}>
      {name !== undefined && <div className="context-menu-header">{name}</div>}
      <MenuItem
        disabled={name === undefined}
        run={() => {
          if (name !== undefined) openFromMap(bodyEntry(target.system, target.id, name));
        }}
      >
        Inspect
      </MenuItem>
      <CutItem system={target.system} />
      {lockable &&
        (locked ? (
          <MenuItem run={() => unlockBody(target.id)}>Unlock</MenuItem>
        ) : (
          <MenuItem run={() => lockBody(target.id)}>
            {`Lock to ${lockedToName(orbitParent(layout, placed), nameOf)}`}
          </MenuItem>
        ))}
      {deletable && name !== undefined && (
        <DeleteItem system={target.system} planet={target.id} name={name} moon={moon} />
      )}
      <MenuItem className="context-menu-separated" run={backToGalaxy}>
        Back to galaxy
      </MenuItem>
    </MenuFrame>
  );
}

/** Deletes the body with its moons, or says why it cannot: offered once the core has answered. */
function DeleteItem({
  system,
  planet,
  name,
  moon,
}: {
  system: number;
  planet: number;
  name: string;
  moon: boolean;
}) {
  const refusal = useOpCheck(deleteOp(planet), system);
  return (
    <MenuItem
      disabled={refusal !== null}
      className={refusal ? "hinted" : undefined}
      title={refusal ?? undefined}
      run={() => deletePlanet(planet, name, moon)}
    >
      {deleteLabel(moon)}
      {refusal && <span className="muted">{refusal}</span>}
    </MenuItem>
  );
}
