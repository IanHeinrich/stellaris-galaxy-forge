import { fileName, isUnder } from "../../lib/paths";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useLayoutStore } from "../../store/layoutStore";
import { usePaintModStore } from "../../store/paintModStore";
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

const SUBSCRIBE_FIRST = "Subscribe to the Paint a Galaxy mod on the Steam Workshop first";

/** Every file action, for the open menu: `dismiss` closes it once a command is taken. */
export function FileMenuItems({ dismiss }: { dismiss: () => void }) {
  const status = useFileSessionStore((s) => s.status);
  const dirty = useFileSessionStore((s) => s.dirty);
  const requestOpen = useFileSessionStore((s) => s.requestOpen);
  const reload = useFileSessionStore((s) => s.reload);
  const save = useFileSessionStore((s) => s.save);
  const saveAs = useFileSessionStore((s) => s.saveAs);
  const close = useFileSessionStore((s) => s.close);
  const exportScenario = useFileSessionStore((s) => s.exportScenario);
  const pickAndOpen = useFileSessionStore((s) => s.pickAndOpen);
  const kind = useFileSessionStore((s) => s.kind);
  const path = useFileSessionStore((s) => s.path);
  const saveIntoPaintMod = useFileSessionStore((s) => s.saveIntoPaintMod);
  const modKnown = usePaintModStore((s) => s.known);
  const paintDir = usePaintModStore((s) => s.paintMod?.scenarios_dir ?? null);
  const showOpenDialog = useLayoutStore((s) => s.showOpenDialog);
  const showScenarioDialog = useLayoutStore((s) => s.showScenarioDialog);
  const open = status === "ready";
  const modMissing = modKnown && paintDir === null;
  const inPaintMod = path !== null && paintDir !== null && isUnder(path, paintDir);

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
      <MenuItem label="Save" shortcut="Ctrl S" disabled={!open || !dirty} onClick={run(save)} />
      <MenuItem label="Save as…" shortcut="Ctrl ⇧ S" disabled={!open} onClick={run(saveAs)} />
      <MenuItem
        label="Save into the Paint a Galaxy mod…"
        disabled={!open || kind !== "scenario" || paintDir === null || inPaintMod}
        title={modMissing ? SUBSCRIBE_FIRST : undefined}
        onClick={run(saveIntoPaintMod)}
      />
      <MenuItem
        label="Export as scenario…"
        disabled={!open || kind !== "save"}
        onClick={run(exportScenario)}
      />
      <MenuItem label="Open save as scenario…" onClick={run(() => pickAndOpen("scenario"))} />
      <MenuItem label="Close" shortcut="Ctrl W" disabled={!open} onClick={run(close)} />
    </>
  );
}

/** The one place for file actions: open, reload, save, save as, export and close. */
export function FileMenu() {
  const saving = useFileSessionStore((s) => s.saving);
  const startup = useGameDataStore((s) => s.startup);
  return (
    <Menu label="File" disabled={saving || startup === "setup"}>
      {(dismiss) => <FileMenuItems dismiss={dismiss} />}
    </Menu>
  );
}
