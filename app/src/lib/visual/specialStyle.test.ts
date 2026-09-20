import { describe, expect, it } from "vitest";
import type { CountryRef } from "../../generated/CountryRef";
import type { SpecialSystem } from "../../generated/SpecialSystem";
import {
  badgeIconKey,
  badgeLabel,
  badgeSide,
  badgeVisible,
  humaniseInitializer,
  LEVIATHAN_NAMES,
} from "./specialStyle";

function special(overrides: Partial<SpecialSystem>): SpecialSystem {
  return {
    id: 1,
    primary: "leviathan",
    kinds: ["leviathan"],
    initializer: "",
    initializer_known: true,
    source_file: null,
    flags: [],
    countries: [],
    label: "",
    ...overrides,
  };
}

function countryRef(icon: CountryRef["icon"]): CountryRef {
  return { id: null, name_key: "", name: null, country_type: "guardian", icon };
}

const NAMES = new Map([
  ["NAME_Ether_Drake", "Ether Drake"],
  ["NAME_Elderly_Tiyanki", "Tiyanki Matriarch"],
]);

describe("badgeLabel", () => {
  it("names a leviathan after the country the classifier found, over the vanilla table", () => {
    const dragon = special({ initializer: "guardians_init_dragon", label: "Voidwyrm" });
    expect(badgeLabel("leviathan", dragon, "Delcor", NAMES)).toBe("Voidwyrm");
  });

  it("names a leviathan from the vanilla table only where game data defines no initializer", () => {
    const dragon = special({
      initializer: "guardians_init_dragon",
      initializer_known: false,
      label: "Delcor",
    });
    expect(badgeLabel("leviathan", dragon, "Delcor", NAMES)).toBe("Ether Drake");
    const tiyanki = special({
      initializer: "elderly_tiyanki_system",
      initializer_known: false,
      label: "Qorrolla",
    });
    expect(badgeLabel("leviathan", tiyanki, "Qorrolla", NAMES)).toBe("Tiyanki Matriarch");
  });

  it("strips the vanilla table's key when nothing has localised it", () => {
    const dragon = special({ initializer: "guardians_init_dragon", initializer_known: false });
    expect(badgeLabel("leviathan", dragon, "Delcor", new Map())).toBe("Ether Drake");
  });

  it("falls back to the classifier's name, then the humanised initializer, never the bare kind", () => {
    const unresolved = special({ initializer: "guardians_init_dragon", label: "Voidwyrm" });
    expect(badgeLabel("leviathan", unresolved, "Delcor", new Map())).toBe("Voidwyrm");
    const modded = special({ initializer: "mem_mortis_system_initializer", label: "Myco" });
    expect(badgeLabel("leviathan", modded, "Myco", NAMES)).toBe("Mortis");
    expect(badgeLabel("leviathan", special({ label: "Kaleido" }), "Kaleido", NAMES)).toBe(
      "Leviathan",
    );
  });

  it("names a landmark after its megastructure, else its initializer", () => {
    const ruin = special({
      primary: "landmark",
      initializer: "ring_world_init_01",
      label: "Aldan",
    });
    const megastructures = [{ id: 7, kind: "ring_world_ruined", owner: null, planet: null }];
    expect(badgeLabel("landmark", ruin, "Aldan", NAMES, megastructures)).toBe(
      "Ring World (ruined)",
    );
    expect(badgeLabel("landmark", ruin, "Aldan", NAMES)).toBe("Ring World");
    const gateways = special({ primary: "landmark", initializer: "abandoned_gateways_01" });
    expect(badgeLabel("landmark", gateways, "Xirak", NAMES)).toBe("Abandoned Gateways");
  });

  it("keeps the classifier's name for other kinds when it says more than the system name", () => {
    const enclave = special({ primary: "enclave", label: "Curator Enclave" });
    expect(badgeLabel("enclave", enclave, "Vilnius", NAMES)).toBe("Curator Enclave");
    expect(badgeLabel("marauder", special({ primary: "marauder" }), "Ruprecht", NAMES)).toBe(
      "Marauder",
    );
  });
});

