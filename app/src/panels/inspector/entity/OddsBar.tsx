import type { HTMLAttributes, ReactNode } from "react";
import { cssShare, type OddsRow } from "../../../lib/details/oddsBars";
import { percent } from "../../../lib/details/spawnFacts";
import "./entity.css";

/**
 * A bar in its track, `width` of it long: one plain fill in `color`, or the segments given as
 * `children`.
 */
export function BarTrack({
  width,
  color,
  children,
}: {
  width: number;
  color?: string;
  children?: ReactNode;
}) {
  return (
    <span className="pl-pool-track">
      <span className="pl-pool-bar" style={{ width: cssShare(width) }}>
        {children ?? <span className="pl-pool-seg" style={{ flexGrow: 1, background: color }} />}
      </span>
    </span>
  );
}

/** Every list of what a roll can give, one row each. */
export function PoolList({ children }: { children: ReactNode }) {
  return <div className="pl-pool-list">{children}</div>;
}

/**
 * One row of a pool list: its icon, its name, its bar or what shows in the bar's place, and its
 * share. `children` go after them, such as a card; the rest are the row's own attributes. With
 * `press` the row is a toggle button.
 */
export function PoolRow({
  icon,
  name,
  bar,
  chance,
  children,
  ...rest
}: {
  icon?: ReactNode;
  name?: ReactNode;
  bar?: ReactNode;
  chance: number | null;
  children?: ReactNode;
} & (
  | { press: Press }
  | ({ press?: undefined } & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">)
)) {
  const cells = (
    <>
      <span className="pl-pool-icon">{icon}</span>
      <span className="pl-pool-name">{name}</span>
      <span className="pl-pool-cell">{bar}</span>
      <span className="muted pl-pool-chance">{chance === null ? "" : percent(chance)}</span>
      {children}
    </>
  );
  if (rest.press !== undefined) {
    return (
      <button
        type="button"
        className="pl-pool-row"
        aria-pressed={rest.press.pressed}
        onClick={rest.press.onPress}
      >
        {cells}
      </button>
    );
  }
  return (
    <div className="pl-pool-row" {...rest}>
      {cells}
    </div>
  );
}

/** A row that toggles: whether it is pressed, and what pressing it does. */
export interface Press {
  pressed: boolean;
  onPress(): void;
}

/** One row of an odds list as it shows: its icon, its name and how it is drawn. */
export interface ShownOdds {
  row: OddsRow;
  name: string;
  icon?: ReactNode;
  /** Where the row is a toggle button. */
  press?: Press;
}

/**
 * A draw's odds, likeliest first: each row's icon, name, a bar where its share is known, and its
 * share. `lead` is a toggle row before them, with a name alone.
 */
export function OddsList({
  rows,
  lead,
}: {
  rows: readonly ShownOdds[];
  lead?: { name: string; press: Press };
}) {
  return (
    <PoolList>
      {lead !== undefined && <PoolRow name={lead.name} chance={null} press={lead.press} />}
      {rows.map(({ row, name, icon, press }) => (
        <PoolRow
          key={row.key}
          icon={icon}
          name={name}
          bar={row.share === null ? null : <BarTrack width={row.width} color={row.color} />}
          chance={row.share}
          press={press}
        />
      ))}
    </PoolList>
  );
}
