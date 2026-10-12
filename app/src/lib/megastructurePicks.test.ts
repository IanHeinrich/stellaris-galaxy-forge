import { describe, expect, it } from "vitest";
import type { MegastructureView } from "../generated/MegastructureView";
import { megastructureSummary, megastructureSwap, megastructureTypeView } from "../test/builders";
import {
  BODY_HAS_MEGASTRUCTURE,
  CHANGES_BODY,
  RING_WORLD,
  UNNAMED_TYPES,
  WHOLE_STRUCTURE,
  addLabel,
  defaultStage,
  entryHeading,
  entryStages,
  findStage,
  matchingEntries,
  megastructureEntries,
  selectedStage,
  megastructurePlace,
  megastructureRefusal,
  RELAY_RADIUS_FACTOR,
  stageLine,
  type MegastructureEntry,
  type MegastructureSpot,
} from "./megastructurePicks";

const onStar = { place: "body", star_only: true } as const;
const onAny = { place: "body", star_only: false } as const;
const outside = { place: "free", outside_gravity_well: true } as const;
const inside = { place: "free", outside_gravity_well: false } as const;
const GIGA = "Gigastructural Engineering";
const giga = { source: GIGA, base_game: false } as const;

const ruin = (key: string, of: string, over: Partial<MegastructureView> = {}) =>
  megastructureTypeView(key, { variant_of: of, ...over });
const hidden = (why: "not_built" | "ship_entity" | "leaves_fleet" | "not_offered_yet") =>
  ({ offer: "hidden", why }) as const;

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

/**
 * The install's types with Giga over them, in file order, shaped as the registry reads them:
 * Giga's star-class Dyson Spheres are built over the base game's site, its Star Lifter turns
 * into one per star class, and a Dyson Sphere stage is built over a finished Dyson Swarm.
 */
