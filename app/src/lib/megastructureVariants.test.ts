import { describe, expect, it } from "vitest";
import type { MegastructureView } from "../generated/MegastructureView";
import { gigaStarSwaps, megastructureFits, megastructureTypeView } from "../test/builders";
import { entryStages, megastructureEntries } from "./megastructurePicks";

const GIGA = "Gigastructural Engineering";
const giga = { source: GIGA, base_game: false } as const;
const onStar = { placement: { place: "body", star_only: true } } as const;
const DYSON = "giga_dyson_scaling";
const BRAIN = "giga_matroishka_scaling";
const notBuilt = { offer: { offer: "hidden", why: "not_built" } } as const;

/** Types each built over the one before, the first over `first`. */
function chain(
  keys: readonly string[],
  over: Partial<MegastructureView> = {},
  first: string[] = [],
): MegastructureView[] {
  return keys.map((key, i) =>
    megastructureTypeView(key, { upgrade_from: i === 0 ? first : [keys[i - 1]], ...over }),
  );
}

/** `<prefix>_<i>_<star>_star` for each stage, built over `first`. */
const starChain = (prefix: string, star: string, stages: number[], first: string) =>
  chain(
    stages.map((i) => `${prefix}_${i}_${star}_star`),
    { ...onStar, ...giga, ...notBuilt },
    [first],
  );

/**
 * Giga's star-scaled megastructures as the registry reads them. The Dyson Swarm swaps its finished
 * stage, under the scaling flag by star class and without it for `_basic`. The Dyson Sphere and
 * the Matrioshka Brain swap their first stage, for an O star whatever the flags, and the class
 * chains run on from there.
 */
const TYPES: ReadonlyMap<string, MegastructureView> = new Map(
  [
    ...chain(["dyson_swarm_1", "dyson_swarm_2"], { ...onStar, ...giga }),
    megastructureTypeView("dyson_swarm_3", {
      upgrade_from: ["dyson_swarm_2"],
      swaps: gigaStarSwaps("dyson_swarm_3", { scaling: DYSON, basic: "dyson_swarm_3_basic" }),
      ...onStar,
      ...giga,
    }),
    ...["basic", "b_star", "m_star"].map((end) =>
      megastructureTypeView(`dyson_swarm_3_${end}`, {
        upgrade_from: ["dyson_swarm_3"],
        ...onStar,
        ...giga,
        ...notBuilt,
      }),
    ),
    megastructureTypeView("dyson_sphere_0", {
      swaps: gigaStarSwaps("dyson_sphere_0", { scaling: DYSON, o: true }),
      ...onStar,
      ...giga,
    }),
    ...chain(["dyson_sphere_1", "dyson_sphere_2", "dyson_sphere_3"], { ...onStar, ...giga }, [
      "dyson_sphere_0",
    ]),
    ...starChain("dyson_sphere", "b", [0, 1, 2, 3], "dyson_sphere_0"),
    ...starChain("dyson_sphere", "o", [0, 1, 2, 3], "dyson_sphere_0"),
    ...starChain("dyson_sphere", "a", [0, 1], "dyson_sphere_0"),
    megastructureTypeView("dyson_sphere_2_b_star_swarm", {
      upgrade_from: ["dyson_swarm_3_b_star"],
      ...onStar,
      ...giga,
    }),
    megastructureTypeView("dyson_sphere_ruined", {
      variant_of: "dyson_sphere_0",
      ...onStar,
      ...giga,
    }),
    megastructureTypeView("dyson_sphere_restored", {
      variant_of: "dyson_sphere_0",
      upgrade_from: ["dyson_sphere_ruined"],
      ...onStar,
      ...giga,
    }),
    megastructureTypeView("dyson_sphere_ruined_b_star", {
      variant_of: "dyson_sphere_0",
      ...onStar,
      ...giga,
    }),
    megastructureTypeView("dyson_sphere_restored_b_star", {
      variant_of: "dyson_sphere_0",
      upgrade_from: ["dyson_sphere_ruined_b_star"],
      ...onStar,
      ...giga,
    }),
    megastructureTypeView("matrioshka_brain_0_g_star", {
      swaps: gigaStarSwaps("matrioshka_brain_0", { scaling: BRAIN, o: true, skip: ["g"] }),
      ...onStar,
      ...giga,
    }),
    ...chain(["matrioshka_brain_1_g_star"], { ...onStar, ...giga }, ["matrioshka_brain_0_g_star"]),
    ...starChain("matrioshka_brain", "b", [0, 1], "matrioshka_brain_0_g_star"),
    ...starChain("matrioshka_brain", "o", [0, 1], "matrioshka_brain_0_g_star"),
  ].map((type) => [type.key, type]),
);

const NAMES = new Map([
  ["dyson_swarm_3", "Dyson Swarm"],
  ["dyson_sphere_3", "Dyson Sphere"],
  ["matrioshka_brain_1_g_star", "Matrioshka Brain"],
]);

const SPHERE = ["dyson_sphere_0", "dyson_sphere_1", "dyson_sphere_2", "dyson_sphere_3"];

describe("the rows of a megastructure that swaps by star class", () => {
  const listed = megastructureEntries(TYPES, NAMES, megastructureFits(TYPES.keys()));
  const keys = (label: string) =>
    listed.find((entry) => entry.label === label)?.chains.map((c) => c.stages.map((s) => s.key));

  it("has no star-class rows, no star-class ruins, and says it goes by star class", () => {
    expect(keys("Dyson Sphere")).toEqual([
      SPHERE,
      ["dyson_sphere_ruined", "dyson_sphere_restored"],
    ]);
    expect(keys("Dyson Swarm")).toEqual([["dyson_swarm_1", "dyson_swarm_2", "dyson_swarm_3"]]);
    const summary = (label: string) => listed.find((entry) => entry.label === label)?.summary;
    expect(summary("Dyson Sphere")).toBe("4 stages · by star class · ruins");
    expect(summary("Dyson Swarm")).toBe("3 stages · by star class");
    expect(summary("Matrioshka Brain")).toBe("2 stages · by star class");
    const stages = listed.flatMap(entryStages).map((s) => s.key);
    expect(stages.filter((key) => /_(b|o|a|m)_star|_basic/.test(key))).toEqual([]);
  });
});
