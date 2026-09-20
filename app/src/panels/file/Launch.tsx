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
  return <OpenSave />;
}
