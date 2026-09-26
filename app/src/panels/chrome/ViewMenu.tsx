import { shortcutLabel } from "../../lib/keys";
import { fitAll, fitSelected, rollAgain } from "../../store/commands";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { canEnterSystem, useSceneStore } from "../../store/sceneStore";
import "./chrome.css";
import { Menu, MenuItem } from "./Menu";
import { ROLL_AGAIN_TITLE } from "./SceneCrumb";

/** Every view command, for the open menu: `dismiss` closes it once a command is taken. */
export function ViewMenuItems({ dismiss }: { dismiss: () => void }) {
  const nothingSelected = useEditorStore(
    (s) => s.selection.length === 0 && s.selectedNebula === null,
  );
  const collapsed = useLayoutStore((s) => s.collapsed);
  const toggleDock = useLayoutStore((s) => s.toggleDock);
  const resetLayers = useMapChromeStore((s) => s.resetLayers);
  const enterable = useFileSessionStore(canEnterSystem);
  const selection = useEditorStore((s) => s.selection);
  const inSystem = useSceneStore((s) => s.scene.kind === "system");
  const enterSystem = useSceneStore((s) => s.enterSystem);
  const leaveSystem = useSceneStore((s) => s.leaveSystem);
  const scenario = useFileSessionStore((s) => s.kind === "scenario");

  return (
    <>
      <MenuItem
        label="Fit all"
        shortcut={shortcutLabel("fit")}
        dismiss={dismiss}
        onClick={fitAll}
      />
      <MenuItem
        label="Fit selection"
        shortcut={shortcutLabel("fitSelection")}
        disabled={nothingSelected}
        dismiss={dismiss}
        onClick={fitSelected}
      />
      {inSystem ? (
        <>
          <MenuItem
            label="Back to galaxy"
            shortcut={shortcutLabel("clearSelection")}
            dismiss={dismiss}
            onClick={leaveSystem}
          />
          {scenario && (
            <MenuItem
              label="Roll again"
              title={ROLL_AGAIN_TITLE}
              dismiss={dismiss}
              onClick={rollAgain}
            />
          )}
        </>
      ) : (
        enterable && (
          <MenuItem
            label="Open system view"
            shortcut={shortcutLabel("toggleSystemView")}
            disabled={selection.length !== 1}
            dismiss={dismiss}
            onClick={() => enterSystem(selection[0])}
          />
        )
      )}
      <div className="menu-rule" />
      <MenuItem
        label={collapsed ? "Show dock" : "Hide dock"}
        shortcut={shortcutLabel("toggleDock")}
        dismiss={dismiss}
        onClick={toggleDock}
      />
      <div className="menu-rule" />
      <MenuItem label="Reset layers to defaults" dismiss={dismiss} onClick={resetLayers} />
    </>
  );
}

/** Framing the map, the dock, and putting the layers back as they started. */
export function ViewMenu() {
  const ready = useFileSessionStore((s) => s.status === "ready");
  return (
    <Menu label="View" disabled={!ready}>
      {(dismiss) => <ViewMenuItems dismiss={dismiss} />}
    </Menu>
  );
}
