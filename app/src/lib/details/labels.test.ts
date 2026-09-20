import { describe, expect, it } from "vitest";
import type { BypassLink } from "../../generated/BypassLink";
import type { StarbaseLevelView } from "../../generated/StarbaseLevelView";
import { COUNTRY, details, planet } from "./fixture";
import { type BypassKinds, bypassIconKey } from "./icons";
import {
  bypassIcons,
  detailNameKeys,
  isBypassMegastructure,
  isGatewayMegastructure,
  isWaystationLevel,
  megastructureIcon,
  megastructureLabel,
  megastructureParts,
  planetClassLabel,
  planetLine,
  shownMegastructures,
  siteIcon,
  starbaseFrame,
  starbaseKeys,
  starbaseLabel,
  starbaseShown,
  waystationType,
} from "./labels";

describe("starbaseKeys / starbaseLabel", () => {
  const levels = new Map<string, StarbaseLevelView>([
    [
      "starbase_level_citadel",
      { key: "starbase_level_citadel", icon_frame: 5, empire_shield: false },
    ],
    [
      "starbase_level_outpost",
      { key: "starbase_level_outpost", icon_frame: null, empire_shield: false },
    ],
    ["starbase_level_hut", { key: "starbase_level_hut", icon_frame: null, empire_shield: true }],
  ]);

  it("names the level glyph", () => {
    expect(starbaseKeys("starbase_level_citadel", levels)).toEqual([
      "sprite:GFX_starbase_ship_size_small#5",
    ]);
  });

  it("shows the owner's flag symbol for a level that displays the empire shield", () => {
    const clan = { ...COUNTRY, flag_icon: { category: "pirate", file: "flag_pirate_5.dds" } };
    expect(starbaseKeys("starbase_level_hut", levels, clan)).toEqual([
      "symbol:pirate/flag_pirate_5.dds",
    ]);
    expect(starbaseKeys("starbase_level_marauder", levels, clan)).toEqual([
      "symbol:pirate/flag_pirate_5.dds",
    ]);
    expect(starbaseKeys("starbase_level_hut", levels)).toEqual([
      "sprite:GFX_starbase_ship_size_small#1",
    ]);
  });

  it("falls back to the outpost glyph for an unknown level or one without a frame", () => {
    expect(starbaseKeys("starbase_level_marauder", levels)).toEqual([
      "sprite:GFX_starbase_ship_size_small#1",
    ]);
    expect(starbaseKeys("starbase_level_outpost", levels)).toEqual([
      "sprite:GFX_starbase_ship_size_small#1",
    ]);
  });

  it("hides a plain outpost and shows every other level", () => {
    expect(starbaseShown("starbase_level_outpost")).toBe(false);
    expect(starbaseShown("starbase_level_starport")).toBe(true);
    expect(starbaseShown("starbase_level_marauder")).toBe(true);
  });

  it("frames owner-built levels as stations and everything else as a point of interest", () => {
    expect(starbaseFrame("starbase_level_citadel")).toBe("station");
    expect(starbaseFrame("starbase_level_outpost")).toBe("station");
    expect(starbaseFrame("starbase_level_marauder")).toBe("poi");
    expect(starbaseFrame("starbase_level_caravaneer")).toBe("poi");
  });

  it.each([
    ["starbase_level_starport", "Starport"],
    ["starbase_level_marauder", "Marauder"],
  ])("labels a level from its key: %s", (level, label) => {
    expect(starbaseLabel(level)).toBe(label);
  });
});

describe("waystations", () => {
  it.each([
    ["starbase_level_waystation_1", "Waystation"],
    ["starbase_level_waystation_2", "Wayport"],
    ["starbase_level_waystation_3", "Wayhold"],
    ["starbase_level_waystation", "Waystation"],
    ["starbase_level_waystation_9", "Waystation"],
  ])("names the three levels the game gives a network's stations: %s", (level, label) => {
    expect(isWaystationLevel(level)).toBe(true);
    expect(starbaseLabel(level)).toBe(label);
  });

  it("keeps a waystation shown, framed as a point of interest", () => {
    expect(starbaseShown("starbase_level_waystation_1")).toBe(true);
    expect(starbaseFrame("starbase_level_waystation_1")).toBe("poi");
    expect(isWaystationLevel("starbase_level_starport")).toBe(false);
  });

  it.each([
    ["swaystation_research", "research"],
    ["swaystation_energy", "energy"],
    ["swaystation_mining", "mining"],
    ["swaystation_trade", "trade"],
    ["swaystation_piracy", "piracy"],
    ["swaystation", null],
    ["swaystation_wizardry", null],
    ["starbase_starport", null],
  ])("reads the type the entry's kind names: %s", (kind, type) => {
    expect(waystationType(kind)).toBe(type);
  });
});

