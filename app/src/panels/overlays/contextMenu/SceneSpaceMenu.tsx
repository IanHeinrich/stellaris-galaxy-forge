import { defaultBeltKind } from "../../../lib/details/orbitEdits";
import { useSystemNames } from "../../../store/browserRows";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { backToGalaxy } from "../../../store/commands";
import { applyGeometry, useSystemGeometry } from "../../../store/systemGeometry";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";

/** The menu on the empty space of the system view: a belt where it was pressed, and the way out. */
export function SceneSpaceMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "systemSpace" }>;
  frame: Frame;
}) {
  const [name] = useSystemNames([target.system]);
  const { editing, frame: geometry } = useSystemGeometry(target.system);
  const radius = Math.round(Math.hypot(target.x, target.y));
  const belt = editing.belts && radius > 0;
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
      {belt && <MenuItem run={addBelt}>Add belt here (r {radius})</MenuItem>}
      <MenuItem run={backToGalaxy} className={belt ? "context-menu-separated" : undefined}>
        Back to galaxy
      </MenuItem>
    </MenuFrame>
  );
}
