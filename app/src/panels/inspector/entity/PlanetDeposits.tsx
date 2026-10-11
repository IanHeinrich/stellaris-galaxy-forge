import { useMemo, useState, type ReactNode } from "react";
import type { DepositTypeView } from "../../../generated/DepositTypeView";
import type { ResourceAmountView } from "../../../generated/ResourceAmountView";
import { formatAmount, resourceAbbrev } from "../../../lib/details/resources";
import {
  BLOCKER_ICON,
  districtTotals,
  type DepositGroup,
  type DistrictTotal,
} from "../../../lib/details/planetPage";
import { STATION_STAYS } from "../../../lib/details/planetEdits";
import {
  bodyNoun,
  categoryWords,
  depositCategories,
  depositLines,
} from "../../../lib/details/spawnFacts";
import { capabilityFor } from "../../../lib/entities";
import { templateName } from "../../../lib/names";
import { counted, thousands } from "../../../lib/text";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { Icon } from "../../parts";
import { useNamed } from "../../useNamed";
import { DrillLink, Section } from "../parts";
import type { HeldDeposit } from "./bodySources";
import { ConfirmLine } from "./ConfirmLine";
import { DEPOSIT_PICKERS } from "./DepositPicker";
import { PlanetPicker } from "./PlanetPicker";
import type { PlanetSectionProps } from "./planetSection";
import { useEntityView, useOpenEntity } from "./useEntity";

const ROOT: readonly string[] = [];

const groupKey = (group: DepositGroup) => `${group.kind}|${group.swapType ?? ""}`;

/**
 * A button that takes one deposit of a row's type off the planet. With `warnings`, the row
 * shows them with a confirm in place of removing at once.
 */
export interface Removal {
  title: string;
  label: string;
  run: () => void;
  warnings: readonly string[];
  confirming: boolean;
  confirm: () => void;
  cancel: () => void;
}

/** What the game takes away for a removal, and the buttons that make it or drop it. */
export function RemovalConfirm({ removal }: { removal: Removal | null }) {
  if (removal === null || !removal.confirming) return null;
  return (
    <ConfirmLine
      className="pl-dep-confirm"
      warnings={removal.warnings}
      confirmLabel="Remove anyway"
      onConfirm={removal.confirm}
      onCancel={removal.cancel}
    />
  );
}

function signed(n: number): string {
  return n > 0 ? `+${formatAmount(n)}` : formatAmount(n);
}

function ResourceIcon({ amount }: { amount: ResourceAmountView }) {
  return (
    <Icon
      className="gi"
      keys={amount.icon === null ? [] : [amount.icon]}
      glyph={resourceAbbrev(amount.resource)}
    />
  );
}

function DistrictStrip({ totals }: { totals: readonly DistrictTotal[] }) {
  return (
    <div className="pl-caps">
      {totals.map((t) => (
        <span key={t.key} className={`pl-cap${t.amount < 0 ? " neg" : ""}`}>
          {t.icon !== null && <Icon className="gi" keys={[t.icon]} glyph="" />}
          <b>{signed(t.amount)}</b> {t.label}
        </span>
      ))}
    </div>
  );
}

/** The station a planet's extractable deposits are worked by, named as its fleet is. */
function StationLink({ id }: { id: number }) {
  const addr = useMemo(() => ({ kind: "fleet" as const, id }), [id]);
  const { value: view } = useEntityView(addr, ROOT);
  const opener = useOpenEntity();
  const name =
    view?.name == null ? `station #${id}` : templateName({ name: view.name, name_key: view.label });
  return (
    <span className="l2">
      Worked by
      <DrillLink
        requires={capabilityFor("fleet")}
        title="Open the station's fleet"
        onOpen={() => opener.open(addr, name)}
      >
        {name}
      </DrillLink>
    </span>
  );
}

/** A yield leads the row: what a station would extract, as the game names it. */
function Yields({ yields }: { yields: readonly ResourceAmountView[] }) {
  return (
    <>
      {yields.map((y) => (
        <span key={y.resource} className="pl-yield">
          <span className="res">
            <ResourceIcon amount={y} />
            {signed(y.amount)}
          </span>
          {y.name}
        </span>
      ))}
    </>
  );
}

