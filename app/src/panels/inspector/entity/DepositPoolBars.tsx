import { depositBars, type BarRow } from "../../../lib/details/depositBars";
import type { PoolPick } from "../../../lib/details/spawnFacts";
import { DEPOSIT_CHANCE_TITLE, percent } from "../../../lib/details/spawnFacts";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { ResourceIcon } from "./ResourceIcon";

/** One resource's row: its icon and name, its bar split by amount, and its combined chance. */
function BarLine({ row }: { row: BarRow }) {
  return (
    <div className="pl-pool-row" title={row.title}>
      <span className="pl-pool-name">
        {row.icon !== null && <ResourceIcon amount={row.icon} />}
        {row.name}
      </span>
      <span className="pl-pool-track">
        {row.segments.length > 0 && (
          <span className="pl-pool-bar" style={{ width: `${(row.width * 100).toFixed(1)}%` }}>
            {row.segments.map((segment) => (
              <span
                key={segment.amount}
                className="pl-pool-seg"
                title={segment.title}
                style={{
                  flexGrow: segment.share,
                  background: segment.fill,
                  color: segment.text,
                }}
              >
                {segment.labelled ? segment.label : null}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="muted pl-pool-chance" title={DEPOSIT_CHANCE_TITLE}>
        {row.chance === null ? "" : percent(row.chance)}
      </span>
    </div>
  );
}

/** The deposits a scenario body can roll, one bar per resource, likeliest first. */
export function DepositPoolBars({ picks }: { picks: readonly PoolPick[] }) {
  const views = usePlanetDataStore((s) => s.depositTypes);
  return (
    <div className="pl-pool-bars">
      {depositBars(picks, views).map((row) => (
        <BarLine key={row.key} row={row} />
      ))}
    </div>
  );
}
