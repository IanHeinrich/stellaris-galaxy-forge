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
  /** The deposits that give this amount, by the names that say more than the amount. */
  deposits: string[];
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
  /** `Energy Credits · 44%`: what its card heads with. */
  heading: string;
  /** A deposit that yields nothing, or whose chance the install can't tell: no amounts to list. */
  plain: boolean;
}

/** What a deposit row's card says under its amounts. */
export const DEPOSIT_CARD_NOTE = "Chance one deposit the game rolls here is this one.";

const signed = (n: number) => (n > 0 ? `+${formatAmount(n)}` : formatAmount(n));

/**
 * A deposit's own name with the `£icon£` tokens of its localisation taken out; null where nothing
 * but the amount is left.
 */
function ownName(view: DepositTypeView | undefined): string | null {
  const named = view?.name.replace(/£[^£]*£/g, "").trim() ?? "";
  return /[a-z]/i.test(named) ? named : null;
}

/** A deposit's name: its own, else its key in words. */
function plainName(key: string, view: DepositTypeView | undefined): string {
  return ownName(view) ?? keyWords(key.replace(/^d_/, ""));
}

interface Amount {
  chance: number;
  deposits: string[];
}

interface Gathered {
  key: string;
  name: string;
  icon: ResourceAmountView | null;
  resource: string | null;
  chance: number | null;
  amounts: Map<number, Amount>;
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
        amounts: new Map<number, Amount>(),
      };
      row.chance = (row.chance ?? 0) + pick.chance;
      const amount = row.amounts.get(y.amount) ?? { chance: 0, deposits: [] };
      amount.chance += pick.chance;
      const own = ownName(view);
      if (own !== null && !amount.deposits.includes(own)) amount.deposits.push(own);
      row.amounts.set(y.amount, amount);
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
      deposits: [],
    };
    const segments = row.chance === null ? [] : [segment];
    return { ...rowBase(row), width, segments, heading: shown, plain: true };
  }
  const ramp = resourceRamp(row.resource);
  const total = row.chance ?? 0;
  const amounts = [...row.amounts.entries()].sort((a, b) => a[0] - b[0]);
  const segments = amounts.map(([amount, { chance, deposits }], i): BarSegment => {
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
      deposits,
    };
  });
  return { ...rowBase(row), width, segments, heading: shown, plain: false };
}

function rowBase(row: Gathered): Pick<BarRow, "key" | "name" | "icon" | "chance"> {
  return { key: row.key, name: row.name, icon: row.icon, chance: row.chance };
}
