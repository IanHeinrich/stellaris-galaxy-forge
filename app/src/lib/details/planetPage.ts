/** What a save body's page lists: its deposits grouped by type, their district caps and its modifiers. */
import type { DepositTypeView } from "../../generated/DepositTypeView";
import type { ModifierView } from "../../generated/ModifierView";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { PlanetPageDeposit } from "../../generated/PlanetPageDeposit";
import { counted } from "../text";

/** Deposits of one type hiding the same feature, counted. */
export interface DepositGroup {
  kind: string;
  swapType: string | null;
  count: number;
  /** Undefined without game data, or for a type it does not define. */
  view: DepositTypeView | undefined;
}

export interface DepositGroups {
  features: DepositGroup[];
  blockers: DepositGroup[];
}

const RESOURCE_RANK: Record<string, number> = { energy: 1, minerals: 2, food: 3 };
const DISTRICT_RANK: Record<string, number> = {
  district_generator: 1,
  district_mining: 2,
  district_farming: 3,
};
const OTHER_RANK = 4;
const UNKNOWN_RANK = 5;

const DISTRICT_CAP = /^(district_\w+)_max_add$/;
const MAX_DISTRICTS = "planet_max_districts_add";
export const BLOCKER_ICON = "sprite:GFX_text_blocker";

/** Rare first, then what yields or adds districts for energy, minerals and food. */
function depositRank(group: DepositGroup): number {
  const view = group.view;
  if (view === undefined) return UNKNOWN_RANK;
  if (view.rare) return 0;
  const resource = view.yields[0]?.resource;
  if (resource !== undefined) return RESOURCE_RANK[resource] ?? OTHER_RANK;
  const district = view.effects.map((e) => DISTRICT_CAP.exec(e.key)?.[1]).find(Boolean);
  return district === undefined ? OTHER_RANK : (DISTRICT_RANK[district] ?? OTHER_RANK);
}

/** The planet's deposits one row per type, in the game's order, and its blockers apart. */
export function depositGroups(
  deposits: readonly PlanetPageDeposit[],
  views: ReadonlyMap<string, DepositTypeView>,
): DepositGroups {
  const groups = new Map<string, DepositGroup>();
  for (const deposit of deposits) {
    const key = `${deposit.kind}|${deposit.swap_type ?? ""}`;
    const group = groups.get(key);
    if (group !== undefined) group.count += 1;
    else
      groups.set(key, {
        kind: deposit.kind,
        swapType: deposit.swap_type,
        count: 1,
        view: views.get(deposit.kind),
      });
  }
  const all = [...groups.values()];
  return {
    features: all
      .filter((g) => g.view?.blocker !== true)
      .sort((a, b) => depositRank(a) - depositRank(b)),
    blockers: all.filter((g) => g.view?.blocker === true),
  };
}

/** One district cap the deposits add to or take from. */
export interface DistrictTotal {
  key: string;
  /** The modifier's localised name: the line's text after the amount it opens with. */
  label: string;
  amount: number;
  /** The district's icon; the blocker mark for a loss of districts of every kind; else none. */
  icon: string | null;
}

/** A modifier line is its signed amount, a space, then the modifier's name. */
function modifierName(text: string): string {
  const space = text.indexOf(" ");
  return space === -1 ? text : text.slice(space + 1);
}

/** Every district cap the deposits change, summed over their copies, gains before losses. */
export function districtTotals(groups: readonly DepositGroup[]): DistrictTotal[] {
  const totals = new Map<string, DistrictTotal>();
  for (const group of groups) {
    for (const effect of group.view?.effects ?? []) {
      const district = DISTRICT_CAP.exec(effect.key)?.[1];
      if (district === undefined && effect.key !== MAX_DISTRICTS) continue;
      const total = totals.get(effect.key) ?? {
        key: effect.key,
        label: modifierName(effect.text),
        amount: 0,
        icon: district === undefined ? null : `sprite:GFX_${district}`,
      };
      total.amount += effect.value * group.count;
      totals.set(effect.key, total);
    }
  }
  return [...totals.values()]
    .filter((t) => t.amount !== 0)
    .map((t) => (t.icon === null && t.amount < 0 ? { ...t, icon: BLOCKER_ICON } : t))
    .sort((a, b) => Number(a.amount < 0) - Number(b.amount < 0) || b.amount - a.amount);
}

/** A planet or timed modifier as one row: a `pm_*` carries the days of the timed one it applies. */
export interface ModifierRow {
  key: string;
  /** Days left, `-1` for permanent, `null` when no timed modifier matches. */
  days: number | null;
  view: ModifierView | undefined;
}

export function modifierRows(
  page: PlanetPage,
  views: ReadonlyMap<string, ModifierView>,
): ModifierRow[] {
  const timed = new Map(page.timed_modifiers.map((t) => [t.modifier, t.days]));
  const paired = new Set<string>();
  const rows: ModifierRow[] = page.planet_modifiers.map((key) => {
    const view = views.get(key);
    const applied = view?.static_modifier ?? key.replace(/^pm_/, "");
    const days = timed.get(applied);
    if (days !== undefined) paired.add(applied);
    return { key, days: days ?? null, view };
  });
  for (const t of page.timed_modifiers) {
    if (!paired.has(t.modifier))
      rows.push({ key: t.modifier, days: t.days, view: views.get(t.modifier) });
  }
  return rows;
}

export function daysLeft(days: number): string {
  return days < 0 ? "permanent" : `${counted(days, "day")} left`;
}

/** Every game data key the page shows, for one read per kind. */
export function planetDataKeys(page: PlanetPage) {
  const colony = page.colony;
  return {
    deposits: page.deposits.flatMap((d) =>
      d.swap_type === null ? [d.kind] : [d.kind, d.swap_type],
    ),
    modifiers: [...page.planet_modifiers, ...page.timed_modifiers.map((t) => t.modifier)],
    colonyTypes: [colony?.final_designation, colony?.designation].filter(
      (key): key is string => typeof key === "string",
    ),
  };
}
