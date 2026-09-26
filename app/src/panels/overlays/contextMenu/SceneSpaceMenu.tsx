import { useSystemNames } from "../../../store/browserRows";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { backToGalaxy } from "../../../store/commands";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";

/** The menu on the empty space of the system view: the way back out. */
export function SceneSpaceMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "systemSpace" }>;
  frame: Frame;
}) {
  const [name] = useSystemNames([target.system]);
  return (
    <MenuFrame {...frame} label={name}>
      <div className="context-menu-header">{name}</div>
      <MenuItem run={backToGalaxy}>Back to galaxy</MenuItem>
    </MenuFrame>
  );
}
