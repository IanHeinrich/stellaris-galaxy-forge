import { shortcutLabel } from "../../lib/keys";
import { fitAll, fitSelected } from "../../store/commands";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import "./chrome.css";
import { Menu, MenuItem } from "./Menu";

/** Every view command, for the open menu: `dismiss` closes it once a command is taken. */
export function ViewMenuItems({ dismiss }: { dismiss: () => void }) {
  const nothingSelected = useEditorStore(
    (s) => s.selection.length === 0 && s.selectedNebula === null,
  );
  const collapsed = useLayoutStore((s) => s.collapsed);
  const toggleDock = useLayoutStore((s) => s.toggleDock);
  const resetLayers = useMapChromeStore((s) => s.resetLayers);

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
