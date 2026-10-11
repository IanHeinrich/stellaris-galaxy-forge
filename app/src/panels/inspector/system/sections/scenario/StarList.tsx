import type { SpawnStar } from "../../../../../generated/SpawnStar";
import { oddsRows, readableTint, starListName } from "../../../../../lib/details/oddsBars";
import { starListSource, starOdds } from "../../../../../lib/details/spawnFacts";
import { starGlyph } from "../../../../../lib/visual/starGlyphs";
import { useGameDataStore } from "../../../../../store/gameDataStore";
import { OddsList } from "../../../entity/OddsBar";
import { useNamed } from "../../../../useNamed";
import { Icon } from "../../../../parts";
import { Section } from "../../../parts";
import { Hinted, Rolled } from "../../../states";

type RolledStar = Extract<SpawnStar, { state: "rolled" }>;

/** A star class's art, a star glyph while it has none. */
function StarArt({ starClass }: { starClass: string }) {
  const texture = useGameDataStore((s) => s.starClasses.get(starClass)?.texture_key);
  return <Icon className="pi ghost" keys={texture ? [texture] : []} glyph="★" />;
}

/** The star classes an `rl_` list draws a star from, likeliest first, each with its bar and odds. */
export function StarOddsList({ star }: { star: RolledStar }) {
  const odds = starOdds(star.members);
  const named = useNamed(odds.map((o) => o.key));
  const rows = oddsRows(odds, (key) => readableTint(starGlyph(key).tint));
  return (
    <OddsList
      stars
      rows={rows.map((row) => ({
        row,
        name: starListName(named(row.key)),
        icon: <StarArt starClass={row.key} />,
      }))}
    />
  );
}

/** The star classes an `rl_` list draws the system's star from, likeliest first, with the odds the game's files give. */
export function StarListSection({ star }: { star: RolledStar }) {
  return (
    <Section
      id="system.starList"
      title="Star class"
      count={star.members.length}
      summary={
        <Hinted label="Star class" hint={starListSource(star.list)} focusable={false}>
          <Rolled>rolled</Rolled>
        </Hinted>
      }
    >
      <StarOddsList star={star} />
    </Section>
  );
}
