import type { ExportResult } from "../../generated/ExportResult";
import { nodeName } from "../../lib/names";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyVersion, useSystemNames } from "../../store/browserRows";
import { laneCount, useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { newIssues, useIssuesStore } from "../../store/issuesStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { systemCount } from "../inspector/nebula";
import { droppedSummary } from "../file/exportReport";
import { CLOUD_TITLE } from "../file/OpenSave";
import { GameDataPanel } from "./GameDataPanel";

const DOCUMENT_KIND: Record<string, string> = {
  save: "save",
  scenario: "static galaxy scenario",
};

const IDLE_HINT =
  "middle-drag to pan · wheel to zoom · WASD/arrows · Home to fit · Shift+F fits the selection · F to search";

/** `14:02`: when the save landed, by the clock the user reads. */
function clockTime(at: number): string {
  const when = new Date(at);
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
}

/** The backup the export set aside and what it left out, a line each; nothing when neither. */
function exportedTitle({ save, report }: ExportResult): string | undefined {
  const lines: string[] = [];
  if (save.backup_path !== null) lines.push(`Backup: ${save.backup_path}`);
  const dropped = droppedSummary(report.dropped);
  if (dropped !== null) lines.push(`Not carried over: ${dropped}`);
  if (report.fallen_empire_zones > 0) {
    lines.push(`Fallen empire zones: ${report.fallen_empire_zones} automatic`);
  }
  return lines.length === 0 ? undefined : lines.join("\n");
}

function Counts() {
  const galaxy = useGalaxyStore((s) => s.galaxy);
  const systems = useGalaxyStore((s) => s.systems);
  useGalaxyVersion();
  if (!galaxy) return null;
  const lanes = laneCount(systems.values());
  return (
    <span>
      {systems.size} systems · {lanes} lanes · {galaxy.components}{" "}
      {galaxy.components === 1 ? "component" : "components"}
    </span>
  );
}

function IssueBadge() {
  const issues = useIssuesStore((s) => s.issues);
  const baseline = useIssuesStore((s) => s.baseline);
  const setTab = useLayoutStore((s) => s.setTab);
  const fresh = newIssues(issues, baseline);
  if (fresh.length === 0) return null;
  const errors = fresh.filter((i) => i.severity === "error").length;
  return (
    <button
      type="button"
      className={errors > 0 ? "badge warn" : "badge"}
      title={`Since this save was opened: ${errors} errors, ${fresh.length - errors} warnings`}
      onClick={() => setTab("issues")}
    >
      ⚠ {fresh.length} {fresh.length === 1 ? "issue" : "issues"}
    </button>
  );
}

/** How often the hot file changed, when the backend counted it. */
function pauseTitle(hotFile: string | null, hotCount: number): string | undefined {
  if (hotFile === null) return undefined;
  if (hotCount === 0) return `${hotFile} changed too often; reloads paused`;
  return `${hotFile} changed ${hotCount} times in a minute; reloads paused`;
}

/** What auto-reload is not doing and why: the breaker with the way back on, or the watcher's reason. */
function AutoReloadBadge() {
  const paused = useGameDataStore((s) => s.autoReloadPaused);
  const hotFile = useGameDataStore((s) => s.hotFile);
  const hotCount = useGameDataStore((s) => s.hotCount);
  const watching = useGameDataStore((s) => s.watching);
  const reason = useGameDataStore((s) => s.watchReason);
  const resume = useGameDataStore((s) => s.resumeAutoReload);
  if (paused) {
    return (
      <span className="badge warn auto-reload" title={pauseTitle(hotFile, hotCount)}>
        ⟳ Auto-reload paused
        <button type="button" className="link" onClick={() => void resume()}>
          Resume
        </button>
      </span>
    );
  }
  if (reason === null) return null;
  return (
    <span className="badge warn auto-reload" title={reason}>
      ⟳ {watching === 0 ? "Auto-reload off" : "Auto-reload incomplete"}
    </span>
  );
}

function Selected() {
  const selection = useEditorStore((s) => s.selection);
  const selectedLane = useEditorStore((s) => s.selectedLane);
  const selectedNebula = useEditorStore((s) => s.selectedNebula);
  const nebulae = useGalaxyStore((s) => s.nebulae);
  const named = useSystemNames(
    selectedLane ? [selectedLane.a, selectedLane.b] : selection.slice(0, 1),
  );
  if (selectedNebula !== null) {
    const nebula = nebulae[selectedNebula];
    if (!nebula) return null;
    return (
      <span className="accent">
        {nodeName(nebula.name)} selected · {systemCount(nebula.systems.length)}
      </span>
    );
  }
  if (selectedLane) {
    return (
      <span className="accent">
        {named[0]} — {named[1]} selected
      </span>
    );
  }
  if (selection.length === 0) return null;
  return (
    <span className="accent">
      {selection.length === 1 ? named[0] : `${selection.length} systems`} selected
    </span>
  );
}

function Hint() {
  const hover = useEditorStore((s) => s.hover);
  const selectedLane = useEditorStore((s) => s.selectedLane);
  const selectedNebula = useEditorStore((s) => s.selectedNebula);
  const gesture = useMapChromeStore((s) => s.gesture);
  if (gesture === "connecting") {
    return <span className="muted">release on a system to connect</span>;
  }
  if (hover !== null) {
    return <span className="muted">drag to move · drag ring to connect · Shift+click to add</span>;
  }
  if (gesture === "lane") return <span className="muted">click to inspect</span>;
  if (selectedNebula !== null) {
    return (
      <span className="muted">
        drag the centre to move · drag the ring to resize · Delete to remove
      </span>
    );
  }
  if (selectedLane) return <span className="muted">Delete to cut · right-click for more</span>;
  return <span className="muted">{IDLE_HINT}</span>;
}

/** Save counts and issues on the left, the selection and its gesture hint in the centre, the file's state and the game data on the right. */
export function StatusBar() {
  const status = useFileSessionStore((s) => s.status);
  const error = useFileSessionStore((s) => s.error);
  const notice = useFileSessionStore((s) => s.notice);
  const dirty = useFileSessionStore((s) => s.dirty);
  const lastSave = useFileSessionStore((s) => s.lastSave);
  const lastExport = useFileSessionStore((s) => s.lastExport);
  const savedAt = useFileSessionStore((s) => s.savedAt);
  const exportedAt = useFileSessionStore((s) => s.exportedAt);
  const cloud = useFileSessionStore((s) => s.cloud);
  const meta = useFileSessionStore((s) => s.meta);
  const kind = useFileSessionStore((s) => s.kind);

  if (status !== "ready") {
    return (
      <footer className="status-bar">
        <span className="muted">{status === "loading" ? "Opening…" : "No save open"}</span>
        <AutoReloadBadge />
        <span className="spacer" />
        <span className="muted">{IDLE_HINT}</span>
        <span className="spacer" />
        <GameDataPanel />
      </footer>
    );
  }
  return (
    <footer className="status-bar">
      <Counts />
      <IssueBadge />
      <AutoReloadBadge />
      {error && <span className="warn">{error}</span>}
      {!error && notice && <span className="muted">{notice}</span>}
      <span className="spacer" />
      <Selected />
      <Hint />
      <span className="spacer" />
      {cloud && (
        <span className="warn" title={CLOUD_TITLE}>
          ☁ Steam Cloud
        </span>
      )}
      {!dirty && lastSave && savedAt !== null && (
        <span
          className="muted"
          title={lastSave.backup_path === null ? undefined : `Backup: ${lastSave.backup_path}`}
        >
          Saved {clockTime(savedAt)}
        </span>
      )}
      {lastExport && exportedAt !== null && (
        <span className="muted" title={exportedTitle(lastExport)}>
          Exported {clockTime(exportedAt)}
        </span>
      )}
      <span className="muted">
        {meta ? `${meta.date} · ${meta.version}` : DOCUMENT_KIND[kind ?? "save"]}
      </span>
      <GameDataPanel />
    </footer>
  );
}
