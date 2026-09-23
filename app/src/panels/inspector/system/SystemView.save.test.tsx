import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detailOf, name } from "../../../store/fixture";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import type { StarbaseSummary } from "../../../generated/StarbaseSummary";
import { kindTitle } from "../../../lib/special";
import { bindStores } from "../../../store/bindStores";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import {
  details,
  fleet,
  land,
  mocked,
  open,
  overview,
  planet,
  resetStores,
  sections,
  SYSTEM,
} from "../inspectorFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a save system's overview", () => {
  it("keeps every section it has always shown, each drilling into its entity", async () => {
    await open("save");
    await land(details({ planets: [planet(100, "Tarkin")] }));

    const html = overview();
    expect(sections(html)).toEqual([
      "Position",
      "Hyperlanes · 4",
      "Bypasses · 0",
      "Planets · 1 · 0 colonies",
      "Flags · 0",
      "Initializer",
    ]);
    expect(html).toContain("System total");
    expect(html).toContain('class="ins-prow" role="button"');
    expect(html).not.toContain("static");
  });

  it("gives the station, megastructure and fleet rows a focus button, and the fleet its state", async () => {
    await open("save");
    await land(
      details({
        starbase: {
          level: "starbase_level_starport",
          kind: "starbase_starport",
          name: name("Bastion"),
          name_key: "Bastion",
          owner: null,
          modules: [],
          buildings: [],
          id: 0,
          hull: 0,
          max_hull: 0,
          shipyard: false,
        },
        megastructures: [{ id: 5, kind: "ring_world_ruined", owner: null, planet: null }],
        fleets_present: [
          fleet(1, "Home Fleet"),
          fleet(2, "Colossus", { military_power: 0, planet_killer: true }),
          fleet(3, "Wreck", { military_power: 0, disabled_ships: 15 }),
        ],
      }),
    );

    const html = overview();
    expect(html).toContain('aria-label="Focus Bastion on the map"');
    expect(html).toContain('aria-label="Focus Ring World on the map"');
    expect(html).toContain('aria-label="Focus Home Fleet on the map"');
    expect(html).toContain("15 ships · power 8,019");
    expect(html).toContain("15 ships · ☠");
    expect(html).toContain("15 ships · disabled");
  });

  it("names what each kind means on its chip and filters the flags once there are over twenty", async () => {
    const flags = Array.from({ length: 21 }, (_, i) => `story_flag_${i}`);
    mocked.getSystem.mockImplementation(async (id) => {
      const detail = detailOf(id);
      return { ...detail, system: { ...detail.system, flags } };
    });
    useGameDataStore.setState({
      special: new Map([
        [
          SYSTEM,
          {
            id: SYSTEM,
            primary: "leviathan",
            kinds: ["leviathan"],
            initializer: "guardian_dragon",
            initializer_known: true,
            source_file: null,
            flags,
            countries: [],
            label: "Dragon",
            label_is_generated_name: false,
          },
        ],
      ]),
    });
    await open("save");
    await land(details());
    useInspectorStore.setState({ sections: { "system.flags": false } });

    const html = overview();
    expect(html).toContain(kindTitle("leviathan"));
    expect(html).toContain("flags: story_flag_0");
    expect(html).toContain('aria-label="Filter 21 flags"');
  });

  it("says it is still reading until the record arrives", async () => {
    await open("save");
    expect(overview()).toContain("Reading the system");
  });
});

/** The install's classes for the binary under test, its bodies and a class to change it to. */
function armStarClasses(): void {
  const star = (key: string, ...planet_keys: string[]) => ({
    key,
    texture_key: `star_class:${key}`,
    icon_scale: 1,
    planet_keys,
    crisis_star_class: null,
    spawn_odds: 1,
    localised: true,
  });
  const body = (key: string) => ({ key, icon_sprite: null, habitable: false, star: true });
  useGameDataStore.setState({
    names: new Map([
      ["sc_binary_1", "X-ray Binary"],
      ["sc_binary_2", "Neutron Binary"],
    ]),
    starClasses: new Map(
      [
        star("sc_g", "pc_g_star"),
        star("sc_binary_1", "pc_a_star", "pc_pulsar"),
        star("sc_binary_2", "pc_b_star", "pc_neutron_star"),
      ].map((c) => [c.key, c]),
    ),
    planetClasses: new Map(
      ["pc_a_star", "pc_pulsar", "pc_b_star", "pc_neutron_star", "pc_g_star"].map((k) => [
        k,
        body(k),
      ]),
    ),
  });
}