const TYPES: ReadonlyMap<string, MegastructureView> = new Map(
  [
    megastructureTypeView("think_tank_1", { upgrade_from: ["think_tank_0"], placement: onAny }),
    megastructureTypeView("think_tank_0", { placement: onAny }),
    megastructureTypeView("think_tank_3", { upgrade_from: ["think_tank_1"], placement: onAny }),
    megastructureTypeView("think_tank_4", {
      upgrade_from: ["think_tank_3"],
      placement: onAny,
      script_only: true,
      offer: hidden("not_built"),
    }),
    ...chain(
      [
        "mega_art_installation_0",
        "mega_art_installation_1",
        "mega_art_installation_2",
        "mega_art_installation_3",
      ],
      { placement: onAny },
    ),
    ruin("think_tank_ruined", "think_tank_1", { placement: onAny }),
    ruin("think_tank_permanently_ruined", "think_tank_1", { placement: onAny }),
    ruin("think_tank_restored", "think_tank_1", {
      upgrade_from: ["think_tank_ruined"],
      placement: onAny,
    }),
    ...chain(["dyson_sphere_0", "dyson_sphere_5"], { placement: onStar, source: GIGA }),
    ruin("dyson_sphere_ruined", "dyson_sphere_0", { placement: onStar, source: GIGA }),
    ruin("dyson_sphere_restored", "dyson_sphere_0", {
      upgrade_from: ["dyson_sphere_ruined"],
      placement: onStar,
      source: GIGA,
    }),
    ...chain(
      ["dyson_sphere_0_a_star", "dyson_sphere_1_a_star", "dyson_sphere_2_a_star"],
      { placement: onStar, ...giga },
      ["dyson_sphere_0"],
    ).map((type) =>
      type.key === "dyson_sphere_2_a_star"
        ? { ...type, upgrade_from: [...type.upgrade_from, "dyson_swarm_3"] }
        : type,
    ),
    megastructureTypeView("dyson_sphere_5_a_star", {
      upgrade_from: ["dyson_sphere_2_a_star"],
      placement: onStar,
      ...giga,
    }),
    ...chain(["dyson_sphere_0_o_star", "dyson_sphere_5_o_star"], { placement: onStar, ...giga }, [
      "dyson_sphere_0",
    ]),
    ruin("dyson_sphere_ruined_a_star", "dyson_sphere_0", { placement: onStar, ...giga }),
    ruin("dyson_sphere_restored_a_star", "dyson_sphere_0", {
      upgrade_from: ["dyson_sphere_ruined_a_star"],
      placement: onStar,
      ...giga,
    }),
    ...chain(["dyson_swarm_1", "dyson_swarm_3"], { placement: onStar, ...giga }),
    megastructureTypeView("star_lifter_0", {
      placement: onStar,
      turns_into: ["star_lifter_0_o_star"],
      swaps: [megastructureSwap("star_lifter_0_o_star", { classes: ["pc_o_star"] })],
      ...giga,
    }),
    megastructureTypeView("star_lifter_5", {
      upgrade_from: ["star_lifter_0"],
      placement: onStar,
      ...giga,
    }),
    ...chain(["star_lifter_0_o_star", "star_lifter_5_o_star"], { placement: onStar, ...giga }),
    megastructureTypeView("automated_stripmine_1", {
      placement: { place: "unsupported", why: { kind: "changes_body" } },
      ...giga,
    }),
    megastructureTypeView("alderson_disk_1", {
      placement: { place: "unsupported", why: { kind: "whole_structure", star_only: true } },
      ...giga,
    }),
    megastructureTypeView("uf_hyperlane_a", { placement: onStar, ...giga }),
    megastructureTypeView("gateway_0", { placement: outside, source: GIGA }),
    megastructureTypeView("gateway_final", {
      upgrade_from: ["gateway_0"],
      placement: outside,
      bypass_type: "gateway",
      source: GIGA,
    }),
    ruin("gateway_derelict", "gateway_0", {
      placement: outside,
      bypass_type: "gateway",
      offer: hidden("not_built"),
    }),
    megastructureTypeView("blokkat_dummy_mega", {
      upgrade_from: ["gateway_final"],
      placement: outside,
      script_only: true,
      source: GIGA,
    }),
    megastructureTypeView("hyper_relay", { placement: outside, bypass_type: "relay_bypass" }),
    megastructureTypeView("shroud_seal", { placement: inside, offer: hidden("not_offered_yet") }),
    megastructureTypeView("colossus_dummy", {
      placement: onStar,
      script_only: true,
      offer: hidden("ship_entity"),
    }),
    megastructureTypeView("giga_battleship_ruined", { placement: inside, ...giga }),
    megastructureTypeView("giga_battleship_restored", {
      upgrade_from: ["giga_battleship_ruined"],
      placement: inside,
      offer: hidden("leaves_fleet"),
      ...giga,
    }),
    megastructureTypeView("mod_beacon", {
      placement: onStar,
      source: "Zeta Structures",
      base_game: false,
    }),
    megastructureTypeView("lgate_base", {
      placement: { place: "unsupported", why: { kind: "bypass", bypass: "lgate" } },
    }),
    megastructureTypeView("ring_world_1", {
      placement: { place: "unsupported", why: { kind: "ring_world" } },
    }),
  ].map((t) => [t.key, t]),
);

