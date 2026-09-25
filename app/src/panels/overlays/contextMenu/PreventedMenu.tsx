import { laneLabel } from "../../../lib/names";
import { useSystemNames } from "../../../store/browserRows";
import { useEditorStore } from "../../../store/editorStore";
import { isPrevented, useGalaxyStore } from "../../../store/galaxyStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";

/** The menu on a pair the scenario keeps from a lane: allowing one again. */
export function PreventedMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "prevented" }>;
  frame: Frame;
}) {
  const applySymmetric = useEditorStore((s) => s.applySymmetric);
  const systems = useGalaxyStore((s) => s.systems);
  const { a, b } = target;
  const prevented = isPrevented(systems, a, b);
  const named = useSystemNames([a, b]);
  const label = laneLabel(named[0], named[1]);
  return (
    <MenuFrame {...frame} label={label}>
      <div className="context-menu-header">{label}</div>
      <MenuItem disabled={!prevented} run={() => applySymmetric({ type: "UnpreventLane", a, b })}>
        Allow
      </MenuItem>
    </MenuFrame>
  );
}