describe("planetClassLabel", () => {
  it.each([
    ["pc_tropical", "Tropical World"],
    ["pc_gas_giant", "Gas Giant"],
    ["pc_habitat", "Habitat"],
    ["pc_ringworld_habitable", "Ringworld"],
  ])("humanises a class key, naming habitable ones as worlds: %s", (planetClass, label) => {
    expect(planetClassLabel(planetClass)).toBe(label);
  });
});

describe("megastructureParts / megastructureLabel / megastructureIcon", () => {
  it.each([
    ["ring_world_ruined", { name: "Ring World", state: "ruined", warn: true }],
    ["dyson_sphere_2", { name: "Dyson Sphere", state: "stage 2", warn: false }],
    ["dyson_gun_0_restored", { name: "Dyson Gun", state: "restored", warn: false }],
    ["think_tank_0", { name: "Think Tank", state: "under construction", warn: false }],
    ["gateway_final", { name: "Gateway", state: "complete", warn: false }],
    ["lgate_base", { name: "L-Gate", state: "complete", warn: false }],
  ])("reads the name and the state the type name encodes: %s", (kind, parts) => {
    expect(megastructureParts(kind)).toEqual(parts);
  });

  it.each([
    ["ring_world_ruined", "Ring World (ruined)"],
    ["dyson_sphere_3", "Dyson Sphere (stage 3)"],
    ["dyson_gun_0_restored", "Dyson Gun (restored)"],
    ["gateway_0", "Gateway"],
    ["gateway_final", "Gateway"],
    ["lgate_base", "L-Gate"],
    ["hyper_relay", "Hyper Relay"],
  ])("humanises the kind with its state or stage in brackets: %s", (kind, label) => {
    expect(megastructureLabel(kind)).toBe(label);
  });

  it("collapses every megastructure into one generic icon, titled by the one or the count", () => {
    const one = megastructureIcon([
      { id: 1, kind: "ring_world_ruined", owner: null, planet: null },
    ]);
    expect(one).toEqual({
      keys: ["sprite:GFX_ship_class_small#22"],
      glyph: "◈",
      label: "Ring World (ruined)",
      frame: "poi",
    });
    const two = megastructureIcon([
      { id: 1, kind: "ring_world_ruined", owner: null, planet: null },
      { id: 2, kind: "dyson_sphere_3", owner: 4, planet: null },
    ]);
    expect(two?.label).toBe("2 megastructures");
    expect(megastructureIcon([])).toBeNull();
  });

  it("leaves gateways and L-Gates to the bypass icon", () => {
    const lgate = { id: 1, kind: "lgate_base", owner: null, planet: null };
    const gateway = { id: 2, kind: "gateway_final", owner: 3, planet: null };
    const relay = { id: 3, kind: "hyper_relay", owner: 3, planet: null };
    expect(shownMegastructures([lgate, gateway, relay])).toEqual([relay]);
    expect(megastructureIcon([lgate])).toBeNull();
    expect(megastructureIcon([lgate, relay])?.label).toBe("Hyper Relay");
    expect(["lgate_base", "gateway_final", "hyper_relay"].map(isBypassMegastructure)).toEqual([
      true,
      true,
      false,
    ]);
    expect(["gateway_final", "lgate_base"].map(isGatewayMegastructure)).toEqual([true, false]);
  });
});

describe("siteIcon", () => {
  it("collapses the sites the same way", () => {
    expect(siteIcon(["site_tiyanki_graveyard"])?.label).toBe("Tiyanki Graveyard");
    expect(siteIcon(["site_a", "site_b"])?.label).toBe("2 archaeology sites");
    expect(siteIcon([])).toBeNull();
  });
});

describe("planetLine", () => {
  const owner = (id: number) => `Country ${id}`;

  it("lists class, size and the colony tags", () => {
    const p = planet({ size: 16, colonised: true, capital: true, owner: 3 });
    expect(planetLine(p, "Earth", "Continental World", owner)).toEqual({
      label: "Earth",
      value: "Continental World · size 16 · capital · colonised by Country 3",
      stacked: true,
    });
  });

  it("shows the game's size glyph inline when its texture is available", () => {
    const p = planet({ size: 25 });
    expect(planetLine(p, "Cytonox", "Tropical World", owner, true).value).toEqual([
      "Tropical World",
      " ",
      { icon: "sprite:GFX_text_planetsize" },
      " 25",
    ]);
    expect(
      planetLine(p, "Cytonox", "Tropical World", owner, true, "sprite:GFX_planet_type_tropical")
        .label,
    ).toEqual([{ icon: "sprite:GFX_planet_type_tropical" }, " Cytonox"]);
  });

  it("omits an unknown size and tags pre-FTL worlds without an owner", () => {
    const p = planet({ pre_ftl: true, colonised: true, owner: 9 });
    expect(planetLine(p, "Vega II", "Arid World", owner).value).toBe("Arid World · pre-FTL");
  });
});

