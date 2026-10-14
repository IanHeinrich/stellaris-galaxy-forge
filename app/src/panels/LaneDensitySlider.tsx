import { TOOL_OPTIONS } from "../lib/toolCopy";
import { useMapChromeStore } from "../store/mapChromeStore";

/** The Lane density of a mesh or a brush, from a tree with no loops to every Delaunay neighbour. */
export function LaneDensitySlider({
  label,
  disabled,
  onFocus,
  onBlur,
}: {
  label: string;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const laneDensity = useMapChromeStore((s) => s.laneDensity);
  const setLaneDensity = useMapChromeStore((s) => s.setLaneDensity);
  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={laneDensity}
      disabled={disabled}
      onChange={(e) => setLaneDensity(Number(e.target.value))}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-label={label}
    />
  );
}

/** Whether the lanes a brush or the selection's mesh adds are grouped into islands as the game does. */
export function LaneIslandsCheckbox({ className }: { className: string }) {
  const laneIslands = useMapChromeStore((s) => s.laneIslands);
  const setLaneIslands = useMapChromeStore((s) => s.setLaneIslands);
  const { label, hint } = TOOL_OPTIONS.laneIslands;
  return (
    <label className={className} title={hint}>
      <input
        type="checkbox"
        checked={laneIslands}
        onChange={(e) => setLaneIslands(e.target.checked)}
      />
      {label}
    </label>
  );
}
