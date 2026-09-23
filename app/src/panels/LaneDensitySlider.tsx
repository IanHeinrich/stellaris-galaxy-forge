import { betaOfSlider, sliderOfBeta } from "../lib/geometry/mesh";
import { useMapChromeStore } from "../store/mapChromeStore";

/** The β of the lanes a mesh or a brush adds, as a range from sparse to dense. */
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
  const meshBeta = useMapChromeStore((s) => s.meshBeta);
  const setMeshBeta = useMapChromeStore((s) => s.setMeshBeta);
  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={sliderOfBeta(meshBeta)}
      disabled={disabled}
      onChange={(e) => setMeshBeta(betaOfSlider(Number(e.target.value)))}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-label={label}
    />
  );
}
