/**
 * Each resource's colour as the game shows it, as a ramp of four widely spaced shades from
 * lightest to darkest, for bars that tell a resource's amounts apart by shade.
 */

/** Four shades of one colour, lightest first. */
export type Ramp = readonly [string, string, string, string];

const RAMPS: Record<string, Ramp> = {
  energy: ["#ffe08a", "#ffc23d", "#d99100", "#8a5a00"],
  minerals: ["#ffb3ab", "#f2685c", "#c62f22", "#7a170f"],
  food: ["#cdf2ad", "#8fd75a", "#4f9f22", "#2a5c0f"],
  physics_research: ["#b9ddff", "#5eaef5", "#1f72c4", "#0e4076"],
  society_research: ["#bdf0d2", "#5fcf8f", "#22924f", "#0f562d"],
  engineering_research: ["#ffd2a8", "#ff9a45", "#d2620c", "#7c3804"],
  trade: ["#b4eee9", "#4fcdc2", "#138f86", "#06524d"],
  alloys: ["#e4c6ff", "#b77df0", "#7f3fc0", "#481d76"],
  consumer_goods: ["#ffe2b5", "#f7b356", "#c27a14", "#734507"],
  influence: ["#f3cdf9", "#d887e6", "#a043b5", "#5f2170"],
  unity: ["#f6f0b0", "#e3d45a", "#ad9c1c", "#655a09"],
  exotic_gases: ["#c9f3e3", "#6ed9b2", "#2a9c74", "#125a42"],
  rare_crystals: ["#ffc9e4", "#f47dbb", "#c23b83", "#74194c"],
  volatile_motes: ["#ffd6bf", "#f99a6a", "#cc5a27", "#7a2f0e"],
  sr_dark_matter: ["#d6cdf5", "#9a86e0", "#5d45a8", "#322263"],
  sr_living_metal: ["#d9e4ec", "#9fb7c8", "#5e7d93", "#334957"],
  sr_zro: ["#d2f0ff", "#7dcdf2", "#2c90c0", "#134f6c"],
  nanites: ["#dfe3ea", "#a8b1c2", "#677285", "#383f4d"],
};

/** The ramp of a resource no entry names: a neutral grey. */
export const NEUTRAL_RAMP: Ramp = ["#e1e4e9", "#aab0ba", "#6b7280", "#3a3f49"];

/** A resource's ramp, the neutral grey where the table has none. */
export function resourceRamp(resource: string | null): Ramp {
  return (resource === null ? undefined : RAMPS[resource]) ?? NEUTRAL_RAMP;
}

/** Which shade of four the `index`th of `count` amounts takes, lowest amount lightest. */
export function shadeIndex(index: number, count: number): number {
  if (count <= 1) return 1;
  return Math.round((index * 3) / (count - 1));
}

/** Text that reads on a shade: dark on the two lighter ones, light on the two darker. */
export function textOn(shade: number): string {
  return shade <= 1 ? "#1b1f27" : "#f4f6fa";
}
