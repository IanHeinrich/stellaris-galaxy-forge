/**
 * A save's row of `PLANET_EDITS`: the save's own op for each field of a body, and its removals.
 * A save takes no ranges.
 */
import type { PlanetPageDeposit } from "../generated/PlanetPageDeposit";
import { classRule } from "../lib/details/planetClass";
import { PERMANENT } from "../lib/details/planetEdits";
import { DEFAULT_MODEL } from "../lib/details/planetModel";
import type { ModifierRow } from "../lib/details/planetPage";
import { classForBodies } from "../lib/details/starBody";
import type { BodyOps } from "./planetEditAdapter";
import { deletePlanet, removeColony } from "./planetRemoval";

/** What a save's rows give back to remove one: the deposit, the page's modifier row, the site's id. */
export interface SaveRowRefs {
  deposit: PlanetPageDeposit;
  modifier: ModifierRow;
  digSite: number;
}

export const SAVE_BODY_OPS: BodyOps<SaveRowRefs> = {
  ranges: false,
  timedModifiers: true,
  rename(body, text, current) {
    const name = text.trim();
    if (name === "" || name === current) return null;
    return { type: "RenameBody", body, name: { Literal: name } };
  },
  setSize(body, { min, max }, current) {
    if (min !== max || !Number.isInteger(min) || min < 1 || min === current) return null;
    return { type: "SetBodySize", body, size: min };
  },
  setClass(body, key, current, planetClasses) {
    const from = planetClasses.get(current);
    const to = planetClasses.get(key);
    if (from === undefined || to === undefined || key === current) return null;
    return { type: "SetBodyClass", body, from: classRule(from), to: classRule(to) };
  },
  setModel(body, key, current) {
    const entity = key === DEFAULT_MODEL ? null : key;
    if (entity === current) return null;
    return { type: "SetBodyModel", body, entity };
  },
  setRing: (body, ring) => ({ type: "SetBodyRing", body, ring }),
  setStarType(body, planetClass, system, starClasses) {
    const next = system.bodies.map((b) => (b.id === body ? planetClass : b.class));
    return {
      type: "SetStarClass",
      system: system.id,
      class: classForBodies(next, system.star_class, starClasses) ?? system.star_class,
      bodies: [{ body, class: planetClass }],
    };
  },
  addDeposit: (body, kind) => ({ type: "AddDeposit", body, kind }),
  removeDeposit: (deposit) => ({ type: "RemoveDeposit", deposit: deposit.id }),
  addModifier: (body, pick, days) => ({
    type: "AddBodyModifier",
    body,
    modifier: pick.modifier,
    days: [days ?? PERMANENT],
    ...(pick.feature === null ? {} : { feature: pick.feature }),
  }),
  removeModifier: (body, row) => ({
    type: "RemoveBodyModifier",
    body,
    modifier: row.modifier,
    ...(row.feature ? { feature: row.key } : {}),
  }),
  addAnomaly: (body, category) => ({ type: "AddAnomaly", body, category }),
  removeAnomaly: (body) => ({ type: "RemoveAnomaly", body }),
  addDigSite: (body, choice) => ({
    type: "AddDigSite",
    body,
    site_type: choice.key,
    difficulty: choice.difficulty,
  }),
  removeDigSite: (site) => ({ type: "RemoveDigSite", site }),
  remove: deletePlanet,
  removeColony,
};
