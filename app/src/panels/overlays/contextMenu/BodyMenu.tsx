import { ADD_MOON_LABEL, takesMoons } from "../../../lib/addBody";
import { bodyName } from "../../../lib/details/labels";
import { lockedToName, nextMoonRing, orbitParent } from "../../../lib/details/orbitEdits";
import { isStarBody } from "../../../lib/details/starBody";
import { backToGalaxy } from "../../../store/commands";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEditorStore } from "../../../store/editorStore";
import { useCanEdit } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { bodyEntry, useInspectorStore } from "../../../store/inspectorStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { useSceneStore } from "../../../store/sceneStore";
import { useSystemGeometry } from "../../../store/systemGeometry";
import { AddBodyItems } from "./AddBodyItems";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";
import { CutItem } from "./PlanetMoveItems";

/**
 * The menu on a body in the system view: its page, the selection's cut, its lock, a new moon of
 * it, its removal, and the way back out.
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
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const addBodyAt = useEditorStore((s) => s.addBodyAt);
  const canAddBodies = useCanEdit("geometry");
  const { layout, editing, frame: geometry } = useSystemGeometry(target.system);
  const locked = useSceneStore((s) => s.lockedBodies.has(target.id));
  const lockBody = useSceneStore((s) => s.lockBody);
  const unlockBody = useSceneStore((s) => s.unlockBody);
  const nameOf = (id: number) => {
    const planet = details?.planets.find((p) => p.id === id);
    return planet === undefined ? undefined : bodyName(planet, names);
  };
  const name = nameOf(target.id);
  const placed = layout.bodies.find((b) => b.id === target.id);
  const lockable = placed !== undefined && editing.bodies.get(target.id)?.move === true;
  const planet = details?.planets.find((p) => p.id === target.id);
  const moonHost =
    canAddBodies &&
    planet !== undefined &&
    takesMoons(planet, {
      star: isStarBody(planet.class, planetClasses, starClasses),
      asteroid: planetClasses.get(planet.class)?.asteroid === true,
    });
  const addMoon = (planetClass: string | null) =>
    addBodyAt(
      target.system,
      { radius: nextMoonRing(geometry, target.id), angle: 0 },
      target.id,
      planetClass,
    );
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
      {moonHost && <AddBodyItems label={ADD_MOON_LABEL} moon add={addMoon} />}
      <MenuItem disabled run={() => undefined}>
        Remove
      </MenuItem>
      <MenuItem className="context-menu-separated" run={backToGalaxy}>
        Back to galaxy
      </MenuItem>
    </MenuFrame>
  );
}
