import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { HOME_PLANET_TITLE, START_PLANET_TITLE } from "../../../lib/details/spawnFacts";
import { Chip } from "../../parts";
import { Hinted } from "../states";

/** The chips that say who lives on a body, on its page's head and its list row. */
export function BodyChips({
  body,
}: {
  body: Pick<PlanetSummary, "capital" | "pre_ftl" | "spawn">;
}) {
  return (
    <>
      {body.capital && <Chip>capital</Chip>}
      {body.pre_ftl && <Chip>pre-FTL</Chip>}
      {body.spawn?.starting_planet && (
        <Hinted label="Start planet" hint={START_PLANET_TITLE} focusable={false}>
          <Chip>start planet</Chip>
        </Hinted>
      )}
      {body.spawn?.home_planet && (
        <Hinted label="Home planet" hint={HOME_PLANET_TITLE} focusable={false}>
          <Chip>home planet</Chip>
        </Hinted>
      )}
    </>
  );
}
