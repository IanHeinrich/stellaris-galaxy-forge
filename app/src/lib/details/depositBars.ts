/**
 * The deposits a scenario body can roll, as bars: one row per resource, its length the resource's
 * combined chance, split into one segment per amount.
 */
import type { DepositTypeView } from "../../generated/DepositTypeView";
import type { ResourceAmountView } from "../../generated/ResourceAmountView";
import { keyWords } from "../text";
import { formatAmount } from "./resources";
import { NEUTRAL_RAMP, resourceRamp, shadeIndex, textOn } from "./resourceColors";
import { percent, type PoolPick } from "./spawnFacts";

/** The narrowest share of the bar's track a segment shows its amount in. */
export const LABEL_MIN_SHARE = 0.12;

/** One amount of a resource the roll can give. */
export interface BarSegment {
  amount: number;
  /** `+2`. */
  label: string;
  /** The chance one roll gives this amount. */
  chance: number;
  /** Its share of its row's bar, 0 to 1. */
  share: number;
  /** Its amount shows inside it: it takes enough of the track. */
  labelled: boolean;
  fill: string;
  text: string;
  /** `+3 Energy Credits · 13%`. */
  title: string;
}

/** One row: a resource and the amounts of it the roll can give, or a deposit that yields nothing. */
export interface BarRow {
  key: string;
  name: string;
  /** The resource whose icon leads the row; null for a deposit that yields nothing. */
  icon: ResourceAmountView | null;
  /** The combined chance; null where the install can't tell it. */
  chance: number | null;
  /** Its bar's length as a share of the track, the likeliest row filling it. */
  width: number;
  /** Lowest amount first; one plain segment for a deposit that yields nothing. */
  segments: BarSegment[];
  title: string;
}

const signed = (n: number) => (n > 0 ? `+${formatAmount(n)}` : formatAmount(n));

/** A deposit's name with the `£icon£` tokens of its localisation taken out. */
function plainName(key: string, view: DepositTypeView | undefined): string {
  const named = view?.name.replace(/£[^£]*£/g, "").trim() ?? "";
  return /[a-z]/i.test(named) ? named : keyWords(key.replace(/^d_/, ""));
}

interface Gathered {
  key: string;
  name: string;
  icon: ResourceAmountView | null;
  resource: string | null;
  chance: number | null;
  amounts: Map<number, number>;
}

/**
 * The bar rows of a deposit pool, likeliest first: each resource's deposits gathered into one row
 * with a segment per amount, and each deposit that yields nothing, or whose chance the install
 * can't tell, in a row of its own.
 */
export function depositBars(
  picks: readonly PoolPick[],
  views: ReadonlyMap<string, DepositTypeView>,
): BarRow[] {
  const rows = new Map<string, Gathered>();
  for (const pick of picks) {
    const view = views.get(pick.key);
    const yields = view?.yields ?? [];
    if (yields.length === 0 || pick.chance === null) {
      rows.set(`deposit:${pick.key}`, {
        key: pick.key,
        name:
          yields.length > 0
            ? yields.map((y) => `${signed(y.amount)} ${y.name}`).join(", ")
            : plainName(pick.key, view),
        icon: yields[0] ?? null,
        resource: yields[0]?.resource ?? null,
        chance: pick.chance,
        amounts: new Map(),
      });
      continue;
    }
    for (const y of yields) {
      const key = `resource:${y.resource}`;
      const row = rows.get(key) ?? {
        key: y.resource,
        name: y.name,
        icon: y,
        resource: y.resource,
        chance: 0,
        amounts: new Map<number, number>(),
      };
      row.chance = (row.chance ?? 0) + pick.chance;
      row.amounts.set(y.amount, (row.amounts.get(y.amount) ?? 0) + pick.chance);
      rows.set(key, row);
    }
  }
  const gathered = [...rows.values()];
  const most = Math.max(0, ...gathered.map((r) => r.chance ?? 0));
  return gathered
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (b.row.chance ?? -1) - (a.row.chance ?? -1) || a.index - b.index)
    .map(({ row }) => barRow(row, most));
}

function barRow(row: Gathered, most: number): BarRow {
  const width = row.chance === null || most <= 0 ? 0 : row.chance / most;
  const shown = row.chance === null ? row.name : `${row.name} · ${percent(row.chance)}`;
  if (row.amounts.size === 0) {
    const fill = NEUTRAL_RAMP[1];
    const segment: BarSegment = {
      amount: 0,
      label: "",
      chance: row.chance ?? 0,
      share: 1,
      labelled: false,
      fill,
      text: textOn(1),
      title: shown,
    };
    return { ...rowBase(row), width, segments: row.chance === null ? [] : [segment], title: shown };
  }
  const ramp = resourceRamp(row.resource);
  const total = row.chance ?? 0;
  const amounts = [...row.amounts.entries()].sort((a, b) => a[0] - b[0]);
  const segments = amounts.map(([amount, chance], i): BarSegment => {
    const shade = shadeIndex(i, amounts.length);
    const share = total > 0 ? chance / total : 0;
    return {
      amount,
      label: signed(amount),
      chance,
      share,
      labelled: width * share >= LABEL_MIN_SHARE,
      fill: ramp[shade],
      text: textOn(shade),
      title: `${signed(amount)} ${row.name} · ${percent(chance)}`,
    };
  });
  const each = segments.map((s) => `${s.label} ${percent(s.chance)}`).join(", ");
  return { ...rowBase(row), width, segments, title: `${shown}: ${each}` };
}

function rowBase(row: Gathered): Pick<BarRow, "key" | "name" | "icon" | "chance"> {
  return { key: row.key, name: row.name, icon: row.icon, chance: row.chance };
}