describe("humaniseInitializer", () => {
  it("strips the initializer boilerplate and title-cases what is left", () => {
    expect(humaniseInitializer("mem_mortis_system_initializer")).toBe("Mortis");
    expect(humaniseInitializer("guardians_init_technosphere")).toBe("Technosphere");
    expect(humaniseInitializer("abandoned_gateways_01")).toBe("Abandoned Gateways");
    expect(humaniseInitializer("the_star_mall_initializer")).toBe("Star Mall");
    expect(humaniseInitializer("old_foes_system")).toBe("Old Foes");
    expect(humaniseInitializer("parvus_system")).toBe("Parvus");
    expect(humaniseInitializer("mem_sadrell_0_0")).toBe("Sadrell");
    expect(humaniseInitializer("science_nexus_init_01")).toBe("Science Nexus");
  });
});

describe("LEVIATHAN_NAMES", () => {
  it("covers every vanilla guardian initializer", () => {
    for (const creature of [
      "dragon",
      "horror",
      "fortress",
      "dreadnought",
      "stellarites",
      "technosphere",
      "hive",
      "hatchling",
      "wraith",
    ]) {
      expect(LEVIATHAN_NAMES[`guardians_init_${creature}`]).toMatch(/^NAME_/);
    }
    expect(LEVIATHAN_NAMES.elderly_tiyanki_system).toBe("NAME_Elderly_Tiyanki");
    expect(LEVIATHAN_NAMES.scavenger_system).toBe("NAME_Scavenger_Bot");
  });
});

describe("badgeIconKey", () => {
  it("uses the spawned country's flag over the vanilla art for a known leviathan initializer", () => {
    const s = special({
      initializer: "guardians_init_dragon",
      countries: [countryRef({ category: "zoological", file: "flag_zoological_5.dds" })],
    });
    expect(badgeIconKey("leviathan", s)).toBe("symbol:zoological/flag_zoological_5.dds");
  });

  it("wears the vanilla art only where game data defines no initializer", () => {
    const s = special({ initializer: "guardians_init_dragon", initializer_known: false });
    expect(badgeIconKey("leviathan", s)).toBe("symbol:zoological/flag_zoological_9.dds");
  });

  it("falls back to the spawned country's flag symbol, then the kind icon", () => {
    const withCountry = special({
      initializer: "modded_guardian",
      countries: [countryRef({ category: "zoological", file: "flag_zoological_5.dds" })],
    });
    expect(badgeIconKey("leviathan", withCountry)).toBe("symbol:zoological/flag_zoological_5.dds");
    expect(badgeIconKey("leviathan", special({}))).toBe("symbol:pirate/flag_pirate_3.dds");
    expect(badgeIconKey("leviathan", undefined)).toBe("symbol:pirate/flag_pirate_3.dds");
  });

  it("shows an enclave by its flag and a marauder by the skull regardless of flag", () => {
    const enclave = special({
      primary: "enclave",
      countries: [countryRef({ category: "enclaves", file: "enclaves_flag_trader.dds" })],
    });
    expect(badgeIconKey("enclave", enclave)).toBe("symbol:enclaves/enclaves_flag_trader.dds");
    const marauder = special({
      primary: "marauder",
      countries: [countryRef({ category: "pirate", file: "flag_pirate_1.dds" })],
    });
    expect(badgeIconKey("marauder", marauder)).toBe("symbol:pirate/flag_pirate_5.dds");
  });

  it("gives every other kind a fixed icon", () => {
    expect(badgeIconKey("landmark", undefined)).toBe("sprite:GFX_point_of_interest_levels#1");
    expect(badgeIconKey("unique", undefined)).toBe("symbol:pointy/flag_pointy_16.dds");
  });
});

describe("badgeSide", () => {
  it("staggers odd ids below only on the whole-galaxy view", () => {
    expect(badgeSide(2, "none")).toBe("above");
    expect(badgeSide(3, "none")).toBe("below");
    expect(badgeSide(3, "some")).toBe("above");
  });
});

describe("badgeVisible", () => {
  it("shows a notable kind at every tier and a common kind only zoomed in", () => {
    expect(badgeVisible("leviathan", "none")).toBe(true);
    expect(badgeVisible("unique", "none")).toBe(false);
    expect(badgeVisible("unique", "some")).toBe(true);
  });

  it("never badges a kind whose territory the owners layer emphasises instead", () => {
    expect(badgeVisible("marauder", "none")).toBe(false);
    expect(badgeVisible("fallen_empire", "some")).toBe(false);
  });
});
