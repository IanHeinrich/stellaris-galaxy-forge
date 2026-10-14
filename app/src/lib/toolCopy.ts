import type { EraseTarget } from "./brush/brushTools";
import type { HeightMode, RipplePreset } from "./brush/heightBrush";
import type { LaneMode } from "./placement/lanes";

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

/** A mode or preset's button: its name and, for its tooltip, what it does. */
interface ButtonCopy {
  label: string;
  title: string;
}

/** Each Height brush mode: its button, and the hint under the options while it is chosen. */
export const HEIGHT_MODE_ROWS: Record<HeightMode, ButtonCopy & { hint: string }> = {
  set: {
    label: "Set",
    title: "Give every system under the brush the same height.",
    hint: "Click or drag to set every system under the brush to this height.",
  },
  raise: {
    label: "Raise",
    title: "Lift the systems under the brush, most at its centre.",
    hint: "Click or drag to lift systems, most at the centre. Alt lowers.",
  },
  ripple: {
    label: "Ripple",
    title: "Raise and lower systems in rings around where you click.",
    hint: "Click to drop a ripple, or hold the button and let go where it should land. Rings preview on the map first. Alt flips crests and troughs.",
  },
  smooth: {
    label: "Smooth",
    title: "Even out bumps between neighbouring systems.",
    hint: "Drag to even out bumps between neighbours.",
  },
};

export const SPREAD_HINT =
  "Drag to even out the spacing. Hold still to keep spreading. Alt gathers systems to the centre.";

/** Each ripple preset's button. */
export const RIPPLE_PRESET_ROWS: Record<RipplePreset, ButtonCopy> = {
  ripples: { label: "Ripples", title: "Make tall rings close together." },
  waves: { label: "Waves", title: "Make low waves that roll a long way out." },
  dome: { label: "Dome", title: "Raise one broad, round hill." },
  crater: { label: "Crater", title: "Sink one broad, round hollow." },
};

/** The tooltip of a control drawn as an icon alone: its name, as a label would show it, then what it does. */
export function iconTitle(name: string, hint: string): string {
  return `${name}\n${hint}`;
}

/** An option's label, and what it does to the map for its tooltip. */
export interface OptionCopy {
  label: string;
  hint: string;
}

/** The brushes' options, and the lane options the Shape tool shares with them. */
export type ToolOption =
  | "size"
  | "density"
  | "lanes"
  | "laneDensity"
  | "laneIslands"
  | "eraseTarget"
  | "eraseSpecials"
  | "height"
  | "raise"
  | "smooth"
  | "rippleHeight"
  | "waveSpacing"
  | "fade"
  | "spread"
  | "spreadSpecials";

export const TOOL_OPTIONS: Record<ToolOption, OptionCopy> = {
  size: { label: "Size", hint: "Set how wide the brush is." },
  density: { label: "Density", hint: "Set how close together the painted systems are." },
  lanes: {
    label: "Lanes",
    hint: "Join the new systems with lanes among themselves, or to the systems around them too.",
  },
  laneDensity: {
    label: "Lane density",
    hint: "Set how many lanes are added, from a few with no loops to one to every neighbour.",
  },
  laneIslands: {
    label: "Generate lanes like the game",
    hint: "Link systems in small clusters joined by single lanes, as the game does, instead of an even mesh.",
  },
  eraseTarget: {
    label: "Target",
    hint: "Erase whole systems with their lanes, or only the lanes.",
  },
  eraseSpecials: {
    label: "Also erase special systems",
    hint: "Let the brush erase systems with an initializer, a spawn point or another special role.",
  },
  height: {
    label: "Height",
    hint: "Set the height the brush gives systems, 0 on the galaxy plane.",
  },
  raise: { label: "Strength", hint: "Set how far each pass lifts the systems." },
  smooth: { label: "Strength", hint: "Set how far each pass evens out the heights." },
  rippleHeight: { label: "Height", hint: "Set how high the crests rise." },
  waveSpacing: { label: "Wave spacing", hint: "Set the distance from one crest to the next." },
  fade: {
    label: "Fade out",
    hint: "Set how quickly the ripples die away towards the brush's edge.",
  },
  spread: { label: "Strength", hint: "Set how far each pass moves a system." },
  spreadSpecials: {
    label: "Also move special and home systems",
    hint: "Let the brush move points of interest and empires' home systems too.",
  },
};

/** Why the paint brush's spacing cannot go below `least` at the current brush size. */
export function densityLimit(maxSystems: number, least: number): string {
  return `A brush this size paints at most ${maxSystems} systems per circle, so the spacing is at least ${least}. Make the brush smaller to paint denser.`;
}
