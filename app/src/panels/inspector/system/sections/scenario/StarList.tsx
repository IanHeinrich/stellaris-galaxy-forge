import type { SpawnStar } from "../../../../../generated/SpawnStar";
import { starListSource } from "../../../../../lib/details/spawnFacts";
import { OddsList } from "../../../entity/OddsBar";
import { Section } from "../../../parts";
import { Hinted, Rolled } from "../../../states";
import { useStarOdds } from "./useStarOdds";

type RolledStar = Extract<SpawnStar, { state: "rolled" }>;

/** The star classes an `rl_` list draws a star from, likeliest first, each with its bar and odds. */
export function StarOddsList({ star }: { star: RolledStar }) {
  return <OddsList rows={useStarOdds(star)} />;
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
