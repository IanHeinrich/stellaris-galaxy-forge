/**
 * Paint a Galaxy: every sentence the panels say about the mod, and the three states the mod can
 * be in on this machine. Where two screens word one idea differently, both wordings sit side by
 * side, named for the screen each is shown on.
 */

import type { PaintModView } from "../generated/PaintModView";

/** The checkbox the New scenario and Export dialogs share: its label and why it is on by default. */
export const PAINT_CHECK = "For the Paint a Galaxy mod";
export const PAINT_CHOICE_WHY =
  "Custom galaxies hit game-breaking bugs in the generator that this mod fixes. " +
  "Keep this ticked for any map you'll play. Untick it only if the map is for a mod of your own.";

/** The warning under the checkbox while it is off. */
export const PAINT_UNTICKED =
  "Without the mod this map will break in-game: wrong homeworlds, no marauders, no fallen " +
  "empires. Only go on if you know what you're doing, such as a mod of your own that handles all of that.";

/** Why the mod, as the notice under the top bar says it for a scenario outside the mod. */
export const PAINT_NOTICE_WHY =
  "Custom galaxies hit game-breaking bugs without the Paint a Galaxy mod. Save this map into " +
  "the mod unless it belongs to a mod of your own.";

/** A scenario row's tag in the Open list, and the line the details pane shows for it. */
export interface ScenarioKindCopy {
  tag: string;
  line: string;
}

export const SCENARIO_FOR_PAINT: ScenarioKindCopy = {
  tag: "PaG",
  line: "Written for the Paint a Galaxy mod",
};
export const SCENARIO_PLAIN: ScenarioKindCopy = {
  tag: "Plain",
  line: "A plain scenario, not for Paint a Galaxy",
};

/** Why a scenario for the mod will not play right while the mod is off. */
export const PAINT_MOD_OFF_BREAKS =
  "The Paint a Galaxy mod isn't enabled in your playset, so this map will break in-game until it is.";

/** Opening a scenario for the mod while the mod is off. */
export const OPEN_PAINT_MOD_OFF = `This scenario is written for the Paint a Galaxy mod. ${PAINT_MOD_OFF_BREAKS}`;

/** Opening a scenario that is not for the mod, above the checkbox. */
export const OPEN_NOT_FOR_PAINT =
  "This scenario isn't written for the Paint a Galaxy mod. With the box ticked, you edit it for the mod.";

/** The checkbox that turns off the question above, and where to turn it back on. */
export const NEVER_WARN = "Don't warn me again";
export const NEVER_WARN_WHY =
  "Scenarios that aren't for Paint a Galaxy will open as they are. " +
  "Turn the warning back on in the Help menu.";

/** The Help menu's switch for that question. */
export const WARN_NOT_FOR_PAINT = "Warn when opening a scenario that isn't for Paint a Galaxy";

/** The badge's tooltip for a scenario on the layer. */
export const PAINT_PROFILE_TITLE = "This scenario is set up for the Paint a Galaxy mod";

/** The mod is not installed, as the badge's tooltip says it. */
export const PAINT_MOD_NOT_INSTALLED =
  "The Paint a Galaxy mod is not installed. Subscribe to it on the Steam Workshop, then enable it in your playset.";

/** The same, as the status line says it, split around its link to the Workshop page. */
export const PAINT_MOD_NOT_INSTALLED_LINE = {
  before: "Subscribe to the ",
  link: "Paint a Galaxy mod on the Steam Workshop ↗",
  after: " then enable it in your playset.",
};

export const PAINT_MOD_NOT_ENABLED =
  "The Paint a Galaxy mod is installed but not enabled. Turn it on in your playset in the launcher.";
export const PAINT_MOD_ENABLED = "Paint a Galaxy mod enabled ✓";

/** The mod on this machine, once the shell has answered. */
export type PaintModState = "missing" | "disabled" | "enabled";

/** What one state reads as, for each place that shows it to render in its own markup. */
export interface PaintModStatusCopy {
  state: PaintModState;
  /** The one sentence on the state: the status line's text, and the badge's tooltip when it warns. */
  headline: string;
  /** The badge's own words. */
  badge: string;
  /** The Workshop page is the next step, so the badge and the status line open it. */
  action: "subscribe" | null;
  warn: boolean;
}

/** Each state's words, by state. */
export const PAINT_MOD_STATUS: Record<PaintModState, PaintModStatusCopy> = {
  missing: {
    state: "missing",
    headline: PAINT_MOD_NOT_INSTALLED,
    badge: "⚠ Paint a Galaxy mod not installed",
    action: "subscribe",
    warn: true,
  },
  disabled: {
    state: "disabled",
    headline: PAINT_MOD_NOT_ENABLED,
    badge: "⚠ Paint a Galaxy mod not enabled",
    action: null,
    warn: true,
  },
  enabled: {
    state: "enabled",
    headline: PAINT_MOD_ENABLED,
    badge: "Paint a Galaxy",
    action: null,
    warn: false,
  },
};

/** The state the shell's answer puts the mod in, and its words. */
export function paintModStatusCopy(paintMod: PaintModView | null): PaintModStatusCopy {
  if (paintMod === null) return PAINT_MOD_STATUS.missing;
  return paintMod.enabled ? PAINT_MOD_STATUS.enabled : PAINT_MOD_STATUS.disabled;
}
