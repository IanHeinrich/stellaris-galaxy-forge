import type { EraseTarget } from "./brush/brushTools";
import type { HeightMode, RipplePreset } from "./brush/heightBrush";
import type { LaneMode } from "./brush/lanes";

/** One entry of a drop-down the tool options offer, and the words it reads as. */
export interface Choice<T extends string> {
  value: T;
  label: string;
}

export const LANE_MODE_CHOICES: readonly Choice<LaneMode>[] = [
  { value: "off", label: "Off" },
  { value: "new", label: "Among new" },
  { value: "nearby", label: "New and nearby" },
];

export const ERASE_TARGET_CHOICES: readonly Choice<EraseTarget>[] = [
  { value: "systems", label: "Systems" },
  { value: "lanes", label: "Lanes only" },
];

/** The choice whose value is `text`, which a drop-down reports as a string; null when none is. */
export function choiceOf<T extends string>(choices: readonly Choice<T>[], text: string): T | null {
  return choices.find((choice) => choice.value === text)?.value ?? null;
}

export const HEIGHT_MODE_LABELS: Record<HeightMode, string> = {
  set: "Set",
  raise: "Raise",
  ripple: "Ripple",
  smooth: "Smooth",
};

export const HEIGHT_MODE_HINTS: Record<HeightMode, string> = {
  set: "Click or drag to set every system under the brush to this height.",
  raise: "Click or drag to lift systems, most at the centre. Alt lowers.",
  ripple:
    "Click to drop a ripple, or hold the button and let go where it should land. Rings preview on the map first. Alt flips crests and troughs.",
  smooth: "Drag to even out bumps between neighbours.",
};

export const RIPPLE_PRESET_LABELS: Record<RipplePreset, string> = {
  ripples: "Ripples",
  waves: "Waves",
  dome: "Dome",
  crater: "Crater",
};

/** Why the paint brush's spacing cannot go below `least` at the current brush size. */
export function densityLimit(maxSystems: number, least: number): string {
  return `A brush this size paints at most ${maxSystems} systems per circle, so the spacing is at least ${least}. Make the brush smaller to paint denser.`;
}
