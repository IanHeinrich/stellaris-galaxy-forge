import type { ColonyTypeView } from "../../generated/ColonyTypeView";
import type { DepositTypeView } from "../../generated/DepositTypeView";
import type { ModifierChoice } from "../../generated/ModifierChoice";
import type { ModifierLineView } from "../../generated/ModifierLineView";
import type { ModifierView } from "../../generated/ModifierView";
import type { ResourceAmountView } from "../../generated/ResourceAmountView";

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

/**
 * The one `ModifierChoice` builder: modifier `modifier`, named `name`, that sets no flags. With
 * `over.feature` it is that feature's, in the Feature category.
 */
export function modifierChoice(
  modifier: string,
  name: string,
  over: Partial<ModifierChoice> = {},
): ModifierChoice {
  const feature = over.feature ?? null;
  return {
    modifier,
    feature,
    category: feature === null ? "Positive" : "Feature",
    flags: [],
    description: null,
    view: modifierView(feature ?? modifier, { name, static_modifier: modifier }),
    ...over,
  };
}

export function colonyTypeView(key: string, over: Partial<ColonyTypeView> = {}): ColonyTypeView {
  return { key, name: key, icon: null, ...over };
}
