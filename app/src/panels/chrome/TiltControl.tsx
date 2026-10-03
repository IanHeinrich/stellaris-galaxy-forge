import { documentCapabilities } from "../../lib/capabilities";
import { TILT_HINT, TILT_MAX_DEGREES, tiltAvailable } from "../../lib/visual/tilt";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useBarMode } from "../../store/sceneStore";
import { useToolStore } from "../../store/toolStore";
import "./chrome.css";

/** Whether the galaxy map shown can lean: a save's, with the Heights layer on. */
function useTiltShown(): boolean {
  const galaxy = useBarMode() === "save";
  const ready = useFileSessionStore((s) => s.status === "ready");
  const capabilities = useFileSessionStore(documentCapabilities);
  const heightsOn = useMapChromeStore((s) => s.layers.heights);
  return galaxy && ready && tiltAvailable(heightsOn, capabilities);
}

/** The Tilt slider at the map's bottom right, and the hint that the leaning map takes no edits. */
export function TiltControl() {
  const shown = useTiltShown();
  const tilt = useToolStore((s) => s.tilt);
  const setTilt = useToolStore((s) => s.setTilt);
  if (!shown) return null;
  return (
    <div className="tilt-control">
      {tilt > 0 && (
        <div className="tilt-hint" role="status">
          {TILT_HINT}
        </div>
      )}
      <label className="tilt-slider" title="Double-click to lay the map flat">
        Tilt
        <input
          type="range"
          min={0}
          max={TILT_MAX_DEGREES}
          step={1}
          value={tilt}
          onChange={(e) => setTilt(Number(e.target.value))}
          onDoubleClick={() => setTilt(0)}
          aria-label="Tilt"
        />
        <span className="tilt-value">{tilt}°</span>
      </label>
    </div>
  );
}
