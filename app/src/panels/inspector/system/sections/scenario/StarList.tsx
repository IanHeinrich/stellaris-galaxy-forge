import type { SpawnStar } from "../../../../../generated/SpawnStar";
import {
  percent,
  STAR_LIST_HINT,
  starListSource,
  starOdds,
} from "../../../../../lib/details/spawnFacts";
import { useGameDataStore } from "../../../../../store/gameDataStore";
import { useNamed } from "../../../../useNamed";
import { Icon } from "../../../../parts";
import { Section } from "../../../parts";
import { ComesFrom, Rolled } from "../../../states";

type RolledStar = Extract<SpawnStar, { state: "rolled" }>;

/** One star class of the list, with its art and its share of the draw. */
function StarOddsRow({ starClass, share }: { starClass: string; share: number | null }) {
  const named = useNamed([starClass]);
  const texture = useGameDataStore((s) => s.starClasses.get(starClass)?.texture_key);
  return (
    <div className="ins-prow static">
      <Icon className="pi ghost" keys={texture ? [texture] : []} glyph="★" />
      <span>
        <span className="l1">{named(starClass)}</span>
      </span>
      <span className="rs">{share === null ? "" : percent(share)}</span>
    </div>
  );
}

/** The star classes an `rl_` list draws the system's star from, likeliest first, with the odds the game's files give. */
export function StarListSection({ star }: { star: RolledStar }) {
  const odds = starOdds(star.members);
  return (
    <Section
      id="system.starList"
      title="Star class"
      count={odds.length}
      summary={<Rolled>rolled</Rolled>}
    >
      <div className="muted ins-hint">{STAR_LIST_HINT}</div>
      {odds.map((o) => (
        <StarOddsRow key={o.key} starClass={o.key} share={o.share} />
      ))}
      <ComesFrom>{starListSource(star.list)}</ComesFrom>
    </Section>
  );
}
