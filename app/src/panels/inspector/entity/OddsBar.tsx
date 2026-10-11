import type { ReactNode } from "react";
import type { OddsRow } from "../../../lib/details/oddsBars";
import { percent } from "../../../lib/details/spawnFacts";
import "./entity.css";

/**
 * A bar in its track, `width` of it long: one plain fill in `color`, or the segments given as
 * `children`. `thin` for an odds list.
 */
export function BarTrack({
  width,
  color,
  thin = false,
  children,
}: {
  width: number;
  color?: string;
  thin?: boolean;
  children?: ReactNode;
}) {
  return (
    <span className={thin ? "pl-pool-track thin" : "pl-pool-track"}>
      {(children !== undefined || width > 0) && (
        <span className="pl-pool-bar" style={{ width: `${(width * 100).toFixed(1)}%` }}>
          {children ?? <span className="pl-pool-seg" style={{ flexGrow: 1, background: color }} />}
        </span>
      )}
    </span>
  );
}

/** One row of an odds list as it shows: its icon, its name and how it is drawn. */
export interface ShownOdds {
  row: OddsRow;
  name: string;
  icon: ReactNode;
}

/** A draw's odds, likeliest first: each row's icon, name, a thin bar and its share. */
export function OddsList({ rows }: { rows: readonly ShownOdds[] }) {
  return (
    <div className="pl-odds">
      {rows.map(({ row, name, icon }) => (
        <div key={row.key} className="pl-odds-row">
          <span className="pl-odds-icon">{icon}</span>
          <span className="pl-odds-name">{name}</span>
          <BarTrack width={row.width} color={row.color} thin />
          <span className="muted pl-pool-chance">
            {row.share === null ? "" : percent(row.share)}
          </span>
        </div>
      ))}
    </div>
  );
}
