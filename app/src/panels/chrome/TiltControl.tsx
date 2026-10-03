import type { CSSProperties } from "react";
import { documentCapabilities } from "../../lib/capabilities";
import {
  GAME_DEFAULT_TILT,
  GAME_TILT_RANGE,
  settledTilt,
  TILT_MAX_DEGREES,
  tiltAvailable,
} from "../../lib/visual/tilt";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useBarMode } from "../../store/sceneStore";
import { useToolStore } from "../../store/toolStore";
import "./chrome.css";

/** Whether the galaxy map shown can lean: a save's. */
function useTiltShown(): boolean {
  const galaxy = useBarMode() === "save";
  const ready = useFileSessionStore((s) => s.status === "ready");
  const capabilities = useFileSessionStore(documentCapabilities);
  return galaxy && ready && tiltAvailable(capabilities);
}

/** Where `degrees` falls along the track, from 0 to 1. */
function along(degrees: number): number {
  return degrees / TILT_MAX_DEGREES;
}

const TRACK_MARKS = {
  "--tilt-band-from": along(GAME_TILT_RANGE.min),
  "--tilt-band-to": along(GAME_TILT_RANGE.max),
  "--tilt-game": along(GAME_DEFAULT_TILT),
} as CSSProperties;

/**
 * The Tilt slider at the map's bottom right, with the game's own camera range shaded on its track
 * and its default angle marked.
 */
export function TiltControl() {
  const shown = useTiltShown();
  const tilt = useToolStore((s) => s.tilt);
  const setTilt = useToolStore((s) => s.setTilt);
  if (!shown) return null;
  const settle = () => setTilt(settledTilt(useToolStore.getState().tilt));
  return (
    <div className="tilt-control">
      <label className="tilt-slider" title="Double-click to lay the map flat">
        Tilt
        <span className="tilt-track" style={TRACK_MARKS}>
          <span className="tilt-band" aria-hidden="true" />
          <span className="tilt-game" title="Stellaris's default camera angle">
            Stellaris
          </span>
          <input
            type="range"
            min={0}
            max={TILT_MAX_DEGREES}
            step={1}
            value={tilt}
            onChange={(e) => setTilt(Number(e.target.value))}
            onPointerUp={settle}
            onKeyUp={settle}
            onDoubleClick={() => setTilt(0)}
            aria-label="Tilt"
          />
        </span>
        <span className="tilt-value">{tilt}°</span>
      </label>
    </div>
  );
}
