/**
 * A scenario system's modifiers: those its own effect block adds, as its page lists them, the
 * system the modifier picker adds to, and the ops that add and take one out.
 */
import type { EffectModifier } from "../../generated/EffectModifier";
import type { ModifierView } from "../../generated/ModifierView";
import type { Op } from "../../generated/Op";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { PickTarget } from "./picker";
import type { ModifierRow } from "./planetPage";

/** The system the modifier picker adds to. */
export interface SystemModifierTarget extends PickTarget {
  system: number;
  /** Its name, as the picker words what it holds. */
  name: string;
  /** The modifiers its own effect block adds, which an add refuses. */
  modifiers: readonly string[];
}

/** The modifiers a system's details list from the scenario's own effect block. */
export function systemModifiersOf(
  details: SystemDetails | null | undefined,
): readonly EffectModifier[] {
  return details?.spawn?.modifiers ?? [];
}

/** System `system`, named `name`, as the picker adds to it, holding `modifiers`. */
export function systemModifierTarget(
  system: number,
  name: string,
  modifiers: readonly EffectModifier[],
): SystemModifierTarget {
  return {
    key: `system:${system}`,
    system,
    name,
    modifiers: modifiers.map((m) => m.modifier),
  };
}

/** `modifier`'s row, as a planet's Modifiers section shows one an initializer gives. */
export function systemModifierRow(
  modifier: EffectModifier,
  views: ReadonlyMap<string, ModifierView>,
): ModifierRow {
  return {
    key: modifier.modifier,
    modifier: modifier.modifier,
    feature: false,
    days: modifier.days,
    view: views.get(modifier.modifier),
    stated: true,
  };
}

export function addSystemModifierOp(system: number, modifier: string): Op {
  return { type: "AddSystemModifier", system, modifier };
}

export function removeSystemModifierOp(system: number, modifier: string): Op {
  return { type: "RemoveSystemModifier", system, modifier };
}
