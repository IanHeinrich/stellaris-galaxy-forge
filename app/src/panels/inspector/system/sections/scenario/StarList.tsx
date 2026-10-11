import type { SpawnStar } from "../../../../../generated/SpawnStar";
import { oddsRows } from "../../../../../lib/details/oddsBars";
import { STAR_LIST_HINT, starListSource, starOdds } from "../../../../../lib/details/spawnFacts";
import { starGlyph } from "../../../../../lib/visual/starGlyphs";
import { useGameDataStore } from "../../../../../store/gameDataStore";
import { OddsList } from "../../../entity/OddsBar";
import { useNamed } from "../../../../useNamed";
import { Icon } from "../../../../parts";
import { Section } from "../../../parts";
import { Rolled } from "../../../states";

type RolledStar = Extract<SpawnStar, { state: "rolled" }>;

/** A star class's art, a star glyph while it has none. */
function StarArt({ starClass }: { starClass: string }) {
  const texture = useGameDataStore((s) => s.starClasses.get(starClass)?.texture_key);
  return <Icon className="pi ghost" keys={texture ? [texture] : []} glyph="★" />;
}

/** The star classes an `rl_` list draws the system's star from, likeliest first, with the odds the game's files give. */
export function StarListSection({ star }: { star: RolledStar }) {
  const odds = starOdds(star.members);
  const named = useNamed(odds.map((o) => o.key));
  const rows = oddsRows(odds, (key) => starGlyph(key).tint);
  return (
    <Section
      id="system.starList"
      title="Star class"
      count={odds.length}
      summary={<Rolled>rolled</Rolled>}
    >
      <div className="muted ins-hint">{STAR_LIST_HINT}</div>
      <OddsList
        rows={rows.map((row) => ({
          row,
          name: named(row.key),
          icon: <StarArt starClass={row.key} />,
        }))}
      />
      <div className="muted ins-hint">{starListSource(star.list)}</div>
    </Section>
  );
}