function Clearing({ view }: { view: DepositTypeView }) {
  const clearing = view.clearing;
  if (clearing === null) return null;
  const techs = clearing.techs.map((t) => t.name).join(", ");
  return (
    <span className="l3">
      Clears for
      {clearing.cost.map((c) => (
        <span key={c.resource} className="pl-cost">
          <ResourceIcon amount={c} />
          {thousands(c.amount)}
        </span>
      ))}
      {clearing.days !== null && ` in ${counted(clearing.days, "day")}`}
      {techs !== "" && ` · ${techs}`}
    </span>
  );
}

function Hides({ swapType }: { swapType: string | null }) {
  const views = usePlanetDataStore((s) => s.depositTypes);
  if (swapType === null) return null;
  return <span className="l3 pl-hides">Hides {views.get(swapType)?.name ?? swapType}</span>;
}

function Count({ count }: { count: number }) {
  return count > 1 ? <span className="pl-count">×{count}</span> : <span />;
}

/** A row's count, and its remove button where the planet's deposits can change. */
function RowEnd({ count, removal }: { count: number; removal: Removal | null }) {
  return (
    <span className="pl-dep-end">
      <Count count={count} />
      {removal !== null && (
        <button
          type="button"
          className="pl-dep-remove"
          title={removal.title}
          aria-label={removal.label}
          onClick={removal.run}
        >
          ✕
        </button>
      )}
    </span>
  );
}

/**
 * Who of several selected bodies has a row, and the buttons that act on it; drawn under the row's
 * other lines.
 */
export interface Spread {
  line: string;
  actions: ReactNode;
}

function SpreadLines({ spread }: { spread: Spread | undefined }) {
  if (spread === undefined) return null;
  return (
    <>
      <span className="l3">{spread.line}</span>
      <span className="pl-spread-acts">{spread.actions}</span>
    </>
  );
}

/** A type the game data does not describe: its key, as the save writes it. */
function PlainDepositRow({
  group,
  removal,
  spread,
}: {
  group: DepositGroup;
  removal: Removal | null;
  spread?: Spread;
}) {
  return (
    <>
      <div className="pl-dep plain">
        <span>
          <span className="l1 mono">{group.kind}</span>
          <Hides swapType={group.swapType} />
          <SpreadLines spread={spread} />
        </span>
        <RowEnd count={group.count} removal={removal} />
      </div>
      <RemovalConfirm removal={removal} />
    </>
  );
}

/**
 * A deposit type's row: its art, what it yields or does, how it clears and who works it, and its
 * count and remove button. With `spread`, the row stands for several bodies and says who has it.
 */
export function DepositRow({
  group,
  station,
  removal,
  spread,
}: {
  group: DepositGroup;
  station: number | null;
  removal: Removal | null;
  spread?: Spread;
}) {
  const view = group.view;
  if (view === undefined) {
    return <PlainDepositRow group={group} removal={removal} spread={spread} />;
  }
  const extracted = view.yields.length > 0;
  const effects = view.effects.map((e) => e.text).join(" · ");
  return (
    <>
      <div className={`pl-dep${view.blocker ? " blocker" : ""}`}>
        <span className="pl-dep-art">
          <Icon className="pl-art" keys={[view.texture_key]} glyph="" />
          {view.blocker && <Icon className="pl-bmark" keys={[BLOCKER_ICON]} glyph="" />}
        </span>
        <span>
          <span className="l1">{extracted ? <Yields yields={view.yields} /> : view.name}</span>
          {effects !== "" && (
            <span className={`l2${view.blocker ? " neg" : ""}`}>
              {effects}
              {group.count > 1 && " each"}
            </span>
          )}
          {view.side_effects.map((side) => (
            <span key={side.tech.key} className="l3">
              {side.effects.map((e) => e.text).join(" · ")} with {side.tech.name}
            </span>
          ))}
          <Clearing view={view} />
          <Hides swapType={group.swapType} />
          {extracted && station !== null && <StationLink id={station} />}
          <SpreadLines spread={spread} />
        </span>
        <RowEnd count={group.count} removal={removal} />
      </div>
      <RemovalConfirm removal={removal} />
    </>
  );
}

