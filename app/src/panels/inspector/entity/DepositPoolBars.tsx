import { useId, useState, type CSSProperties } from "react";
import { DEPOSIT_CARD_NOTE, depositBars, type BarRow } from "../../../lib/details/depositBars";
import { percent, type PoolPick } from "../../../lib/details/spawnFacts";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { BarTrack } from "./OddsBar";
import { PickerCard } from "./PickerCard";
import { ResourceIcon } from "./ResourceIcon";

/** Whether a row shows its resource's icon; one with none shows its name instead. */
function hasIcon(row: BarRow): boolean {
  return row.icon !== null && row.icon.icon !== null;
}

/** A row's card: one line per amount with its shade, share and deposits. */
function DepositBarCardLines({ row }: { row: BarRow }) {
  return (
    <>
      {!row.plain &&
        row.segments.map((segment) => (
          <span key={segment.amount} className="pl-pool-line">
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
 * One resource's row: its icon, or its name where it has none, its bar
 * split by amount, its combined chance, and its card while `shown`.
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
    <div
      id={id}
      className="pl-pool-row"
      role="group"
      aria-label={row.heading}
      aria-describedby={shown ? cardId : undefined}
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
      <BarTrack width={row.width}>
        {row.segments.length === 0
          ? undefined
          : row.segments.map((segment) => (
              <span
                key={segment.amount}
                className="pl-pool-seg"
                style={{ flexGrow: segment.share, background: segment.fill, color: segment.text }}
              >
                {segment.labelled ? segment.label : null}
              </span>
            ))}
      </BarTrack>
      <span className="muted pl-pool-chance">{row.chance === null ? "" : percent(row.chance)}</span>
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
    </div>
  );
}

function BarLine({ row }: { row: BarRow }) {
  const [shown, setShown] = useState(false);
  return <BarLineView row={row} shown={shown} onShow={setShown} />;
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
