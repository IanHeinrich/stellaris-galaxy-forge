import { useEffect, useRef } from "react";
import { documentCapabilities, supports } from "../../lib/capabilities";
import { addFeZoneRefusal } from "../../lib/feZone";
import { newSystemRows } from "../../lib/initializer/initializerBrowser";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore, usePaintLayer } from "../../store/fileSessionStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useSystemNames } from "../../store/browserRows";
import { linkedTo, unlinkedTo, useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import {
  lastUsed,
  spawnWeightFor,
  useInitializerBrowserStore,
} from "../../store/initializerBrowserStore";
import { BulkActions } from "../inspector/selection/BulkActions";
import {
  NEEDS_INITIALIZER,
  spawnPointsOp,
  spawnTargets,
} from "../inspector/system/sections/scenario/spawnPoint";
import { confirmRemoveNebula, focusNebulaRadius, nebulaLabel } from "../inspector/nebula";
import { browseInitializers, createSystemFrom, NEEDS_GAME_DATA } from "../initializers/entry";
import "./overlays.css";

const NO_SYSTEMS: number[] = [];

/** Why a lane the galaxy no longer holds cannot be cut, shown on hover. */
const LANE_GONE = "One of this lane's systems is no longer in the galaxy.";

function itemsOf(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
}

/** The gesture model's right-click menu (ADR 0003), anchored in `.map-area` pixels. */
export function ContextMenu() {
  const contextMenu = useMapChromeStore((s) => s.contextMenu);
  const closeContextMenu = useMapChromeStore((s) => s.closeContextMenu);
  const applyOp = useEditorStore((s) => s.applyOp);
  const selection = useEditorStore((s) => s.selection);
  const connectSelectedTo = useEditorStore((s) => s.connectSelectedTo);
  const cutLanesToSelected = useEditorStore((s) => s.cutLanesToSelected);
  const addSystemAt = useEditorStore((s) => s.addSystemAt);
  const promptNebulaAt = useEditorStore((s) => s.promptNebulaAt);
  const selectNebula = useEditorStore((s) => s.selectNebula);
  const removeSystem = useEditorStore((s) => s.removeSystem);
  const select = useEditorStore((s) => s.select);
  const setFeZone = useEditorStore((s) => s.setFeZone);
  const addFeZone = useEditorStore((s) => s.addFeZone);
  const addFeZoneAt = useEditorStore((s) => s.addFeZoneAt);
  const recomputeFeZones = useEditorStore((s) => s.recomputeFeZones);
  const capabilities = useFileSessionStore((s) => s.capabilities);
  const paint = usePaintLayer();
  const systems = useGalaxyStore((s) => s.systems);
  const menuTarget = contextMenu?.target;
  const named = useSystemNames(
    menuTarget?.kind === "system"
      ? [menuTarget.id]
      : menuTarget?.kind === "feZone"
        ? [menuTarget.anchor]
        : menuTarget?.kind === "lane"
          ? [menuTarget.lane.a, menuTarget.lane.b]
          : NO_SYSTEMS,
  );
  const gameData = useGameDataStore((s) => s.status === "ready");
  const defaultKey = useInitializerBrowserStore((s) => s.defaultKey);
  useInitializerBrowserStore((s) => s.recent);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    itemsOf(ref.current)[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeContextMenu();
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [contextMenu, closeContextMenu]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = itemsOf(ref.current);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => {
      e.preventDefault();
      items[(index + items.length) % items.length].focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at <= 0 ? items.length - 1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
  };

  if (!contextMenu) return null;
  const { target } = contextMenu;
  const canCreate = supports(documentCapabilities({ capabilities }), "create_systems");
  const canNebulae = supports(documentCapabilities({ capabilities }), "nebulae");
  const zones = canCreate && paint;

  if (target.kind === "space") {
    if (!canCreate && !canNebulae) return null;
    return (
      <div
        ref={ref}
        className="context-menu"
        role="menu"
        aria-label="Empty space"
        onKeyDown={onKeyDown}
        style={{ left: contextMenu.x, top: contextMenu.y }}
      >
        {canCreate &&
          newSystemRows(defaultKey, lastUsed()).map((row) => (
            <button
              key={row.label}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                void addSystemAt(target.x, target.y, row.key, spawnWeightFor(row.key));
                closeContextMenu();
              }}
            >
              {row.label}
              <span className="count">{row.detail}</span>
            </button>
          ))}
        {canCreate && (
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={!gameData}
            title={gameData ? undefined : NEEDS_GAME_DATA}
            onClick={() => {
              createSystemFrom(target.x, target.y);
              closeContextMenu();
            }}
          >
            New system from…
          </button>
        )}
        {canNebulae && (
          <button
            type="button"
            role="menuitem"
            className={canCreate ? "menu-item context-menu-separated" : "menu-item"}
            onClick={() => {
              promptNebulaAt(target.x, target.y);
              closeContextMenu();
            }}
          >
            New nebula here
          </button>
        )}
        {zones && (
          <>
            <button
              type="button"
              role="menuitem"
              className="menu-item context-menu-separated"
              onClick={() => {
                void addFeZoneAt({ x: target.x, y: target.y });
                closeContextMenu();
              }}
            >
              Fallen empire zone here
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                void recomputeFeZones();
                closeContextMenu();
              }}
            >
              Recompute automatic fallen empire zones
            </button>
          </>
        )}
      </div>
    );
  }

  if (target.kind === "system") {
    const system = systems.get(target.id);
    const name = named[0];
    const inSelection = selection.includes(target.id);
    const canIsolate = (system?.lanes.length ?? 0) > 0;
    const connectable = unlinkedTo(systems, target.id, selection).length;
    const cuttable = linkedTo(systems, target.id, selection).length;
    const initializerTargets = selection.length > 1 && inSelection ? selection : [target.id];
    // Only a system with an initializer can carry a weight, so a mixed selection weighs the rest.
    const weighable = spawnTargets(initializerTargets, systems, paint);
    const weighted =
      weighable.length > 0 &&
      weighable.every((s) => s.spawn_weight !== null || s.spawn_script !== null);
    const zoneRefusal = system === undefined ? null : addFeZoneRefusal(system, systems);
    return (
      <div
        ref={ref}
        className="context-menu"
        role="menu"
        aria-label={name}
        onKeyDown={onKeyDown}
        style={{ left: contextMenu.x, top: contextMenu.y }}
      >
        <div className="context-menu-header">{name}</div>
        {selection.length > 1 && inSelection ? (
          <BulkActions afterRun={closeContextMenu} itemRole="menuitem" />
        ) : (
          <>
            <button
              type="button"
              role="menuitem"
              disabled={!canIsolate}
              onClick={() => {
                void applyOp({ type: "IsolateSystem", id: target.id });
                closeContextMenu();
              }}
            >
              Isolate
            </button>
            {selection.length > 0 && !inSelection && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  disabled={connectable === 0}
                  onClick={() => {
                    void connectSelectedTo(target.id);
                    closeContextMenu();
                  }}
                >
                  Connect selected to {name} ({connectable})
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={cuttable === 0}
                  onClick={() => {
                    void cutLanesToSelected(target.id);
                    closeContextMenu();
                  }}
                >
                  Cut hyperlanes to selected ({cuttable})
                </button>
              </>
            )}
          </>
        )}
        {canCreate && (
          <button
            type="button"
            role="menuitem"
            disabled={!gameData}
            title={gameData ? undefined : NEEDS_GAME_DATA}
            onClick={() => {
              browseInitializers(initializerTargets);
              closeContextMenu();
            }}
          >
            Set initializer…
            {initializerTargets.length > 1 && ` (${initializerTargets.length} systems)`}
          </button>
        )}
        {canCreate && (
          <button
            type="button"
            role="menuitem"
            disabled={weighable.length === 0}
            title={weighable.length === 0 ? NEEDS_INITIALIZER : undefined}
            onClick={() => {
              const op = spawnPointsOp(initializerTargets, systems, !weighted, paint);
              if (op !== null) void applyOp(op);
              closeContextMenu();
            }}
          >
            {weighted ? "Remove spawn point" : "Set as spawn point"}
            {weighable.length > 1 && ` (${weighable.length} systems)`}
          </button>
        )}
        {zones && (
          <button
            type="button"
            role="menuitem"
            disabled={zoneRefusal !== null}
            title={zoneRefusal ?? undefined}
            onClick={() => {
              void addFeZone(target.id);
              closeContextMenu();
            }}
          >
            Add fallen empire zone
          </button>
        )}
        {canCreate && (
          <button
            type="button"
            role="menuitem"
            className="context-menu-separated"
            onClick={() => {
              void removeSystem(target.id);
              closeContextMenu();
            }}
          >
            Delete system
          </button>
        )}
      </div>
    );
  }

  if (target.kind === "nebula") {
    const name = nebulaLabel(target.index);
    return (
      <div
        ref={ref}
        className="context-menu"
        role="menu"
        aria-label={name}
        onKeyDown={onKeyDown}
        style={{ left: contextMenu.x, top: contextMenu.y }}
      >
        <div className="context-menu-header">{name}</div>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            selectNebula(target.index);
            focusNebulaRadius();
            closeContextMenu();
          }}
        >
          Set radius…
        </button>
        <button
          type="button"
          role="menuitem"
          className="context-menu-separated"
          onClick={() => {
            closeContextMenu();
            void confirmRemoveNebula(target.index);
          }}
        >
          Delete nebula
        </button>
      </div>
    );
  }

  if (target.kind === "feZone") {
    const name = named[0];
    return (
      <div
        ref={ref}
        className="context-menu"
        role="menu"
        aria-label={`Fallen empire zone of ${name}`}
        onKeyDown={onKeyDown}
        style={{ left: contextMenu.x, top: contextMenu.y }}
      >
        <div className="context-menu-header">Fallen empire zone</div>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            void setFeZone(target.anchor, null);
            closeContextMenu();
          }}
        >
          Remove fallen empire zone
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            void select(target.anchor);
            closeContextMenu();
          }}
        >
          Select {name}
        </button>
      </div>
    );
  }

  const { a, b } = target.lane;
  const lane = systems.get(a)?.lanes.find((l) => l.to === b);
  const canReset = lane?.stale ?? false;
  const gone = !systems.has(a) || !systems.has(b);

  const laneLabel = `${named[0]} — ${named[1]}`;

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={laneLabel}
      onKeyDown={onKeyDown}
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      <div className="context-menu-header">{laneLabel}</div>
      <button
        type="button"
        role="menuitem"
        disabled={gone}
        title={gone ? LANE_GONE : undefined}
        onClick={() => {
          void applyOp({ type: "RemoveLane", a, b });
          closeContextMenu();
        }}
      >
        Cut
      </button>
      {canReset && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            void applyOp({ type: "NormaliseLaneLength", a, b });
            closeContextMenu();
          }}
        >
          Reset length
        </button>
      )}
    </div>
  );
}
