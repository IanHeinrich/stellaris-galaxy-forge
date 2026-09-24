import { linkToZoneLabel } from "../../../lib/feLinks";
import { addFeZoneRefusal } from "../../../lib/feZone";
import { clanOf, REMOVE_CLAN_HINT } from "../../../lib/marauder";
import { useSystemNames } from "../../../store/browserRows";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore, usePaintLayer } from "../../../store/fileSessionStore";
import {
  linkedTo,
  preventedTo,
  unlinkedTo,
  unpreventedTo,
  useGalaxyStore,
} from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useMapChromeStore, type ContextTarget } from "../../../store/mapChromeStore";
import { browseInitializers, NEEDS_GAME_DATA } from "../../initializers/entry";
import {
  BulkActions,
  MarauderClanButton,
  WormholePairButton,
} from "../../inspector/selection/BulkActions";
import {
  NEEDS_INITIALIZER,
  spawnPointsOp,
  spawnTargets,
} from "../../inspector/system/sections/scenario/spawnPoint";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";
import { useCanCreate, useSelected, useZoneLink, useZones } from "./menuState";

/** The menu on a system: its lanes to the selection, its scenario roles and its removal. */
export function SystemMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "system" }>;
  frame: Frame;
}) {
  const closeContextMenu = useMapChromeStore((s) => s.closeContextMenu);
  const applySymmetric = useEditorStore((s) => s.applySymmetric);
  const connectSelectedTo = useEditorStore((s) => s.connectSelectedTo);
  const cutLanesToSelected = useEditorStore((s) => s.cutLanesToSelected);
  const preventLanesToSelected = useEditorStore((s) => s.preventLanesToSelected);
  const allowLanesToSelected = useEditorStore((s) => s.allowLanesToSelected);
  const removeMarauderClan = useEditorStore((s) => s.removeMarauderClan);
  const removeSystem = useEditorStore((s) => s.removeSystem);
  const addFeZone = useEditorStore((s) => s.addFeZone);
  const systems = useGalaxyStore((s) => s.systems);
  const paint = usePaintLayer();
  const scenario = useFileSessionStore((s) => s.kind === "scenario");
  const canCreate = useCanCreate();
  const zones = useZones();
  const { selection, selected, selectedName } = useSelected();
  const linkItem = useZoneLink();
  const [name] = useSystemNames([target.id]);
  const gameData = useGameDataStore((s) => s.status === "ready");

  const system = systems.get(target.id);
  const inSelection = selection.includes(target.id);
  const canIsolate = (system?.lanes.length ?? 0) > 0;
  const connectable = unlinkedTo(systems, target.id, selection).length;
  const cuttable = linkedTo(systems, target.id, selection).length;
  const preventable = unpreventedTo(systems, target.id, selection).length;
  const allowable = preventedTo(systems, target.id, selection).length;
  const initializerTargets = selection.length > 1 && inSelection ? selection : [target.id];
  // Only a system with an initializer can carry a weight, so a mixed selection weighs the rest.
  const weighable = spawnTargets(initializerTargets, systems, paint);
  const weighted =
    weighable.length > 0 &&
    weighable.every((s) => s.spawn_weight !== null || s.spawn_script !== null);
  const zoneRefusal = system === undefined ? null : addFeZoneRefusal(system, systems);
  const role = system?.marauder ?? null;
  const clanMembers = inSelection ? selection : selection.length === 0 ? [target.id] : null;
  const clanInBulk = inSelection && selection.length === 3;
  const clanItem = canCreate && role === null && !clanInBulk ? clanMembers : null;
  const link = linkItem(selected, system);
  return (
    <MenuFrame {...frame} label={name}>
      <div className="context-menu-header">{name}</div>
      {selection.length > 1 && inSelection ? (
        <BulkActions afterRun={closeContextMenu} itemRole="menuitem" />
      ) : (
        <>
          <MenuItem
            disabled={!canIsolate}
            run={() => applySymmetric({ type: "IsolateSystem", id: target.id })}
          >
            Isolate
          </MenuItem>
          {zones && selection.length === 2 && inSelection && (
            <WormholePairButton
              a={selection[0]}
              b={selection[1]}
              afterRun={closeContextMenu}
              itemRole="menuitem"
            />
          )}
          {selection.length > 0 && !inSelection && (
            <>
              <MenuItem disabled={connectable === 0} run={() => connectSelectedTo(target.id)}>
                Connect selected to {name} ({connectable})
              </MenuItem>
              <MenuItem disabled={cuttable === 0} run={() => cutLanesToSelected(target.id)}>
                Cut hyperlanes to selected ({cuttable})
              </MenuItem>
              {scenario && (
                <>
                  <MenuItem
                    disabled={preventable === 0}
                    run={() => preventLanesToSelected(target.id)}
                  >
                    Prevent lanes to selected ({preventable})
                  </MenuItem>
                  <MenuItem disabled={allowable === 0} run={() => allowLanesToSelected(target.id)}>
                    Allow lanes to selected ({allowable})
                  </MenuItem>
                </>
              )}
            </>
          )}
        </>
      )}
      {canCreate && (
        <MenuItem
          disabled={!gameData}
          title={gameData ? undefined : NEEDS_GAME_DATA}
          run={() => browseInitializers(initializerTargets)}
        >
          Set initializer…
          {initializerTargets.length > 1 && ` (${initializerTargets.length} systems)`}
        </MenuItem>
      )}
      {canCreate && (
        <MenuItem
          disabled={weighable.length === 0}
          title={weighable.length === 0 ? NEEDS_INITIALIZER : undefined}
          run={() => {
            const op = spawnPointsOp(initializerTargets, systems, !weighted, paint);
            if (op !== null) void applySymmetric(op);
          }}
        >
          {weighted ? "Remove spawn point" : "Set as spawn point"}
          {weighable.length > 1 && ` (${weighable.length} systems)`}
        </MenuItem>
      )}
      {zones && (
        <MenuItem
          disabled={zoneRefusal !== null}
          title={zoneRefusal ?? undefined}
          run={() => addFeZone(target.id)}
        >
          Add fallen empire zone
        </MenuItem>
      )}
      {link !== null && (
        <MenuItem run={link.run}>{linkToZoneLabel(link.change, selectedName)}</MenuItem>
      )}
      {clanItem !== null && (
        <MarauderClanButton ids={clanItem} afterRun={closeContextMenu} itemRole="menuitem" />
      )}
      {canCreate && role !== null && (
        <MenuItem
          className="hinted"
          title={REMOVE_CLAN_HINT}
          run={() => removeMarauderClan(clanOf(role))}
        >
          Remove marauder clan {clanOf(role)}
          <span className="muted">{REMOVE_CLAN_HINT}</span>
        </MenuItem>
      )}
      {(canCreate || (!scenario && system?.added)) && (
        <MenuItem className="context-menu-separated" run={() => removeSystem(target.id)}>
          Delete system
        </MenuItem>
      )}
    </MenuFrame>
  );
}
