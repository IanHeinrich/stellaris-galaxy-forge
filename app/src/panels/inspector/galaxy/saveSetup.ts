import type { GalaxySettings } from "../../../generated/GalaxySettings";
import { readableKey } from "../../../lib/names";
import { countText, START_YEAR, timesText } from "../../../lib/openRows";

export const KALEIDOSCOPE_VALUE = "will appear";
export const KALEIDOSCOPE_TITLE =
  "Day one rolled for the Kaleidoscope. It starts once the mid-game begins.";

function year(n: number | null): string | null {
  return n === null ? null : String(START_YEAR + n);
}

/** Early, mid and late as one value, or nothing unless the save writes all three. */
function byStage(values: ReadonlyArray<string | null>): string | null {
  return values.every((v) => v !== null) ? values.join(" · ") : null;
}

/** The label and value of each setting the save writes, in the setup screen's order. */
export function settingRows(s: GalaxySettings): Array<[string, string]> {
  const crisis = [s.crisis_type === null ? null : readableKey(s.crisis_type), timesText(s.crises)]
    .filter((part) => part !== null)
    .join(" · ");
  const rows: Array<[string, string | null]> = [
    ["Crisis", crisis === "" ? null : crisis],
    ["Mid-game year", year(s.mid_game_start)],
    ["End-game year", year(s.end_game_start)],
    ["Victory year", year(s.victory_year)],
    [
      "Cosmic storm chance (early · mid · late)",
      byStage([
        timesText(s.cosmic_storm_early_game_spawn_chance_scale),
        timesText(s.cosmic_storm_mid_game_spawn_chance_scale),
        timesText(s.cosmic_storm_late_game_spawn_chance_scale),
      ]),
    ],
    [
      "Cosmic storm cap (early · mid · late)",
      byStage([
        countText(s.cosmic_storm_early_game_spawn_max_cap),
        countText(s.cosmic_storm_mid_game_spawn_max_cap),
        countText(s.cosmic_storm_late_game_spawn_max_cap),
      ]),
    ],
    ["Cosmic storm cooldown", timesText(s.cosmic_storm_spawn_cooldown_scale)],
    ["Cosmic storm devastation", timesText(s.cosmic_storm_devastation)],
    ["Voidworm scaling", timesText(s.voidworms_scaling)],
    ["Cutholoid scaling", timesText(s.cutholoids_scaling)],
    ["Fallen empire strength", timesText(s.fallen_empire_strength_scale)],
  ];
  return rows.filter((row): row is [string, string] => row[1] !== null);
}
