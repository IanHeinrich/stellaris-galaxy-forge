import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { confirmRemoveNebula } from "../inspector/nebula";
import "./chrome.css";
import { Menu, MenuItem } from "./Menu";

/** Every edit command, for the open menu: `dismiss` closes it once a command is taken. */
export function EditMenuItems({ dismiss }: { dismiss: () => void }) {
  const history = useEditorStore((s) => s.history);
  const selectedLane = useEditorStore((s) => s.selectedLane);
  const selectedNebula = useEditorStore((s) => s.selectedNebula);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const selectAll = useEditorStore((s) => s.selectAll);
  const deleteSelection = useEditorStore((s) => s.deleteSelection);
  const undoEntry = history.undo[history.undo.length - 1];
  const redoEntry = history.redo[0];

  const run = (action: () => Promise<void>) => () => {
    dismiss();
    void action();
  };
  return (
    <>
      <MenuItem
        label="Undo"
        shortcut="Ctrl Z"
        disabled={!undoEntry}
        title={undoEntry ? `Undo ${undoEntry.description}` : undefined}
        onClick={run(undo)}
      />
      <MenuItem
        label="Redo"
        shortcut="Ctrl Y"
        disabled={!redoEntry}
        title={redoEntry ? `Redo ${redoEntry.description}` : undefined}
        onClick={run(redo)}
      />
      <div className="menu-rule" />
      <MenuItem label="Select all" shortcut="Ctrl A" onClick={run(selectAll)} />
      <MenuItem
        label="Delete"
        shortcut="Del"
        disabled={selectedLane === null && selectedNebula === null}
        onClick={run(() =>
          selectedNebula === null ? deleteSelection() : confirmRemoveNebula(selectedNebula),
        )}
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
