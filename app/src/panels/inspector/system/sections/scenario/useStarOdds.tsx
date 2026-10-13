import type { RolledStar } from "../../../../../lib/details/classList";
import { oddsRows, starListName } from "../../../../../lib/details/oddsBars";
import { readableTint } from "../../../../../lib/visual/color";
import { starOdds } from "../../../../../lib/details/spawnFacts";
import { starGlyph } from "../../../../../lib/visual/starGlyphs";
import type { ShownOdds } from "../../../entity/OddsBar";
import { useNamed } from "../../../../useNamed";
import { StarArt } from "./StarArt";

/** The star classes an `rl_` list draws a star from, likeliest first, as an odds list's rows. */
export function useStarOdds(star: RolledStar): ShownOdds[] {
  const odds = starOdds(star.members);
  const named = useNamed(odds.map((o) => o.key));
  return oddsRows(odds, (key) => readableTint(starGlyph(key).tint)).map((row) => ({
    row,
    name: starListName(named(row.key)),
    icon: <StarArt starClass={row.key} />,
  }));
}
