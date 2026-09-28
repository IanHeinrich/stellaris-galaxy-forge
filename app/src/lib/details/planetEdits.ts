/** The edits a save body's page offers beside its star's: its name, its size and its deposits. */
import type { DepositTypeView } from "../../generated/DepositTypeView";
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

/** One deposit type the add picker offers. */
export interface DepositChoice {
  key: string;
  label: string;
  view: DepositTypeView | undefined;
  group: "Features" | "Blockers";
}

/** The fitting types by name, the features before the blockers; a type with no view by its key. */
export function depositChoices(
  keys: readonly string[],
  views: ReadonlyMap<string, DepositTypeView>,
): DepositChoice[] {
  const choices = keys.map((key): DepositChoice => {
    const view = views.get(key);
    return {
      key,
      label: view?.name || key,
      view,
      group: view?.blocker === true ? "Blockers" : "Features",
    };
  });
  const rank = (c: DepositChoice) => (c.group === "Features" ? 0 : 1);
  return choices.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}
