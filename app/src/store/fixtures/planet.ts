import type { ColonyTypeView } from "../../generated/ColonyTypeView";
import type { DepositTypeView } from "../../generated/DepositTypeView";
import type { ModifierLineView } from "../../generated/ModifierLineView";
import type { ModifierView } from "../../generated/ModifierView";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { ResourceAmountView } from "../../generated/ResourceAmountView";
import { name } from "../../test/builders";

/** The one `PlanetPage` builder: an unowned, unsurveyed world with nothing on or around it. */
export function planetPage(over: Partial<PlanetPage> = {}): PlanetPage {
  return {
    id: 1207,
    name: name("NAME_Planet"),
    name_key: "NAME_Planet",
    label: "NAME_Planet",
    class: "pc_continental",
    size: 16,
    orbit: null,
    system: 1,
    parent: null,
    moons: [],
    deposits: [],
    planet_modifiers: [],
    timed_modifiers: [],
    surveyed_by: null,
    station: null,
    owner: null,
    controller: null,
    colony: null,
    flags: 0,
    ...over,
  };
}

/** `+3 Max Agriculture Districts`: a modifier line as the game's tooltip prints it. */
export function modifierLine(key: string, value: number, text: string): ModifierLineView {
  return { key, value, text };
}

export function resourceAmount(
  resource: string,
  amount: number,
  label: string,
): ResourceAmountView {
  return { resource, amount, name: label, icon: `sprite:GFX_resource_${resource}` };
}

/** The one `DepositTypeView` builder: a named planetary feature with no effect. */
export function depositTypeView(key: string, over: Partial<DepositTypeView> = {}): DepositTypeView {
  return {
    key,
    name: key,
    texture_key: `deposit:${key}`,
    blocker: false,
    rare: false,
    orbital: false,
    category: null,
    station: null,
    yields: [],
    effects: [],
    side_effects: [],
    clearing: null,
    ...over,
  };
}

export function modifierView(key: string, over: Partial<ModifierView> = {}): ModifierView {
  return {
    key,
    name: key,
    static_modifier: null,
    icon: null,
    icon_frame: null,
    effects: [],
    ...over,
  };
}

export function colonyTypeView(key: string, over: Partial<ColonyTypeView> = {}): ColonyTypeView {
  return { key, name: key, icon: null, ...over };
}