/**
 * A body's deposits: the district caps they add up to, one row per type, and the blockers apart.
 * Where the page offers deposits, each row can lose one of its deposits and a picker adds one,
 * both through the target's adapter. A scenario body's initializer adds what it clears and
 * replaces, and whether it stops blockers.
 */
export function PlanetDeposits({ read, offers }: PlanetSectionProps) {
  const editable = offers.deposits;
  const { deposits } = read.rows;
  const { target } = read;
  const ready = useGameDataStore((s) => s.status === "ready");
  const views = usePlanetDataStore((s) => s.depositTypes);
  const [confirming, setConfirming] = useState<string | null>(null);
  useNamed(editable ? deposits.nameKeys : []);
  const spawn = read.summary.spawn;
  const category = useNamed(
    spawn === undefined ? [] : depositCategories(spawn.deposits),
    categoryWords,
  );
  const stated =
    spawn === undefined
      ? { notes: [], blockers: null }
      : depositLines(spawn.deposits, spawn.no_blockers, deposits.count, bodyNoun(read.summary), {
          deposit: (key) => views.get(key)?.name ?? key,
          category,
        });
  const says = stated.notes.length > 0 || stated.blockers !== null;
  if (deposits.count === 0 && !editable && !says) return null;
  const removal = (group: HeldDeposit): Removal | null => {
    const held = editable ? group.removal : null;
    if (held === null) return null;
    const key = groupKey(group);
    const remove = () => {
      setConfirming(null);
      void target.edits.removeDeposit(held.ref);
    };
    const warnings = held.warnings;
    const worked = deposits.station !== null && (group.view?.yields.length ?? 0) > 0;
    return {
      title: worked ? STATION_STAYS : "Remove one deposit of this type",
      label: `Remove ${group.view?.name ?? group.kind}`,
      run: warnings.length === 0 ? remove : () => setConfirming(key),
      warnings,
      confirming: confirming === key && warnings.length > 0,
      confirm: remove,
      cancel: () => setConfirming(null),
    };
  };
  const { features, blockers } = deposits;
  const totals = ready ? districtTotals([...features, ...blockers]) : [];
  const blocked = blockers.reduce((n, g) => n + g.count, 0);
  const row = (g: HeldDeposit) => (
    <DepositRow key={groupKey(g)} group={g} station={deposits.station} removal={removal(g)} />
  );
  return (
    <Section
      id="planet.deposits"
      title="Deposits"
      count={deposits.count}
      summary={blocked > 0 ? counted(blocked, "blocker") : undefined}
    >
      {totals.length > 0 && <DistrictStrip totals={totals} />}
      {editable &&
        deposits.notes.map((note) => (
          <div key={note} className="pl-dep-note">
            {note}
          </div>
        ))}
      {features.map(row)}
      {stated.notes.map((note) => (
        <div key={note} className="muted ins-hint">
          {note}
        </div>
      ))}
      {editable && (
        <PlanetPicker
          kind={DEPOSIT_PICKERS.deposits}
          target={target}
          extra={deposits.addWarnings}
        />
      )}
      {(blockers.length > 0 || editable || stated.blockers !== null) && (
        <>
          <div className="pl-sub-head">
            <Icon className="gi" keys={[BLOCKER_ICON]} glyph="" />
            Blockers · {blocked}
          </div>
          {blockers.map(row)}
          {stated.blockers !== null && <div className="muted ins-hint">{stated.blockers}</div>}
        </>
      )}
      {editable && (
        <PlanetPicker
          kind={DEPOSIT_PICKERS.blockers}
          target={target}
          extra={deposits.addWarnings}
        />
      )}
    </Section>
  );
}
