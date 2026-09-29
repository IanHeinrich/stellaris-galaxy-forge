/**
 * How a planet's page adds and removes deposits, modifiers, dig sites and an anomaly, whatever the
 * document is.
 * `planetEditAdapterFor` is the one place a source is chosen.
 */
import type { Op } from "../generated/Op";
import type { PlanetPage } from "../generated/PlanetPage";
import type { PickerTarget, PlanetEditAdapter } from "../lib/details/picker";
import type { ModifierRow } from "../lib/details/planetPage";
import {
  addAnomalyOp,
  addDepositOp,
  addDigSiteOp,
  addModifierOp,
  removeAnomalyOp,
  removeModifierOp,
} from "../lib/details/planetEdits";
import { useEditorStore } from "./editorStore";

/**
 * A save planet's edits, made by the save's own ops. A deposit row's ref is the deposit's id, a
 * modifier row's is the page's `ModifierRow`, and a dig site's is the site's id.
 */
function saveEdits(planet: number): PlanetEditAdapter {
  const apply = (op: Op) => useEditorStore.getState().applyOp(op);
  return {
    timedModifiers: true,
    addDeposit: (key) => apply(addDepositOp(planet, key)),
    removeDeposit: (ref) => apply({ type: "RemoveSaveDeposit", deposit: ref as number }),
    addModifier: (choice, days) => apply(addModifierOp(planet, choice, days)),
    removeModifier: (ref) => apply(removeModifierOp(planet, ref as ModifierRow)),
    addAnomaly: (category) => apply(addAnomalyOp(planet, category)),
    removeAnomaly: () => apply(removeAnomalyOp(planet)),
    addDigSite: (choice) => apply(addDigSiteOp(planet, choice)),
    removeDigSite: (ref) => apply({ type: "RemoveDigSite", site: ref as number }),
  };
}

/** The adapter that edits the body `page` shows. */
export function planetEditAdapterFor(page: PlanetPage): PlanetEditAdapter {
  return saveEdits(page.id);
}

/** The body `page` shows as its pickers read it, a moon when `moon`, with its adapter. */
export function planetPickerTarget(page: PlanetPage, moon: boolean): PickerTarget {
  return {
    key: `save-planet:${page.id}`,
    planetClass: page.class,
    size: page.size ?? 0,
    moon,
    deposits: page.deposits.map((d) => d.kind),
    modifiers: [...page.planet_modifiers, ...page.timed_modifiers.map((t) => t.modifier)],
    anomaly: page.anomaly,
    edits: planetEditAdapterFor(page),
  };
}