const NAMES = new Map([
  ["think_tank_0", "Science Nexus Site"],
  ["think_tank_1", "Science Nexus Hub"],
  ["think_tank_3", "Science Nexus"],
  ["think_tank_4", "The Groik Nexus"],
  ["think_tank_ruined", "Ruined Science Nexus"],
  ["think_tank_permanently_ruined", "Ruined Science Nexus"],
  ["think_tank_restored", "Science Nexus"],
  ["dyson_sphere_0", "​Dyson Sphere Site"],
  ["dyson_sphere_5", "Dyson Sphere"],
  ["dyson_sphere_ruined", "Ruined Dyson Sphere"],
  ["dyson_sphere_restored", "Dyson Sphere"],
  ["dyson_sphere_0_a_star", "​Dyson Sphere Site"],
  ["dyson_sphere_1_a_star", "Dyson Sphere Frame"],
  ["dyson_sphere_2_a_star", "Dyson Sphere: Initial"],
  ["dyson_sphere_5_a_star", "Dyson Sphere"],
  ["dyson_sphere_0_o_star", "O-Class Dyson Sphere Site"],
  ["dyson_sphere_5_o_star", "O-Class Dyson Sphere"],
  ["dyson_sphere_ruined_a_star", "Ruined Dyson Sphere"],
  ["dyson_sphere_restored_a_star", "Dyson Sphere"],
  ["dyson_swarm_1", "Dyson Swarm: Array"],
  ["dyson_swarm_3", "Dyson Swarm"],
  ["star_lifter_0", "Star Lifter Site"],
  ["star_lifter_5", "Star Lifter"],
  ["star_lifter_0_o_star", "O-Class Star Lifter Site"],
  ["star_lifter_5_o_star", "O-Class Star Lifter"],
  ["automated_stripmine_1", "Automated Strip Mine"],
  ["ring_world_1", "Ring World"],
  ["alderson_disk_1", "Alderson Disk Frame"],
  ["gateway_0", "Gateway Site"],
  ["gateway_final", "Gateway"],
  ["gateway_derelict", "Derelict Gateway"],
  ["hyper_relay", "Hyper Relay"],
  ["shroud_seal", "Shroud Seal"],
  ["mod_beacon", "Dyson Sphere"],
  ["mega_art_installation_0", "Mega Art Installation Site"],
  ["mega_art_installation_1", "Mega Art Installation: Nascency"],
  ["mega_art_installation_2", "Mega Art Installation: Maturity"],
  ["mega_art_installation_3", "Mega Art Installation"],
  ["colossus_dummy", "Colossus"],
  ["giga_battleship_ruined", "Wrecked Battleship"],
  ["giga_battleship_restored", "Battleship"],
]);

const entries = (spot: MegastructureSpot, refusalOf?: (t: MegastructureView) => string | null) =>
  megastructureEntries(TYPES, NAMES, spot, refusalOf);
const planet: MegastructureSpot = { kind: "body", body: 12, star: false };
const star: MegastructureSpot = { kind: "body", body: 1, star: true };
const space: MegastructureSpot = { kind: "space", x: 30, y: 40 };

const shape = (entry: MegastructureEntry | undefined) =>
  entry && {
    label: entry.label,
    section: entry.section,
    rows: entry.chains.map((chain) => [chain.kind, chain.label, chain.stages.map((s) => s.key)]),
  };

const titles = (entry: MegastructureEntry | undefined) =>
  entry?.chains.map((chain) => chain.stages.map((s) => `${s.label} | ${s.short}`));

const named = (list: readonly MegastructureEntry[], label: string, section: string | null = null) =>
  list.find((entry) => entry.label === label && entry.section === section);

