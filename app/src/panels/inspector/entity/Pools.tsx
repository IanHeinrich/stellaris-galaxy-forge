import type { ReactNode } from "react";
import type { SpawnPool } from "../../../generated/SpawnPool";
import { CLASS_SUITED_VALUE } from "../../../lib/details/scenarioValues";
import { NEUTRAL_BAR, oddsRows } from "../../../lib/details/oddsBars";
import {
  CLASS_SUITED,
  classSuitedHint,
  mergedByName,
  poolPicks,
  poolTitle,
  type PoolPick,
} from "../../../lib/details/spawnFacts";
import { DependsOnClass, Hinted, Rolled, StateValue } from "../states";
import { OddsList } from "./OddsBar";
import { useFeatureNamer } from "./useFeatureNamer";

/** The most feature names listed where none of their odds are known; the rest show as a count. */
const MOST_FEATURE_NAMES = 8;

/**
 * Planet features the roll can give, each name once and likeliest first: a bar for each whose
 * chance is known, or where none is, the names in one line, after a line saying the class decides
 * unless a class is `picked`. More than a few names are cut to a count that has the whole list in
 * its card.
 */
export function FeaturePool({ picks, picked }: { picks: readonly PoolPick[]; picked: boolean }) {
  const named = useFeatureNamer();
  const merged = mergedByName(picks, named);
  if (merged.every((pick) => pick.chance === null)) {
    const names = merged.map((pick) => pick.name);
    const cut = names.length - MOST_FEATURE_NAMES;
    return (
      <>
        {!picked && <DependsOnClass />}
        <div className="pl-pool-names">
          {cut > 0 ? (
            <>
              {names.slice(0, MOST_FEATURE_NAMES).join(", ")},{" "}
              <Hinted label="All planet features" hint={names.join(", ")}>
                +{cut} more
              </Hinted>
            </>
          ) : (
            names.join(", ")
          )}
        </div>
      </>
    );
  }
  const rows = oddsRows(
    merged.map((p) => ({ key: p.key, share: p.chance })),
    () => NEUTRAL_BAR,
  );
  return <OddsList rows={rows.map((row, i) => ({ row, name: merged[i].name }))} />;
}

/**
 * After the rows a scenario body's initializer states, what its own roll can give it, likeliest
 * first: nothing where it rolls none, and why where the class it rolls decides. `body` shows the
 * picks, and `tail` counts them as they show.
 */
export function PoolLines({
  pool,
  stated,
  noun,
  tail,
  body,
}: {
  pool: SpawnPool | undefined;
  stated: number;
  /** What the page calls the body, for the cards. */
  noun: string;
  /** The line's tail after "Can roll ·". */
  tail: (picks: PoolPick[]) => string;
  body: (picks: PoolPick[]) => ReactNode;
}) {
  if (pool === undefined || pool.state === "fixed") return null;
  if (pool.state === "unknown") {
    return (
      <div className="pl-sub-head">
        <Hinted label={CLASS_SUITED} hint={classSuitedHint(noun)}>
          <StateValue value={CLASS_SUITED_VALUE} />
        </Hinted>
      </div>
    );
  }
  const picks = poolPicks(pool);
  if (picks.length === 0) return null;
  return (
    <>
      <div className="pl-sub-head">
        <Rolled />
        {poolTitle(stated, tail(picks))}
      </div>
      {body(picks)}
    </>
  );
}
