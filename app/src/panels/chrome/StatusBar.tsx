import type { ExportResult } from "../../generated/ExportResult";
import type { SystemDetails } from "../../generated/SystemDetails";
import { bodyName } from "../../lib/details/labels";
import { systemLayout } from "../../lib/details/orbits";
import { isStarBody } from "../../lib/details/starBody";
import { shortcutLabel } from "../../lib/keys";
import { nodeName, type Names } from "../../lib/names";
import { CLOUD_TITLE } from "../../lib/sessionCopy";
import { counted } from "../../lib/text";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyVersion, useSystemNames } from "../../store/browserRows";
import { useDetailsStore } from "../../store/detailsStore";
import { galaxyLaneCount, useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useFreshIssues } from "../../store/issuesStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useSceneStore } from "../../store/sceneStore";
import { GameDataPanel } from "./GameDataPanel";

const DOCUMENT_KIND: Record<string, string> = {
  save: "save",
  scenario: "static galaxy scenario",
};

const IDLE_HINT =
  `middle-drag to pan · wheel to zoom · WASD/arrows · ${shortcutLabel("fit")} to fit · ` +
  `${shortcutLabel("fitSelection")} fits the selection · ${shortcutLabel("focusSearch")} to search`;

const DELETE_KEY = shortcutLabel("deleteSelection");

const LEAVE_HINT = `${shortcutLabel("clearSelection")} back to galaxy`;

/** `14:02`: when the save landed, by the clock the user reads. */
function clockTime(at: number): string {
  const when = new Date(at);
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
}

/** The backup the export set aside and what it left out, a line each; nothing when neither. */
function exportedTitle({ save, report }: ExportResult): string | undefined {
  const lines: string[] = [];
  if (save.backup_path !== null) lines.push(`Backup: ${save.backup_path}`);
  const dropped = report.dropped_summary ?? null;
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
  const lanes = galaxyLaneCount(systems);
  return (
    <span>
      {systems.size} systems · {lanes} lanes · {counted(galaxy.components, "component")}
    </span>
  );
}

function IssueBadge() {
  const { fresh, errors } = useFreshIssues();
  const setTab = useLayoutStore((s) => s.setTab);
  if (fresh.length === 0) return null;
  return (
    <button
      type="button"
      className={errors > 0 ? "badge warn" : "badge"}
      title={`Since this save was opened: ${errors} errors, ${fresh.length - errors} warnings`}
      onClick={() => setTab("issues")}
    >
      ⚠ {counted(fresh.length, "issue")}
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

/** The system shown, with its bodies and belts once its details are in. */
function SceneSelected({ system }: { system: number }) {
  const [name] = useSystemNames([system]);
  const details = useDetailsStore((s) => s.details.get(system));
  if (!details) return <span className="accent">{name}</span>;
  return (
    <span className="accent">
      {name} · {counted(details.planets.length, "body", "bodies")} ·{" "}
      {counted(details.belts.length, "belt")}
    </span>
  );
}

function Selected() {
  const shown = useSceneStore((s) => (s.scene.kind === "system" ? s.scene.id : null));
  const selection = useEditorStore((s) => s.selection);
  const selectedLane = useEditorStore((s) => s.selectedLane);
  const selectedNebula = useEditorStore((s) => s.selectedNebula);
  const nebulae = useGalaxyStore((s) => s.nebulae);
  const named = useSystemNames(
    selectedLane ? [selectedLane.a, selectedLane.b] : selection.slice(0, 1),
  );
  if (shown !== null) return <SceneSelected system={shown} />;
  if (selectedNebula !== null) {
    const nebula = nebulae[selectedNebula];
    if (!nebula) return null;
    return (
      <span className="accent">
        {nodeName(nebula.name)} selected · {counted(nebula.systems.length, "system")}
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

/** `Sol III · orbit 45 · angle 212°` for body `id`, or null when the details do not place it. */
function bodyReadout(
  details: SystemDetails,
  id: number,
  names: Names,
  isStar: (planetClass: string) => boolean,
): string | null {
  const planet = details.planets.find((p) => p.id === id);
  const placed = systemLayout(details, isStar).bodies.find((b) => b.id === id);
  if (!planet || !placed) return null;
  const name = bodyName(planet, names);
  if (placed.ring === null) return name;
  const orbit = Math.round(placed.ring.radius);
  return `${name} · orbit ${orbit} · angle ${Math.round(placed.angle) % 360}°`;
}

/**
 * The system view's hint: what the scene says (a clicked lane), else the page's body where it is
 * one of the system's, else the way out.
 */
function SceneHint({ system }: { system: number }) {
  const details = useDetailsStore((s) => s.details.get(system));
  const reading = useDetailsStore(
    (s) => !s.details.has(system) && !s.missing.has(system) && !s.failed.has(system),
  );
  const top = useInspectorStore((s) => s.stack[s.stack.length - 1]);
  const names = useGameDataStore((s) => s.names);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const sceneHint = useMapChromeStore((s) => s.sceneHint);
  if (reading) return <span className="muted">Reading the system…</span>;
  if (sceneHint !== null) return <span className="muted">{sceneHint}</span>;
  const isStar = (c: string) => isStarBody(c, planetClasses, starClasses);
  const body =
    details && top?.ref.kind === "planet" ? bodyReadout(details, top.ref.id, names, isStar) : null;
  return <span className="muted">{body ?? LEAVE_HINT}</span>;
}

function Hint() {
  const shown = useSceneStore((s) => (s.scene.kind === "system" ? s.scene.id : null));
  const hover = useEditorStore((s) => s.hover);
  const selectedLane = useEditorStore((s) => s.selectedLane);
  const selectedNebula = useEditorStore((s) => s.selectedNebula);
  const gesture = useMapChromeStore((s) => s.gesture);
  if (gesture === "connecting") {
    return <span className="muted">release on a system to connect</span>;
  }
  if (shown !== null && gesture === null) return <SceneHint system={shown} />;
  if (hover !== null) {
    return <span className="muted">drag to move · drag ring to connect · Shift+click to add</span>;
  }
  if (gesture === "lane") return <span className="muted">click to inspect</span>;
  if (selectedNebula !== null) {
    return (
      <span className="muted">
        drag the centre to move · drag the ring to resize · {DELETE_KEY} to remove
      </span>
    );
  }
  if (selectedLane) {
    return <span className="muted">{DELETE_KEY} to cut · right-click for more</span>;
  }
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
