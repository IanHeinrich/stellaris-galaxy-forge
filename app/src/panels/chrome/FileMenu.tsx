import { fileName } from "../../lib/paths";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useRecentsStore, type RecentDoc } from "../../store/recentsStore";
import { formatWhen } from "../file/launchData";
import "./chrome.css";
import { Menu, MenuItem } from "./Menu";

const RECENT = 4;

/** The documents opened last, either kind, straight back to the file. */
function RecentDocs({ onOpen }: { onOpen: (doc: RecentDoc) => void }) {
  const recents = useRecentsStore((s) => s.recents);
  if (recents.length === 0) return null;
  const shown = [...recents].sort((a, b) => b.openedAt - a.openedAt).slice(0, RECENT);

  return (
    <>
      <div className="menu-section">Open recent</div>
      {shown.map((doc) => (
        <button
          key={doc.path}
          type="button"
          role="menuitem"
          className="menu-item"
          title={`${doc.path}
${doc.subtitle}`}
          onClick={() => onOpen(doc)}
        >
          <span className="menu-file">{doc.title || fileName(doc.path)}</span>
          <span className="menu-detail muted">
            {doc.kind === "save" ? "save" : "scenario"} · {formatWhen(doc.openedAt / 1000)}
          </span>
        </button>
      ))}
      <div className="menu-rule" />
    </>
  );
}

/** The one place for file actions: open, reload, save, save as and close. */
export function FileMenu() {
  const status = useFileSessionStore((s) => s.status);
  const dirty = useFileSessionStore((s) => s.dirty);
  const saving = useFileSessionStore((s) => s.saving);
  const requestOpen = useFileSessionStore((s) => s.requestOpen);
  const reload = useFileSessionStore((s) => s.reload);
  const save = useFileSessionStore((s) => s.save);
  const saveAs = useFileSessionStore((s) => s.saveAs);
  const close = useFileSessionStore((s) => s.close);
  const exportScenario = useFileSessionStore((s) => s.exportScenario);
  const pickAndOpen = useFileSessionStore((s) => s.pickAndOpen);
  const kind = useFileSessionStore((s) => s.kind);
  const showOpenDialog = useLayoutStore((s) => s.showOpenDialog);
  const showScenarioDialog = useLayoutStore((s) => s.showScenarioDialog);
  const startup = useGameDataStore((s) => s.startup);
  const open = status === "ready";

  return (
    <Menu label="File" disabled={saving || startup === "setup"}>
      {(dismiss) => {
        const run = (action: () => Promise<void>) => () => {
          dismiss();
          void action();
        };
        return (
          <>
            <RecentDocs
              onOpen={(doc) => {
                dismiss();
                void requestOpen(doc.path);
              }}
            />
            <MenuItem
              label="New scenario…"
              onClick={() => {
                dismiss();
                showScenarioDialog();
              }}
            />
            <MenuItem
              label="Open…"
              shortcut="Ctrl O"
              onClick={() => {
                dismiss();
                showOpenDialog();
              }}
            />
            <MenuItem label="Reload from disk" disabled={!open} onClick={run(reload)} />
            <div className="menu-rule" />
            <MenuItem
              label="Save"
              shortcut="Ctrl S"
              disabled={!open || !dirty}
              onClick={run(save)}
            />
            <MenuItem label="Save as…" shortcut="Ctrl ⇧ S" disabled={!open} onClick={run(saveAs)} />
            <MenuItem
              label="Export as scenario…"
              disabled={!open || kind !== "save"}
              onClick={run(exportScenario)}
            />
            <MenuItem label="Open save as scenario…" onClick={run(() => pickAndOpen("scenario"))} />
            <MenuItem label="Close" shortcut="Ctrl W" disabled={!open} onClick={run(close)} />
          </>
        );
      }}
    </Menu>
  );
}
