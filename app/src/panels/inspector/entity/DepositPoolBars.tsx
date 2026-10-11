import { useId, useState } from "react";
import {
  DEPOSIT_CARD_NOTE,
  depositKinds,
  depositBars,
  type BarRow,
  type DepositKinds,
} from "../../../lib/details/depositBars";
import { cssShare } from "../../../lib/details/oddsBars";
import {
  BLOCKERS_LABEL,
  DEPENDS_ON_CLASS,
  OTHER_DEPOSITS_LABEL,
  percent,
  type PoolPick,
} from "../../../lib/details/spawnFacts";
import { counted } from "../../../lib/text";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { DependsOnClass, Hinted } from "../states";
import { BarTrack, PoolList, PoolRow } from "./OddsBar";
import { PickerCard } from "./PickerCard";
import { ResourceIcon } from "./ResourceIcon";

/** Whether a row shows its resource's icon; one with none shows its name instead. */
function hasIcon(row: BarRow): boolean {
  return row.icon !== null && row.icon.icon !== null;
}

/**
 * A row's card lines: one per amount with its shade, and where the odds are known its share and
 * the deposits behind it. Where they are not, only the amounts, and a note that the class decides.
 */
function DepositBarCardLines({ row }: { row: BarRow }) {
  const known = row.chance !== null;
  return (
    <>
      {!row.plain &&
        row.segments.map((segment) => (
          <span key={segment.amount} className="pl-pool-line">
            <span className="pl-pool-swatch" style={{ background: segment.fill }} />
            <span className="pl-pool-amount">{segment.label}</span>
            {known && (
              <>
                <span className="pl-pool-mini">
                  {segment.chance !== null && (
                    <span
                      style={{
                        width: cssShare(segment.share),
                        background: segment.fill,
                      }}
                    />
                  )}
                </span>
                <span className="pl-pool-line-chance">
                  {segment.chance === null ? "" : percent(segment.chance)}
                </span>
              </>
            )}
            {segment.deposits.length > 0 && (
              <span className="muted pl-pool-deposits">{segment.deposits.join(", ")}</span>
            )}
          </span>
        ))}
      <span className="dp-card-note muted">{known ? DEPOSIT_CARD_NOTE : DEPENDS_ON_CLASS}</span>
    </>
  );
}

/** A resource's card: its heading with its icon, then its amounts. */
function RowCard({ row, id, rowId }: { row: BarRow; id: string; rowId: string }) {
  const icon = hasIcon(row) ? row.icon : null;
  return (
    <PickerCard
      id={id}
      rowId={rowId}
      item={{ label: row.heading, effects: [] }}
      lead={icon !== null && <ResourceIcon amount={icon} />}
    >
      <DepositBarCardLines row={row} />
    </PickerCard>
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
      {shown && <RowCard row={row} id={cardId} rowId={id} />}
    </PoolRow>
  );
}

function BarLine({ row }: { row: BarRow }) {
  const [shown, setShown] = useState(false);
  return <BarLineView row={row} shown={shown} onShow={setShown} />;
}

/**
 * One resource whose odds are unknown: a dashed chip with its icon, or its name where it has none,
 * and the amounts it can give, its card on hover or focus.
 */
export function DepositChipView({
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
  return (
    <span
      id={id}
      className="chip pl-pool-chip"
      role="group"
      aria-label={row.heading}
      aria-describedby={shown ? cardId : undefined}
      tabIndex={0}
      onMouseEnter={() => onShow(true)}
      onMouseLeave={() => onShow(false)}
      onFocus={() => onShow(true)}
      onBlur={() => onShow(false)}
    >
      {icon === null ? (
        row.name
      ) : (
        <span className="pl-pool-icon" role="img" aria-label={row.name}>
          <ResourceIcon amount={icon} />
        </span>
      )}
      {row.amounts !== null && <span className="muted pl-pool-amounts">{row.amounts}</span>}
      {shown && <RowCard row={row} id={cardId} rowId={id} />}
    </span>
  );
}

function DepositChip({ row }: { row: BarRow }) {
  const [shown, setShown] = useState(false);
  return <DepositChipView row={row} shown={shown} onShow={setShown} />;
}

/** `Blockers: 3 kinds`, the kinds named in its card; nothing where there are none. */
function KindsLine({ label, names }: { label: string; names: readonly string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="pl-pool-kinds">
      {label}:{" "}
      <Hinted label={label} hint={names.join(", ")}>
        {counted(names.length, "kind")}
      </Hinted>
    </div>
  );
}

/**
 * A deposit pool whose odds are unknown: a line saying the class decides, a chip per resource with
 * the amounts it can give, then the blockers and the other deposits, each kind counted on one line.
 */
export function DepositKindsList({ kinds }: { kinds: DepositKinds }) {
  return (
    <>
      <DependsOnClass />
      {kinds.resources.length > 0 && (
        <div className="pl-class-strip">
          {kinds.resources.map((row) => (
            <DepositChip key={row.key} row={row} />
          ))}
        </div>
      )}
      <KindsLine label={BLOCKERS_LABEL} names={kinds.blockers} />
      <KindsLine label={OTHER_DEPOSITS_LABEL} names={kinds.other} />
    </>
  );
}

/**
 * The deposits a scenario body can roll, one bar per resource, likeliest first, and a line saying
 * the class decides where some rows show their amounts because the odds can't be told. Where none
 * of the odds are known, the resources are chips with their amounts and the rest are counted by
 * kind.
 */
export function DepositPoolBars({ picks }: { picks: readonly PoolPick[] }) {
  const views = usePlanetDataStore((s) => s.depositTypes);
  if (picks.every((pick) => pick.chance === null)) {
    return <DepositKindsList kinds={depositKinds(picks, views)} />;
  }
  const rows = depositBars(picks, views);
  return (
    <>
      <PoolList>
        {rows.map((row) => (
          <BarLine key={row.key} row={row} />
        ))}
      </PoolList>
      {rows.some((row) => row.amounts !== null) && <DependsOnClass />}
    </>
  );
}
