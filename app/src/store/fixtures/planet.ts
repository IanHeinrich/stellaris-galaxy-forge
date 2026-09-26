import type { ColonyTypeView } from "../../generated/ColonyTypeView";
import type { DepositTypeView } from "../../generated/DepositTypeView";
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

export function colonyTypeView(key: string, over: Partial<ColonyTypeView> = {}): ColonyTypeView {
  return { key, name: key, icon: null, ...over };
}