describe("the megastructures the Add megastructure dialog lists", () => {
  it("lists every Dyson Sphere as one base game megastructure, star classes a mod builds over its site as labelled rows", () => {
    const sphere = named(entries(star), "Dyson Sphere");
    expect(shape(sphere)).toEqual({
      label: "Dyson Sphere",
      section: null,
      rows: [
        ["build", "Dyson Sphere", ["dyson_sphere_0", "dyson_sphere_5"]],
        [
          "variant",
          "A-class star",
          [
            "dyson_sphere_0_a_star",
            "dyson_sphere_1_a_star",
            "dyson_sphere_2_a_star",
            "dyson_sphere_5_a_star",
          ],
        ],
        ["variant", "O-class star", ["dyson_sphere_0_o_star", "dyson_sphere_5_o_star"]],
        ["ruins", "Ruined", ["dyson_sphere_ruined", "dyson_sphere_restored"]],
        [
          "ruins",
          "Ruined (A-class star)",
          ["dyson_sphere_ruined_a_star", "dyson_sphere_restored_a_star"],
        ],
      ],
    });
    expect(sphere?.summary).toBe("2 stages · by star class · ruins");
    expect(named(entries(star), "Dyson Sphere", "Zeta Structures")).toBeDefined();
  });

  it("tells stages of one name apart in brackets and shortens each to what the megastructure's name leaves", () => {
    const sphere = named(entries(star), "Dyson Sphere");
    expect(titles(sphere)).toEqual([
      ["Dyson Sphere Site | Site", "Dyson Sphere | Finished"],
      [
        "Dyson Sphere Site (A-class star) | Site",
        "Dyson Sphere Frame | Frame",
        "Dyson Sphere: Initial | Initial",
        "Dyson Sphere (A-class star) | Finished",
      ],
      ["O-Class Dyson Sphere Site | O-Class Site", "O-Class Dyson Sphere | O-Class"],
      ["Ruined Dyson Sphere | Ruined", "Dyson Sphere (Restored) | Restored"],
      [
        "Ruined Dyson Sphere (A-class star) | Ruined",
        "Dyson Sphere (A-class star, restored) | Restored",
      ],
    ]);
    const frame = sphere!.chains[1].stages[1];
    expect([frame.index, frame.count]).toEqual([2, 4]);
  });

  it("names a megastructure after its main chain's finished stage, with the ruins in rows of their own and no type the game data hides", () => {
    const nexus = named(entries(planet), "Science Nexus");
    expect(shape(nexus)?.rows).toEqual([
      ["build", "Science Nexus", ["think_tank_0", "think_tank_1", "think_tank_3"]],
      ["ruins", "Ruined", ["think_tank_ruined", "think_tank_restored"]],
      ["ruins", "Permanently ruined", ["think_tank_permanently_ruined"]],
    ]);
    expect(nexus?.summary).toBe("3 stages · ruins");
    expect(matchingEntries(entries(planet), "think_tank_4")).toEqual([]);
    expect(matchingEntries(entries(star), "colossus")).toEqual([]);
    expect(titles(nexus)?.slice(1)).toEqual([
      ["Ruined Science Nexus | Ruined", "Science Nexus (Restored) | Restored"],
      ["Ruined Science Nexus (Permanently ruined) | Ruined"],
    ]);
  });

  it("lists the stage a completion swaps by star class without the swapped chain, and not a chain a later upgrade_from names", () => {
    const listed = entries(star);
    const lifter = named(listed, "Star Lifter", GIGA);
    expect(shape(lifter)?.rows).toEqual([["build", null, ["star_lifter_0", "star_lifter_5"]]]);
    expect(lifter?.summary).toBe("2 stages · by star class");
    expect(matchingEntries(listed, "star_lifter_5_o")).toEqual([]);
    expect(shape(named(listed, "Dyson Swarm", GIGA))?.rows).toEqual([
      ["build", null, ["dyson_swarm_1", "dyson_swarm_3"]],
    ]);
  });

  it("greys out a type that changes its planet or builds a whole structure, with the reason", () => {
    const stage = (spot: MegastructureSpot, key: string) =>
      entries(spot)
        .flatMap(entryStages)
        .find((s) => s.key === key);
    expect(stage(planet, "automated_stripmine_1")?.refused).toBe(CHANGES_BODY);
    expect(stage(star, "alderson_disk_1")?.refused).toBe(WHOLE_STRUCTURE);
    expect(stage(planet, "alderson_disk_1")).toBeUndefined();
  });

  it("lists a ring world greyed out on a star, hides it on a planet and in space, and never opens on it", () => {
    const listed = entries(star);
    const ring = listed.find((entry) => entry.chains[0].first === "ring_world_1");
    expect(ring?.chains[0].stages[0].refused).toBe(RING_WORLD);
    expect(
      entries(planet)
        .flatMap(entryStages)
        .map((s) => s.key),
    ).not.toContain("ring_world_1");
    expect(
      entries(space)
        .flatMap(entryStages)
        .map((s) => s.key),
    ).not.toContain("ring_world_1");
    expect(defaultStage(listed, star, null)).toBe("dyson_sphere_5");
    expect(
      defaultStage(
        listed.filter((entry) => entry === ring),
        star,
        null,
      ),
    ).toBe("ring_world_1");
  });

  it("shows a type no localisation names only to a filter on its key, last, under Unnamed types", () => {
    const listed = entries(star);
    expect(listed.map(entryHeading).slice(-2)).toEqual(["Zeta Structures", UNNAMED_TYPES]);
    const giga = listed.filter((entry) => entry.section === GIGA);
    expect(giga.map((entry) => [entry.label, entry.unnamed])).toEqual([
      ["Alderson Disk Frame", false],
      ["Automated Strip Mine", false],
      ["Dyson Swarm", false],
      ["Star Lifter", false],
      ["Uf Hyperlane A", true],
    ]);
    expect(matchingEntries(listed, "").some((entry) => entry.unnamed)).toBe(false);
    expect(matchingEntries(listed, "Hyperlane A")).toEqual([]);
    expect(matchingEntries(listed, "hyperlane").map((entry) => entry.unnamed)).toEqual([true]);
    expect(defaultStage(giga, star, null)).toBe("dyson_swarm_3");
  });

  it("offers star-only types on a star alone, any body's on a planet or star, free types in space alone, and never one that stands for a bypass", () => {
    expect(entries(planet).map((e) => e.label)).toEqual([
      "Mega Art Installation",
      "Science Nexus",
      "Automated Strip Mine",
    ]);
    const offered = [planet, star, space].flatMap((spot) =>
      entries(spot).flatMap((e) => entryStages(e).map((s) => s.key)),
    );
    expect(offered).not.toContain("lgate_base");
  });

  it("keeps a base game gateway in the base game's section though a mod's file won, offers a wreck without its repair, and leaves out what the game data hides", () => {
    expect(entries(space).map(shape)).toEqual([
      { label: "Gateway", section: null, rows: [["build", null, ["gateway_0", "gateway_final"]]] },
      { label: "Hyper Relay", section: null, rows: [["build", null, ["hyper_relay"]]] },
      {
        label: "Wrecked Battleship",
        section: GIGA,
        rows: [["ruins", null, ["giga_battleship_ruined"]]],
      },
    ]);
  });

  it("leaves out a row of script-only types no localisation names", () => {
    expect(matchingEntries(entries(space), "blokkat_dummy").flatMap(entryStages)).toEqual([]);
  });

  it("lists a megastructure whatever global flags the save has", () => {
    const lifter = (globalFlags: ReadonlySet<string>) =>
      named(
        megastructureEntries(TYPES, NAMES, star, undefined, { globalFlags }),
        "Star Lifter",
        GIGA,
      );
    expect(lifter(new Set(["lifters_disabled"]))).toBeDefined();
    expect(lifter(new Set(["giga_dyson_scaling"]))).toBeDefined();
    expect(lifter(new Set())).toBeDefined();
  });

  it("states a stage's place in its build chain and names it on the Add button", () => {
    const listed = entries(planet);
    const at = (key: string) => {
      const found = findStage(listed, key)!;
      return [stageLine(found.stage, found.chain), addLabel(found.stage, found.chain)];
    };
    expect(named(listed, "Mega Art Installation")?.summary).toBe("4 stages");
    expect(at("mega_art_installation_2")).toEqual([
      "Stage 3 of 4: Maturity",
      "Add Maturity, stage 3 of 4",
    ]);
    expect(at("mega_art_installation_3")).toEqual([
      "Stage 4 of 4: Finished",
      "Add Mega Art Installation, stage 4 of 4",
    ]);
    expect(at("think_tank_ruined")).toEqual([null, "Add Ruined Science Nexus"]);
    const relay = findStage(entries(space), "hyper_relay")!;
    expect(stageLine(relay.stage, relay.chain)).toBeNull();
    expect(addLabel(relay.stage, relay.chain)).toBe("Add Hyper Relay");
  });

  it("filters the megastructures by their own and their stages' names and keys, ignoring case", () => {
    const listed = entries(star);
    expect(matchingEntries(listed, " RUINED ").map((e) => e.label)).toEqual([
      "Dyson Sphere",
      "Science Nexus",
    ]);
    expect(matchingEntries(listed, "o_star").map((e) => e.label)).toEqual(["Dyson Sphere"]);
    expect(matchingEntries(listed, "gateway")).toEqual([]);
  });

  it("opens on the type added last where it goes, else the usual one for the spot", () => {
    expect(defaultStage(entries(star), star, "dyson_sphere_5_a_star")).toBe(
      "dyson_sphere_5_a_star",
    );
    expect(defaultStage(entries(star), star, "hyper_relay")).toBe("dyson_sphere_5");
    expect(defaultStage(entries(planet), planet, null)).toBe("think_tank_3");
    expect(defaultStage(entries(space), space, null)).toBe("hyper_relay");
    const noRelay = new Map([...TYPES].filter(([key]) => key !== "hyper_relay"));
    const list = megastructureEntries(noRelay, NAMES, space);
    expect(defaultStage(list, space, null)).toBe("gateway_final");
    expect(defaultStage([], space, null)).toBeNull();
  });
});