describe("the star class at the head", () => {
  const stars = () =>
    details({
      planets: [
        planet(100, "Tarkin"),
        planet(101, "Alpha", { class: "pc_a_star" }),
        planet(102, "Beta", { class: "pc_pulsar" }),
      ],
    });

  it("names a multiple star by its class's bodies, as plain text on a save", async () => {
    armStarClasses();
    await open("save");
    await land(stars());

    const html = overview();
    // The fixture has no names for the bodies.
    expect(html).toMatch(
      /<div class="ins-sub muted">pc_a_star \+ pc_pulsar · \d+ planets · nebula/,
    );
    expect(html).not.toContain("Star class");
    expect(html).not.toContain('aria-haspopup="listbox"');
  });

  it("notes stars no class has, by their names, and what the game treats the system as", async () => {
    armStarClasses();
    useGameDataStore.setState({
      names: new Map([
        ["pc_a_star", "Class A Star"],
        ["pc_g_star", "Class G Star"],
        ["pc_pulsar", "Pulsar"],
      ]),
    });
    await open("save");
    await land(
      details({
        planets: [
          planet(101, "Alpha", { class: "pc_a_star" }),
          planet(102, "Beta", { class: "pc_g_star" }),
        ],
      }),
    );

    expect(overview()).toContain(
      "No star class has these stars (Class A Star + Class G Star). The map and the game treat the system as Class A Star + Pulsar.",
    );
  });

  it("leaves the note out when the stars match the class, in any order", async () => {
    armStarClasses();
    await open("save");
    await land(
      details({
        planets: [
          planet(102, "Beta", { class: "pc_pulsar" }),
          planet(101, "Alpha", { class: "pc_a_star" }),
        ],
      }),
    );

    expect(overview()).not.toContain("No star class has these stars");
  });

  it("marks each star in the planet list as a page with fields to edit", async () => {
    armStarClasses();
    await open("save");
    await land(stars());

    expect(overview().match(/class="ins-edit-chip"/g)).toHaveLength(2);
  });

  it("stays plain text on a scenario", async () => {
    armStarClasses();
    await open("scenario");
    await land(stars());

    const html = overview();
    expect(html).toContain("X-ray Binary · ");
    expect(html).not.toContain("Star class");
    expect(html).not.toContain('aria-haspopup="listbox"');
    expect(html).not.toContain("ins-edit-chip");
  });
});

/** A station of the system under test, named `Bastion`, at the level and kind given. */
function starbase(level: string, kind: string): StarbaseSummary {
  return {
    level,
    kind,
    name: name("Bastion"),
    name_key: "Bastion",
    owner: null,
    modules: [],
    buildings: [],
    id: 0,
    hull: 0,
    max_hull: 0,
    shipyard: false,
  };
}

describe("a wayline network", () => {
  it("names a waystation by its level, with its type and its network", async () => {
    await open("save");
    useGalaxyStore.setState({
      waystations: [
        { system: SYSTEM, starbase: 0, network: 2 },
        { system: 2, starbase: 1, network: 2 },
        { system: 3, starbase: 2, network: 2 },
        { system: 4, starbase: 3, network: 5 },
      ],
    });
    await land(
      details({ starbase: starbase("starbase_level_waystation_2", "swaystation_research") }),
    );

    const html = overview();
    expect(html).toContain("Wayport");
    expect(html).toContain("research · Wayline network 2 · 3 stations");
    expect(html).not.toContain("0 modules · 0 buildings");
  });

  it("leaves a regular starbase's name, level and counts alone", async () => {
    await open("save");
    await land(details({ starbase: starbase("starbase_level_starport", "starbase_starport") }));

    const html = overview();
    expect(html).toContain("Bastion");
    expect(html).toContain(">Starport<");
    expect(html).toContain("0 modules · 0 buildings");
    expect(html).not.toContain("Wayline network");
  });

  it("chips the lanes a wayline runs along and no others", async () => {
    await open("save");
    useGalaxyStore.setState({ waylines: [{ a: SYSTEM, b: 2, network: 2 }] });
    await land(details());

    const html = overview();
    expect(laneRow(html, "Barnard")).toContain(">wayline<");
    expect(laneRow(html, "Sirius")).toContain("Sirius");
    expect(laneRow(html, "Sirius")).not.toContain("wayline");
  });
});

/** The markup of the lane row naming `system`, up to the row that follows it. */
function laneRow(html: string, system: string): string {
  return html.split('class="ins-lane-name"').find((part) => part.includes(system)) ?? "";
}
