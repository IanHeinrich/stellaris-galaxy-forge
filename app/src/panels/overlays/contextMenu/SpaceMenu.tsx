import { newSystemRows } from "../../../lib/initializer/initializerBrowser";
import { ALL_CLANS_PLACED, nextFreeClan } from "../../../lib/marauder";
import { useSystemNames } from "../../../store/browserRows";
import { nearestSystem, useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import {
  lastUsed,
  spawnWeightFor,
  useInitializerBrowserStore,
} from "../../../store/initializerBrowserStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { createSystemFrom, NEEDS_GAME_DATA } from "../../initializers/entry";
import { AddSystemItems } from "./AddSystemItems";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";
import { NO_SYSTEMS, useCanCreate, useCanNebulae, useZones } from "./menuState";

/** The menu on empty space: what can be placed at the point right-clicked. */
export function SpaceMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "space" }>;
  frame: Frame;
}) {
  const addSystemAt = useEditorStore((s) => s.addSystemAt);
  const addMarauderClanAt = useEditorStore((s) => s.addMarauderClanAt);
  const promptNebulaAt = useEditorStore((s) => s.promptNebulaAt);
  const addFeZoneAt = useEditorStore((s) => s.addFeZoneAt);
  const systems = useGalaxyStore((s) => s.systems);
  const canCreate = useCanCreate();
  const canNebulae = useCanNebulae();
  const save = useFileSessionStore((s) => s.kind === "save");
  const zones = useZones();
  const anchor = nearestSystem(target, systems.values());
  const [anchorName] = useSystemNames(anchor ? [anchor.id] : NO_SYSTEMS);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const defaultKey = useInitializerBrowserStore((s) => s.defaultKey);
  useInitializerBrowserStore((s) => s.recent);

  if (!canCreate && !canNebulae && !save) return null;
  const freeClan = canCreate ? nextFreeClan(systems) : null;
  return (
    <MenuFrame {...frame} label="Empty space">
      {save && <AddSystemItems x={target.x} y={target.y} />}
      {canCreate &&
        newSystemRows(defaultKey, lastUsed()).map((row) => (
          <MenuItem
            key={row.label}
            className="menu-item"
            run={() => addSystemAt(target.x, target.y, row.key, spawnWeightFor(row.key))}
          >
            {row.label}
            <span className="count">{row.detail}</span>
          </MenuItem>
        ))}
      {canCreate && (
        <MenuItem
          className="menu-item"
          disabled={!gameData}
          title={gameData ? undefined : NEEDS_GAME_DATA}
          run={() => createSystemFrom(target.x, target.y)}
        >
          New system from…
        </MenuItem>
      )}
      {canNebulae && (
        <MenuItem
          className={canCreate || save ? "menu-item context-menu-separated" : "menu-item"}
          run={() => promptNebulaAt(target.x, target.y)}
        >
          New nebula here
        </MenuItem>
      )}
      {zones && (
        <MenuItem
          className="menu-item context-menu-separated"
          run={() => addFeZoneAt({ x: target.x, y: target.y })}
        >
          Add fallen empire zone{anchorName !== undefined && `, anchored to ${anchorName}`}
        </MenuItem>
      )}
      {canCreate && (
        <MenuItem
          className="menu-item context-menu-separated"
          disabled={freeClan === null}
          title={freeClan === null ? ALL_CLANS_PLACED : undefined}
          run={() => addMarauderClanAt({ x: target.x, y: target.y })}
        >
          Add marauder clan here
        </MenuItem>
      )}
    </MenuFrame>
  );
}
