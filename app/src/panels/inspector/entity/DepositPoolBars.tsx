import { useId, useState, type CSSProperties } from "react";
import { DEPOSIT_CARD_NOTE, depositBars, type BarRow } from "../../../lib/details/depositBars";
import { percent, type PoolPick } from "../../../lib/details/spawnFacts";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { PickerCard } from "./PickerCard";
import { ResourceIcon } from "./ResourceIcon";

/** What of a row the pointer or the focus is on: the row, and the amount of the segment under it. */
export interface BarHover {
  shown: boolean;
  amount: number | null;
}

const NOT_HOVERED: BarHover = { shown: false, amount: null };

/** Whether a row shows its resource's icon; one with none shows its name instead. */
function hasIcon(row: BarRow): boolean {
  return row.icon !== null && row.icon.icon !== null;
}

/** A row's card: one line per amount with its shade, share and deposits, the hovered one lit. */
export function DepositBarCardLines({ row, amount }: { row: BarRow; amount: number | null }) {
  return (
    <>
      {!row.plain &&
        row.segments.map((segment) => (
          <span
            key={segment.amount}
            className={segment.amount === amount ? "pl-pool-line lit" : "pl-pool-line"}
          >
            <span className="pl-pool-swatch" style={{ background: segment.fill }} />
            <span className="pl-pool-amount">{segment.label}</span>
            <span className="pl-pool-mini">
              <span
                style={{ width: `${(segment.share * 100).toFixed(1)}%`, background: segment.fill }}
              />
            </span>
            <span className="pl-pool-line-chance">{percent(segment.chance)}</span>
            {segment.deposits.length > 0 && (
              <span className="muted pl-pool-deposits">{segment.deposits.join(", ")}</span>
            )}
          </span>
        ))}
      <span className="dp-card-note muted">{DEPOSIT_CARD_NOTE}</span>
    </>
  );
}

/**
 * One resource's row as it shows for `hover`: its icon, or its name where it has none, its bar
 * split by amount, its combined chance, and its card while hovered.
 */
export function BarLineView({
  row,
  hover,
  onHover,
}: {
  row: BarRow;
  hover: BarHover;
  onHover: (hover: BarHover) => void;
}) {
  const id = useId();
  const cardId = `${id}-card`;
  const icon = hasIcon(row) ? row.icon : null;
  const show = () => onHover({ shown: true, amount: hover.amount });
  const hide = () => onHover(NOT_HOVERED);
  return (
    <div
      id={id}
      className="pl-pool-row"
      role="group"
      aria-label={row.heading}
      aria-describedby={hover.shown ? cardId : undefined}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {icon !== null ? (
        <span className="pl-pool-key" role="img" aria-label={row.name}>
          <ResourceIcon amount={icon} />
        </span>
      ) : (
        <span className="pl-pool-key pl-pool-name">{row.name}</span>
      )}
      <span className="pl-pool-track">
        {row.segments.length > 0 && (
          <span className="pl-pool-bar" style={{ width: `${(row.width * 100).toFixed(1)}%` }}>
            {row.segments.map((segment) => (
              <span
                key={segment.amount}
                className={segment.amount === hover.amount ? "pl-pool-seg lit" : "pl-pool-seg"}
                style={{ flexGrow: segment.share, background: segment.fill, color: segment.text }}
                onMouseEnter={() => onHover({ shown: true, amount: segment.amount })}
                onMouseLeave={() => onHover({ shown: true, amount: null })}
              >
                {segment.labelled ? segment.label : null}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="muted pl-pool-chance">{row.chance === null ? "" : percent(row.chance)}</span>
      {hover.shown && (
        <PickerCard
          id={cardId}
          rowId={id}
          item={{ label: row.heading, effects: [] }}
          lead={icon !== null && <ResourceIcon amount={icon} />}
        >
          <DepositBarCardLines row={row} amount={row.plain ? null : hover.amount} />
        </PickerCard>
      )}
    </div>
  );
}

function BarLine({ row }: { row: BarRow }) {
  const [hover, setHover] = useState<BarHover>(NOT_HOVERED);
  return <BarLineView row={row} hover={hover} onHover={setHover} />;
}

/** The width the rows' first column takes: an icon's, or a short name's where a row has no icon. */
const ICON_COLUMN = "18px";
const NAME_COLUMN = "72px";

/** The deposits a scenario body can roll, one bar per resource, likeliest first. */
export function DepositPoolBars({ picks }: { picks: readonly PoolPick[] }) {
  const views = usePlanetDataStore((s) => s.depositTypes);
  const rows = depositBars(picks, views);
  const style = {
    "--pool-key": rows.every(hasIcon) ? ICON_COLUMN : NAME_COLUMN,
  } as CSSProperties;
  return (
    <div className="pl-pool-bars" style={style}>
      {rows.map((row) => (
        <BarLine key={row.key} row={row} />
      ))}
    </div>
  );
}
