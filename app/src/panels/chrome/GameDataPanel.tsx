import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { DiagnosticView } from "../../generated/DiagnosticView";
import type { GameDataSummary } from "../../generated/GameDataSummary";
import type { ModView } from "../../generated/ModView";
import type { Progress } from "../../generated/Progress";
import { counted } from "../../lib/text";
import { useGameDataStore } from "../../store/gameDataStore";
import { FilterField } from "../inspector/parts";
import { phaseLabel } from "../file/launchData";
import "./chrome.css";
import { EyeRow, Menu, MenuItem } from "./Menu";

/** Above this many mods the menu offers a search box. */
const MOD_SEARCH_MIN = 6;

/** How many diagnostics the menu lists before it only counts the rest. */
const DIAGNOSTIC_LIMIT = 20;

function summaryTitle(summary: GameDataSummary): string {
  return `${summary.install} · ${summary.mods.length} mods`;
}

/** What game data could not read or had to pick between, most recent load first. */
function DiagnosticsSection({ diagnostics }: { diagnostics: DiagnosticView[] }) {
  const shown = diagnostics.slice(0, DIAGNOSTIC_LIMIT);
  const rest = diagnostics.length - shown.length;
  return (
    <>
      <div className="menu-section">Diagnostics · {diagnostics.length}</div>
      <div className="menu-list">
        {shown.map((d, i) => (
          <div key={`${d.kind}-${i}`} className="menu-item diag" title={d.message}>
            <span className="muted">{d.kind}</span>
            <span>{d.message}</span>
          </div>
        ))}
      </div>
      {rest > 0 && <div className="menu-note muted">{rest} more</div>}
    </>
  );
}

function ModRow({ mod }: { mod: ModView }) {
  return (
    <div className="menu-item" title={mod.dir ?? undefined}>
      <span>{mod.name}</span>
      <span
        className={mod.status === "missing" ? "warn" : undefined}
        style={{ marginLeft: "auto" }}
      >
        {mod.status}
      </span>
    </div>
  );
}

/** The playset, in load order, filterable once it outgrows the menu. */
function ModsSection({ mods }: { mods: ModView[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle === "" ? mods : mods.filter((m) => m.name.toLowerCase().includes(needle));
  return (
    <>
      <div className="menu-section">Mods · {mods.length}</div>
      {mods.length === 0 ? (
        <div className="menu-note muted">No mods</div>
      ) : (
        <>
          {mods.length > MOD_SEARCH_MIN && (
            <FilterField label={`Filter ${mods.length} mods`} value={query} onChange={setQuery} />
          )}
          <div className="menu-list">
            {filtered.map((mod) => (
              <ModRow key={mod.id} mod={mod} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function pillLabel(
  status: string,
  summary: GameDataSummary | null,
  progress: Progress | null,
): string {
  switch (status) {
    case "loading":
      return `Game data ${phaseLabel(progress)}`;
    case "ready":
      return `Game data ${summary?.version ?? ""} · ${summary?.mods.length ?? 0} mods`;
    case "error":
      return "Game data unavailable";
    default:
      return "Game data off";
  }
}

/** What the auto-reload watcher holds, or that it holds nothing. */
function watchingNote(watching: number): string {
  if (watching === 0) return "Auto-reload off";
  return `Watching ${counted(watching, "folder")}`;
}

/** The status pill at the status bar's right end and its menu: install, reload, unload and the start preference. */
export function GameDataPanel() {
  const status = useGameDataStore((s) => s.status);
  const summary = useGameDataStore((s) => s.summary);
  const error = useGameDataStore((s) => s.error);
  const progress = useGameDataStore((s) => s.progress);
  const autoLoad = useGameDataStore((s) => s.autoLoad);
  const installPath = useGameDataStore((s) => s.installPath);
  const watching = useGameDataStore((s) => s.watching);
  const autoReloadPaused = useGameDataStore((s) => s.autoReloadPaused);
  const resumeAutoReload = useGameDataStore((s) => s.resumeAutoReload);
  const load = useGameDataStore((s) => s.load);
  const unload = useGameDataStore((s) => s.unload);
  const setAutoLoad = useGameDataStore((s) => s.setAutoLoad);

  const locate = async () => {
    const picked = await open({ directory: true, multiple: false, title: "Locate Stellaris" });
    if (typeof picked === "string") await load(picked);
  };

  const install = summary?.install ?? installPath;
  const title = summary ? summaryTitle(summary) : (error ?? undefined);

  return (
    <div className={`game-data-pill ${status}`}>
      <Menu label={pillLabel(status, summary, progress)} title={title} align="right" up>
        {(dismiss) => (
          <>
            <div className="menu-section">Install</div>
            <div className="menu-note">{install ?? "none found yet"}</div>
            {status === "error" && error && <div className="menu-note warn">{error}</div>}
            <div className="menu-rule" />
            {summary && summary.diagnostics.length > 0 && (
              <>
                <DiagnosticsSection diagnostics={summary.diagnostics} />
                <div className="menu-rule" />
              </>
            )}
            {summary && <ModsSection mods={summary.mods} />}
            <div className="menu-rule" />
            <EyeRow
              pressed={autoLoad === "on"}
              onClick={() => setAutoLoad(autoLoad === "on" ? "off" : "on")}
            >
              <span>Load at start</span>
            </EyeRow>
            <div className="menu-rule" />
            {status === "ready" && (
              <div className="menu-note muted">
                {autoReloadPaused ? (
                  <>
                    Auto-reload paused
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        dismiss();
                        void resumeAutoReload();
                      }}
                    >
                      Resume
                    </button>
                  </>
                ) : (
                  watchingNote(watching)
                )}
              </div>
            )}
            <MenuItem
              label={status === "ready" ? "Reload" : "Load now"}
              disabled={status === "loading"}
              dismiss={dismiss}
              onClick={() => load()}
            />
            <MenuItem
              label="Unload"
              disabled={status !== "ready"}
              dismiss={dismiss}
              onClick={unload}
            />
            <MenuItem label="Locate Stellaris…" dismiss={dismiss} onClick={locate} />
          </>
        )}
      </Menu>
    </div>
  );
}
