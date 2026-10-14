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