describe("the stage the dialog has selected", () => {
  const relayed = (type: MegastructureView) =>
    type.bypass_type === "relay_bypass" ? "The system already has a hyper relay." : null;

  it("opens past a stage the save would refuse here, to the first one it takes", () => {
    const list = entries(space, relayed);
    expect(defaultStage(list, space, null)).toBe("gateway_final");
    expect(defaultStage(list, space, "hyper_relay")).toBe("gateway_final");
    const refusedAll = entries(space, () => "No.");
    expect(defaultStage(refusedAll, space, null)).toBe("gateway_final");
  });

  it("selects only a stage the filter shows", () => {
    const list = entries(star);
    const visible = matchingEntries(list, "nexus");
    const found = selectedStage(list, visible, "dyson_sphere_5", star, null);
    expect(found?.stage.key).toBe("think_tank_3");
    expect(selectedStage(list, visible, null, star, null)?.stage.key).toBe("think_tank_3");
    expect(
      selectedStage(list, matchingEntries(list, "gateway"), "dyson_sphere_5", star, null),
    ).toBeNull();
    expect(selectedStage(list, list, "dyson_sphere_0", star, null)?.stage.key).toBe(
      "dyson_sphere_0",
    );
  });
});

describe("why the save would refuse a megastructure that fits the spot", () => {
  it("greys out a second relay or gateway in a system and a body that has one already", () => {
    const relay = megastructureSummary({ kind: "hyper_relay", planet: null });
    const refusal = (spot: MegastructureSpot, kind: string, rows = [relay]) =>
      megastructureRefusal(TYPES.get(kind)!, spot, rows, TYPES);
    expect(refusal(space, "hyper_relay")).toBe("The system already has a hyper relay.");
    expect(refusal(space, "gateway_final")).toBeNull();
    expect(refusal(space, "shroud_seal")).toBeNull();
    const nexus = megastructureSummary({ kind: "think_tank_3", planet: 12 });
    expect(refusal(planet, "think_tank_0", [nexus])).toBe(BODY_HAS_MEGASTRUCTURE);
    const listed = entries(space, (type) => refusal(space, type.key));
    expect(entryStages(listed[1])).toEqual([
      {
        key: "hyper_relay",
        label: "Hyper Relay",
        short: "Finished",
        index: 1,
        count: 1,
        refused: "The system already has a hyper relay.",
        variant: "hyper_relay",
      },
    ]);
  });
});

describe("where a new megastructure stands", () => {
  it("ties a body's row to the body, stands a relay just outside the inner radius in the direction pressed, and a shroud seal where pressed", () => {
    expect(megastructurePlace(planet, TYPES.get("think_tank_0"), 150)).toEqual({
      place: "body",
      body: 12,
    });
    const relay = megastructurePlace(space, TYPES.get("hyper_relay"), 150);
    expect(relay.place).toBe("free");
    if (relay.place !== "free") return;
    expect(Math.hypot(relay.x, relay.y)).toBeCloseTo(RELAY_RADIUS_FACTOR * 150);
    expect(Math.atan2(relay.y, relay.x)).toBeCloseTo(Math.atan2(40, 30));
    expect(megastructurePlace(space, TYPES.get("shroud_seal"), 150)).toEqual({
      place: "free",
      x: 30,
      y: 40,
    });
  });
});
