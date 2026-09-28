/** The edits a save body's page offers beside its star's: its name, its size and its deposits. */
import type { DepositTypeView } from "../../generated/DepositTypeView";
import type { ModifierLineView } from "../../generated/ModifierLineView";
import type { Op } from "../../generated/Op";
import type { PlanetPage } from "../../generated/PlanetPage";

/** The remove button's hover text on a deposit a station works. */
export const STATION_STAYS =
  "Remove one. The station working it stays in game and still costs about 1 energy a month.";

/** Whether nobody owns the body: the game lets only such a body's size and deposits change here. */
export function uncolonised(page: PlanetPage): boolean {
  return page.owner === null && page.colony === null;
}

/** The edit that renames planet `id` to `text`, trimmed; `null` for an empty or unchanged name. */
export function renamePlanetOp(id: number, current: string, text: string): Op | null {
  const name = text.trim();
  if (name === "" || name === current) return null;
  return { type: "RenameSavePlanet", planet: id, name };
}

export function addDepositOp(planet: number, kind: string): Op {
  return { type: "AddSaveDeposit", planet, kind };
}

/** The edit that takes one deposit of type `kind` hiding `swapType` off the page's planet: its last. */
export function removeDepositOp(
  page: PlanetPage,
  kind: string,
  swapType: string | null,
): Op | null {
  const ids = page.deposits
    .filter((d) => d.kind === kind && d.swap_type === swapType)
    .map((d) => d.id);
  const last = ids[ids.length - 1];
  return last === undefined ? null : { type: "RemoveSaveDeposit", deposit: last };
}

/** The group the types the game would place on the planet lead the picker under. */
export const USUAL_GROUP = "Usual for this planet";

/** One deposit type the add picker offers. */
export interface DepositChoice {
  key: string;
  label: string;
  view: DepositTypeView | undefined;
  group: typeof USUAL_GROUP | "Features" | "Blockers";
  /** What the picker's filter matches: the name, and each yield's resource or each effect. */
  search: string;
}

/**
 * What a type is called in the picker: the resources an orbital deposit yields, whose own name is
 * only its amount ("+10"), or else its localised name, or its key without a view.
 */
function choiceLabel(key: string, view: DepositTypeView | undefined): string {
  if (view === undefined) return key;
  if (view.yields.length > 0) return view.yields.map((y) => y.name).join(" and ");
  return view.name || key;
}

/** One effect of a type as the picker words it: a lost district as what it blocks. */
export function effectText(effect: ModifierLineView): string {
  if (effect.key === "planet_max_districts_add" && effect.value < 0) {
    const n = -effect.value;
    return `Blocks ${n} ${n === 1 ? "district" : "districts"}`;
  }
  return effect.text;
}

/**
 * Every type offered, as `[key, fits]`: those that fit the planet first, then the other features,
 * then the other blockers, each group by name. A type with no view is named by its key.
 */
export function depositChoices(
  offered: readonly (readonly [string, boolean])[],
  views: ReadonlyMap<string, DepositTypeView>,
): DepositChoice[] {
  const choices = offered.map(([key, fits]): DepositChoice => {
    const view = views.get(key);
    const label = choiceLabel(key, view);
    const gives =
      view === undefined
        ? []
        : [...view.yields.map((y) => y.name), ...view.effects.map(effectText)];
    return {
      key,
      label,
      view,
      group: fits ? USUAL_GROUP : view?.blocker === true ? "Blockers" : "Features",
      search: [label, ...gives].join(" ").toLowerCase(),
    };
  });
  const rank = (c: DepositChoice) => ({ [USUAL_GROUP]: 0, Features: 1, Blockers: 2 })[c.group];
  return choices.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}
