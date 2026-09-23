import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { phaseLabel } from "./launchData";
import { OpenSave } from "./OpenSave";
import { Setup } from "./Setup";
import "./open.css";

function StartScreen({ label, fraction }: { label: string; fraction: number | null }) {
  return (
    <div className="launch">
      <div className="start-card">
        <div className="progress-label">{label}</div>
        {fraction !== null && (
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The line the welcome screen carries whenever game data is not loaded. */
function GameDataLine() {
  const status = useGameDataStore((s) => s.status);
  const autoLoad = useGameDataStore((s) => s.autoLoad);
  const progress = useGameDataStore((s) => s.progress);
  const error = useGameDataStore((s) => s.error);
  const setAutoLoad = useGameDataStore((s) => s.setAutoLoad);
  const load = useGameDataStore((s) => s.load);

  if (status === "loading") {
    return <div className="welcome-gamedata muted">Loading game data · {phaseLabel(progress)}</div>;
  }

  const atStart = (on: boolean) => {
    setAutoLoad(on ? "on" : "off");
    if (on) void load();
  };

  return (
    <div className="welcome-gamedata muted">
      {status === "error" ? (
        <span className="warn" title={error ?? undefined}>
          Game data unavailable
        </span>
      ) : (
        <span>Game data is off</span>
      )}
      <label>
        <input
          type="checkbox"
          checked={autoLoad === "on"}
          onChange={(e) => atStart(e.currentTarget.checked)}
        />
        <span>Load at start</span>
      </label>
      <button type="button" className="link" onClick={() => void load()}>
        Load now
      </button>
    </div>
  );
}

/** What fills the map area while no save is open: setup card, start screen or welcome screen. */
export function Launch() {
  const startup = useGameDataStore((s) => s.startup);
  const startupLoad = useGameDataStore((s) => s.startupLoad);
  const gameData = useGameDataStore((s) => s.status);
  const autoLoad = useGameDataStore((s) => s.autoLoad);
  const progress = useGameDataStore((s) => s.progress);
  const status = useFileSessionStore((s) => s.status);

  if (startup === "pending") return <StartScreen label="Starting…" fraction={null} />;
  if (startup === "setup" || (autoLoad === "on" && gameData === "error")) return <Setup />;
  if (startupLoad && status === "empty") {
    return (
      <StartScreen
        label={`Loading game data · ${phaseLabel(progress)}`}
        fraction={progress?.fraction ?? 0}
      />
    );
  }
  return <OpenSave footnote={gameData !== "ready" && <GameDataLine />} />;
}
