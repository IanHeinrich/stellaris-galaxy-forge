import { useMemo } from "react";
import type { DepositTypeView } from "../../../generated/DepositTypeView";
import type { PlanetPage } from "../../../generated/PlanetPage";
import type { ResourceAmountView } from "../../../generated/ResourceAmountView";
import { formatAmount, resourceAbbrev } from "../../../lib/details/resources";
import {
  BLOCKER_ICON,
  depositGroups,
  districtTotals,
  type DepositGroup,
  type DistrictTotal,
} from "../../../lib/details/planetPage";
import { capabilityFor } from "../../../lib/entities";
import { templateName } from "../../../lib/names";
import { counted, thousands } from "../../../lib/text";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { Icon } from "../../parts";
import { DrillLink, Section } from "../parts";
import { useEntityView, useOpenEntity } from "./useEntity";

const ROOT: readonly string[] = [];

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

/** A type the game data does not describe: its key, as the save writes it. */
function PlainDepositRow({ group }: { group: DepositGroup }) {
  return (
    <div className="pl-dep plain">
      <span>
        <span className="l1 mono">{group.kind}</span>
        <Hides swapType={group.swapType} />
      </span>
      <Count count={group.count} />
    </div>
  );
}

function DepositRow({ group, station }: { group: DepositGroup; station: number | null }) {
  const view = group.view;
  if (view === undefined) return <PlainDepositRow group={group} />;
  const extracted = view.yields.length > 0;
  const effects = view.effects.map((e) => e.text).join(" · ");
  return (
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
      </span>
      <Count count={group.count} />
    </div>
  );
}

/** A body's deposits: the district caps they add up to, one row per type, and the blockers apart. */
export function PlanetDeposits({ page }: { page: PlanetPage }) {
  const views = usePlanetDataStore((s) => s.depositTypes);
  const ready = useGameDataStore((s) => s.status === "ready");
  if (page.deposits.length === 0) return null;
  const { features, blockers } = depositGroups(page.deposits, views);
  const totals = ready ? districtTotals([...features, ...blockers]) : [];
  const blocked = blockers.reduce((n, g) => n + g.count, 0);
  return (
    <Section
      id="planet.deposits"
      title="Deposits"
      count={page.deposits.length}
      summary={blocked > 0 ? counted(blocked, "blocker") : undefined}
    >
      {totals.length > 0 && <DistrictStrip totals={totals} />}
      {features.map((g) => (
        <DepositRow key={`${g.kind}|${g.swapType ?? ""}`} group={g} station={page.station} />
      ))}
      {blockers.length > 0 && (
        <>
          <div className="pl-sub-head">
            <Icon className="gi" keys={[BLOCKER_ICON]} glyph="" />
            Blockers · {blocked}
          </div>
          {blockers.map((g) => (
            <DepositRow key={`${g.kind}|${g.swapType ?? ""}`} group={g} station={page.station} />
          ))}
        </>
      )}
    </Section>
  );
}
