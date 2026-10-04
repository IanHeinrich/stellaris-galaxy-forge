import { ADD_PLANET_LABEL } from "../../../lib/addBody";
import { defaultBeltKind } from "../../../lib/details/orbitIntent";
import { placementAt } from "../../../lib/planetMove";
import { useSystemNames } from "../../../store/browserRows";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { usePlanetMoveStore } from "../../../store/planetMoveStore";
import { backToGalaxy } from "../../../store/commands";
import { useEditorStore } from "../../../store/editorStore";
import { useCanEdit } from "../../../store/fileSessionStore";
import { applyGeometry, useSystemGeometry } from "../../../store/systemGeometry";
import { AddBodyItems } from "./AddBodyItems";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";
import { PasteItem } from "./PlanetMoveItems";

/**
 * The menu on the empty space of the system view: the cut planets pasted where it was pressed, a
 * new planet or belt there, and the way out.
 */
export function SceneSpaceMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "systemSpace" }>;
  frame: Frame;
}) {
  const [name] = useSystemNames([target.system]);
  const cut = usePlanetMoveStore((s) => s.cut !== null);
  const { editing, frame: geometry } = useSystemGeometry(target.system);
  const radius = Math.round(Math.hypot(target.x, target.y));
  const belt = editing.belts && radius > 0;
  const addBodyAt = useEditorStore((s) => s.addBodyAt);
  const planet = useCanEdit("added_systems") && radius > 0;
  const addBelt = () =>
    applyGeometry({
      kind: "addBelt",
      system: target.system,
      beltKind: defaultBeltKind(geometry.details),
      radius,
    });
  return (
    <MenuFrame {...frame} label={name}>
      <div className="context-menu-header">{name}</div>
      {cut && <PasteItem system={target.system} at={placementAt(target.x, target.y)} />}
      {planet && (
        <AddBodyItems
          label={ADD_PLANET_LABEL}
          moon={false}
          add={(planetClass) =>
            addBodyAt(target.system, placementAt(target.x, target.y), null, planetClass)
          }
        />
      )}
      {belt && <MenuItem run={addBelt}>Add belt here (r {radius})</MenuItem>}
      <MenuItem
        run={backToGalaxy}
        className={belt || planet ? "context-menu-separated" : undefined}
      >
        Back to galaxy
      </MenuItem>
    </MenuFrame>
  );
}
