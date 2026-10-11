import { useId, useState } from "react";
import {
  DEPOSIT_CARD_NOTE,
  DEPOSIT_ODDS_UNKNOWN,
  depositBars,
  type BarRow,
} from "../../../lib/details/depositBars";
import { percent, type PoolPick } from "../../../lib/details/spawnFacts";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { Unknown } from "../states";
import { BarTrack, PoolList, PoolRow } from "./OddsBar";
import { PickerCard } from "./PickerCard";
import { ResourceIcon } from "./ResourceIcon";

/** Whether a row shows its resource's icon; one with none shows its name instead. */
function hasIcon(row: BarRow): boolean {
  return row.icon !== null && row.icon.icon !== null;
}

/** A row's card: one line per amount with its shade, share where known, and deposits. */
function DepositBarCardLines({ row }: { row: BarRow }) {
  return (
    <>
      {!row.plain &&
        row.segments.map((segment) => (
          <span key={segment.amount} className="pl-pool-line">
            <span className="pl-pool-swatch" style={{ background: segment.fill }} />
            <span className="pl-pool-amount">{segment.label}</span>
            <span className="pl-pool-mini">
              {segment.chance !== null && (
                <span
                  style={{
                    width: `${(segment.share * 100).toFixed(1)}%`,
                    background: segment.fill,
                  }}
                />
              )}
            </span>
            <span className="pl-pool-line-chance">
              {segment.chance === null ? "" : percent(segment.chance)}
            </span>
            {segment.deposits.length > 0 && (
              <span className="muted pl-pool-deposits">{segment.deposits.join(", ")}</span>
            )}
          </span>
        ))}
      <span className="dp-card-note muted">{DEPOSIT_CARD_NOTE}</span>
    </>
  );
}

/** What shows in a row's bar column: its bar split by amount, its amounts as words, or nothing. */
function RowBar({ row }: { row: BarRow }) {
  if (row.amounts !== null) return <span className="muted pl-pool-amounts">{row.amounts}</span>;
  if (row.segments.length === 0) return null;
  return (
    <BarTrack width={row.width}>
      {row.segments.map((segment) => (
        <span
          key={segment.amount}
          className="pl-pool-seg"
          style={{ flexGrow: segment.share, background: segment.fill, color: segment.text }}
        >
          {segment.labelled ? segment.label : null}
        </span>
      ))}
    </BarTrack>
  );
}

/**
 * One resource's row: its icon, or its name where it has none, its bar split by amount or its
 * amounts, its combined chance, and its card while `shown`.
 */
export function BarLineView({
  row,
  shown,
  onShow,
}: {
  row: BarRow;
  shown: boolean;
  onShow: (shown: boolean) => void;
}) {
  const id = useId();
  const cardId = `${id}-card`;
  const icon = hasIcon(row) ? row.icon : null;
  const show = () => onShow(true);
  const hide = () => onShow(false);
  return (
    <PoolRow
      id={id}
      role="group"
      aria-label={row.heading}
      aria-describedby={shown ? cardId : undefined}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      icon={
        icon !== null && (
          <span role="img" aria-label={row.name}>
            <ResourceIcon amount={icon} />
          </span>
        )
      }
      name={icon === null ? row.name : null}
      bar={<RowBar row={row} />}
      chance={row.chance}
    >
      {shown && (
        <PickerCard
          id={cardId}
          rowId={id}
          item={{ label: row.heading, effects: [] }}
          lead={icon !== null && <ResourceIcon amount={icon} />}
        >
          <DepositBarCardLines row={row} />
        </PickerCard>
      )}
    </PoolRow>
  );
}

function BarLine({ row }: { row: BarRow }) {
  const [shown, setShown] = useState(false);
  return <BarLineView row={row} shown={shown} onShow={setShown} />;
}

/**
 * The deposits a scenario body can roll, one bar per resource, likeliest first, and a line saying
 * so where some rows show their amounts because the odds can't be told.
 */
export function DepositPoolBars({ picks }: { picks: readonly PoolPick[] }) {
  const views = usePlanetDataStore((s) => s.depositTypes);
  const rows = depositBars(picks, views);
  return (
    <>
      <PoolList>
        {rows.map((row) => (
          <BarLine key={row.key} row={row} />
        ))}
      </PoolList>
      {rows.some((row) => row.amounts !== null) && (
        <div className="muted ins-hint">
          <Unknown>{DEPOSIT_ODDS_UNKNOWN}</Unknown>
        </div>
      )}
    </>
  );
}
