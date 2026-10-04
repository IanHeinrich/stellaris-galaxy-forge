/**
 * The Model field of a save planet's page: the models it offers, those the game uses on the
 * planet's class first, and the edit a pick sends.
 */
import type { Op } from "../../generated/Op";
import type { PlanetModelChoice } from "../../generated/PlanetModelChoice";

/** The row that takes the planet's own model off, back to its class's. */
export const DEFAULT_MODEL = "";
export const DEFAULT_MODEL_LABEL = "Default";

/** The Model field's hover text. */
export const MODEL_TITLE =
  "Change how this planet looks. Changing its class in game, by terraforming for example, puts back its class's look.";

/** The Model field's hover text while no game data lists the models. */
export const MODELS_NEED_GAME_DATA = "Load game data to pick a model";

export interface ModelRow {
  key: string;
  label: string;
  /** The header it sits under; the Default row has none. */
  group?: string;
}

/** The label the field shows for `current`: its model's, its key where no model matches, or Default. */
export function modelLabel(models: readonly PlanetModelChoice[], current: string | null): string {
  if (current === null) return DEFAULT_MODEL_LABEL;
  return models.find((m) => m.entity === current)?.label ?? current;
}

/**
 * Default, then the models the game uses on `planetClass` under "Usual for" the class's name, then
 * every other. A model the planet has that `models` lacks is listed with the usual ones, by key.
 */
export function modelRows(
  models: readonly PlanetModelChoice[],
  planetClass: string,
  className: string,
  current: string | null,
): ModelRow[] {
  const usualGroup = `Usual for ${className}`;
  const usual: ModelRow[] = [];
  const other: ModelRow[] = [];
  for (const model of models) {
    const row = { key: model.entity, label: model.label };
    if (model.classes.includes(planetClass)) usual.push({ ...row, group: usualGroup });
    else other.push({ ...row, group: "Other models" });
  }
  if (current !== null && !models.some((m) => m.entity === current)) {
    usual.unshift({ key: current, label: current, group: usualGroup });
  }
  return [{ key: DEFAULT_MODEL, label: DEFAULT_MODEL_LABEL }, ...usual, ...other];
}

/** The edit that gives planet `planet` the model `key`, or takes its own off; `null` when unchanged. */
export function setPlanetModelOp(planet: number, current: string | null, key: string): Op | null {
  const entity = key === DEFAULT_MODEL ? null : key;
  if (entity === current) return null;
  return { type: "SetBodyModel", body: planet, entity };
}
