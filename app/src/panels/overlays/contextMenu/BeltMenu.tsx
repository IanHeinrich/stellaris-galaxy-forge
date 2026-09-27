import { useSystemNames } from "../../../store/browserRows";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { backToGalaxy } from "../../../store/commands";
import { applyGeometry, useSystemGeometry } from "../../../store/systemGeometry";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";

/** The menu on a belt's handle in the system view: remove the belt, and the way out. */
export function BeltMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "belt" }>;
  frame: Frame;
}) {
  const [name] = useSystemNames([target.system]);
  const { editing, layout } = useSystemGeometry(target.system);
  const removable = editing.belts && layout.belts[target.index] !== undefined;
  const remove = () =>
    applyGeometry({ kind: "removeBelt", system: target.system, index: target.index });
  return (
    <MenuFrame {...frame} label={name}>
      <div className="context-menu-header">{name}</div>
      {removable && <MenuItem run={remove}>Remove belt</MenuItem>}
      <MenuItem run={backToGalaxy} className={removable ? "context-menu-separated" : undefined}>
        Back to galaxy
      </MenuItem>
    </MenuFrame>
  );
}
