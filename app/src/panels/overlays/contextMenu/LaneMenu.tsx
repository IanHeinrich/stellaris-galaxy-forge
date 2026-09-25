import { laneLabel } from "../../../lib/names";
import { useSystemNames } from "../../../store/browserRows";
import { useEditorStore } from "../../../store/editorStore";
import { useCanEdit } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";

/** Why a lane the galaxy no longer holds cannot be cut, shown on hover. */
const LANE_GONE = "One of this lane's systems is no longer in the galaxy.";

/** The menu on a hyperlane: cutting it, and resetting a length a move left stale. */
export function LaneMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "lane" }>;
  frame: Frame;
}) {
  const applyOp = useEditorStore((s) => s.applyOp);
  const applySymmetric = useEditorStore((s) => s.applySymmetric);
  const preventLanes = useEditorStore((s) => s.preventLanes);
  const systems = useGalaxyStore((s) => s.systems);
  const canPrevent = useCanEdit("create_systems");
  const { a, b } = target.lane;
  const named = useSystemNames([a, b]);

  const lane = systems.get(a)?.lanes.find((l) => l.to === b);
  const canReset = lane?.stale ?? false;
  const gone = !systems.has(a) || !systems.has(b);
  const label = laneLabel(named[0], named[1]);
  return (
    <MenuFrame {...frame} label={label}>
      <div className="context-menu-header">{label}</div>
      <MenuItem
        disabled={gone}
        title={gone ? LANE_GONE : undefined}
        run={() => applySymmetric({ type: "RemoveLane", a, b })}
      >
        Cut
      </MenuItem>
      {canPrevent && (
        <MenuItem
          disabled={gone}
          title={gone ? LANE_GONE : undefined}
          run={() => preventLanes([[a, b]])}
        >
          Cut and prevent
        </MenuItem>
      )}
      {canReset && (
        <MenuItem run={() => applyOp({ type: "NormaliseLaneLength", a, b })}>Reset length</MenuItem>
      )}
    </MenuFrame>
  );
}
