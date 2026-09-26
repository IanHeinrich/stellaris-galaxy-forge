import { bodyName } from "../../../lib/details/labels";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { bodyEntry, useInspectorStore } from "../../../store/inspectorStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { useSceneStore } from "../../../store/sceneStore";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";

/** The menu on a body in the system view: its page, its removal, and the way back out. */
export function BodyMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "body" }>;
  frame: Frame;
}) {
  const leaveSystem = useSceneStore((s) => s.leaveSystem);
  const openFromMap = useInspectorStore((s) => s.openFromMap);
  const planet = useDetailsStore((s) =>
    s.details.get(target.system)?.planets.find((p) => p.id === target.id),
  );
  const names = useGameDataStore((s) => s.names);
  const name = planet === undefined ? undefined : bodyName(planet, names);
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
      <MenuItem disabled run={() => undefined}>
        Remove
      </MenuItem>
      <MenuItem className="context-menu-separated" run={leaveSystem}>
        Back to galaxy
      </MenuItem>
    </MenuFrame>
  );
}