describe("detailNameKeys", () => {
  const nested = (key: string, variable: string, value: string) => ({
    key,
    literal: false,
    variables: [{ name: variable, value: { key: value, literal: false, variables: [] } }],
  });

  it("collects planet, fleet and station template keys and canonical resource ids", () => {
    const d = details({
      planets: [planet({ name: nested("PLANET_NAME_FORMAT", "NAME", "NAME_Alpha") })],
      fleets_present: [
        {
          id: 1,
          name: { key: "NAME_Fleet", literal: false, variables: [] },
          name_key: "NAME_Fleet",
          owner: null,
          military: true,
          military_power: 1,
          ships: 1,
          order: null,
          planet_killer: false,
          disabled_ships: 0,
          ship_sizes: [],
        },
      ],
      starbase: {
        level: "starbase_level_outpost",
        kind: "starbase_outpost",
        name: nested("STARBASE_NAME_FORMAT", "PLANET", "NAME_Rijjin"),
        name_key: "STARBASE_NAME_FORMAT",
        owner: null,
        modules: [],
        buildings: [],
        id: 0,
        hull: 0,
        max_hull: 0,
        shipyard: false,
      },
      resources: [
        { resource: "engineering", amount: 5 },
        { resource: "energy", amount: 1 },
      ],
    });
    expect(detailNameKeys(d)).toEqual([
      "PLANET_NAME_FORMAT",
      "NAME",
      "NAME_Alpha",
      "NAME_Fleet",
      "STARBASE_NAME_FORMAT",
      "PLANET",
      "NAME_Rijjin",
      "engineering_research",
      "energy",
    ]);
  });
});

describe("bypassIcons", () => {
  const bypasses: BypassLink[] = [
    { type: "wormhole", a: 1, b: 2 },
    { type: "gateway", system: 2, active: false },
    { type: "gateway", system: 3, active: true },
    { type: "l_gate", system: 2 },
    { type: "other", system: 2, kind: "relay_bypass" },
  ];

  it("lists the bypasses touching a system with the game's ship-class frames", () => {
    const icons = bypassIcons(bypasses, 2);
    expect(icons.map((i) => i.label)).toEqual([
      "Natural wormhole",
      "Gateway (inactive)",
      "L-Gate",
      "Relay Bypass",
    ]);
    expect(icons.map((i) => i.keys[0])).toEqual([
      "sprite:GFX_ship_class_small#12",
      "sprite:GFX_ship_class_small#25",
      "sprite:GFX_ship_class_small#30",
      "sprite:GFX_ship_class_small#30",
    ]);
    expect(bypassIcons(bypasses, 3).map((i) => i.label)).toEqual(["Gateway"]);
    expect(bypassIcons(bypasses, 4)).toEqual([]);
  });

  it("takes the frame from the game's own bypass definitions when they are loaded", () => {
    const kinds: BypassKinds = new Map([
      ["gateway", { key: "gateway", icon_frame: 7 }],
      ["relay_bypass", { key: "relay_bypass", icon_frame: null }],
    ]);
    expect(bypassIconKey("gateway", kinds)).toBe("sprite:GFX_ship_class_small#7");
    expect(bypassIconKey("modded_rift", kinds)).toBe("sprite:GFX_ship_class_small#25");
    expect(bypassIcons(bypasses, 2, kinds).map((i) => i.keys[0])).toEqual([
      "sprite:GFX_ship_class_small#12",
      "sprite:GFX_ship_class_small#7",
      "sprite:GFX_ship_class_small#30",
      undefined,
    ]);
  });

  it("gives a kind the game defines with no icon none, rather than the vanilla frame", () => {
    const kinds: BypassKinds = new Map([
      ["relay_bypass", { key: "relay_bypass", icon_frame: null }],
    ]);
    expect(bypassIconKey("relay_bypass", kinds)).toBeNull();
    const icons = bypassIcons(bypasses, 2, kinds);
    expect(icons[icons.length - 1].keys).toEqual([]);
  });
});
