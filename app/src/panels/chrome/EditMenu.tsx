import { documentCapabilities } from "../../lib/capabilities";
import { shortcutLabel } from "../../lib/keys";
import { deleteSelected, redo, selectAll, undo } from "../../store/commands";
import { canDelete, nextRedo, nextUndo, useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import "./chrome.css";
import { Menu, MenuItem } from "./Menu";

/** Every edit command, for the open menu: `dismiss` closes it once a command is taken. */
export function EditMenuItems({ dismiss }: { dismiss: () => void }) {
  const undoEntry = useEditorStore(nextUndo);
  const redoEntry = useEditorStore(nextRedo);
  const capabilities = useFileSessionStore(documentCapabilities);
  const held = useGalaxyStore((s) => s.systems);
  const deletable = useEditorStore((s) => canDelete(s, capabilities, held));

  return (
    <>
      <MenuItem
        label="Undo"
        shortcut={shortcutLabel("undo")}
        disabled={!undoEntry}
        title={undoEntry ? `Undo ${undoEntry.description}` : undefined}
        dismiss={dismiss}
        onClick={undo}
      />
      <MenuItem
        label="Redo"
        shortcut={shortcutLabel("redo")}
        disabled={!redoEntry}
        title={redoEntry ? `Redo ${redoEntry.description}` : undefined}
        dismiss={dismiss}
        onClick={redo}
      />
      <div className="menu-rule" />
      <MenuItem
        label="Select all"
        shortcut={shortcutLabel("selectAll")}
        dismiss={dismiss}
        onClick={selectAll}
      />
      <MenuItem
        label="Delete"
        shortcut={shortcutLabel("deleteSelection")}
        disabled={!deletable}
        dismiss={dismiss}
        onClick={deleteSelected}
      />
    </>
  );
}

/** Undo, redo, select all and delete, each beside its key. */
export function EditMenu() {
  const ready = useFileSessionStore((s) => s.status === "ready");
  return (
    <Menu label="Edit" disabled={!ready}>
      {(dismiss) => <EditMenuItems dismiss={dismiss} />}
    </Menu>
  );
}
