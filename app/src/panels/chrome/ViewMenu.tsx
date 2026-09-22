import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import "./chrome.css";
import { Menu, MenuItem } from "./Menu";

/** Every view command, for the open menu: `dismiss` closes it once a command is taken. */
export function ViewMenuItems({ dismiss }: { dismiss: () => void }) {
  const requestFit = useEditorStore((s) => s.requestFit);
  const fitSelection = useEditorStore((s) => s.fitSelection);
  const nothingSelected = useEditorStore(
    (s) => s.selection.length === 0 && s.selectedNebula === null,
  );
  const collapsed = useLayoutStore((s) => s.collapsed);
  const toggleDock = useLayoutStore((s) => s.toggleDock);
  const resetLayers = useMapChromeStore((s) => s.resetLayers);

  const run = (action: () => void) => () => {
    dismiss();
    action();
  };
  return (
    <>
      <MenuItem label="Fit all" shortcut="Home" onClick={run(requestFit)} />
      <MenuItem
        label="Fit selection"
        shortcut="⇧ F"
        disabled={nothingSelected}
        onClick={run(fitSelection)}
      />
      <div className="menu-rule" />
      <MenuItem
        label={collapsed ? "Show dock" : "Hide dock"}
        shortcut="Tab"
        onClick={run(toggleDock)}
      />
      <div className="menu-rule" />
      <MenuItem label="Reset layers to defaults" onClick={run(resetLayers)} />
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
