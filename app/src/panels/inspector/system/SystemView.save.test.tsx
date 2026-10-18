import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detailOf, editResult, name } from "../../../store/fixture";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import type { StarbaseSummary } from "../../../generated/StarbaseSummary";
import { kindTitle } from "../../../lib/special";
import { bindStores } from "../../../store/bindStores";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useGeneratorStore, type FiledClass } from "../../../store/generatorStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { useSceneStore } from "../../../store/sceneStore";
import {
  details,
  fleet,
  land,
  open,
  overview,
  planet,
  resetStores,
  sections,
  SYSTEM,
} from "../inspectorFixture";
import { armStarClasses } from "../../../store/storeFixture";
import { buttons, shown } from "../../../test/elements";
import { mockedIpc } from "../../../test/ipc";
import { arrangement, starType } from "../../../test/builders";
import { lastDrawn } from "../../../test/drawn";
import { until } from "../../../test/wait";

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
      "Hyperlanes · 4",
      "Bypasses · 0",
      "Planets · 1",
      "Flags · 0",
      "Initializer",
    ]);
    expect(html).toContain('role="group" aria-label="Position"');
    expect(html).toContain("System total");
    expect(html).toContain('role="button"');
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
          at: null,
          planet: null,
          culture: null,
          shipyard: false,
        },
        megastructures: [
          { id: 5, kind: "ring_world_ruined", owner: null, planet: null, at: null, culture: null },
        ],
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
    mockedIpc.getSystem.mockImplementation(async (id) => {
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

  it("heads its Initializer section with the key, and lists the countries in the system", async () => {
    useGameDataStore.setState({
      special: new Map([
        [
          SYSTEM,
          {
            id: SYSTEM,
            primary: "leviathan",
            kinds: ["leviathan"],
            initializer: "guardians_init_dragon",
            initializer_known: true,
            source_file: "leviathans_system_initializers.txt",
            flags: [],
            countries: [
              {
                id: null,
                name_key: "Voidwyrm",
                name: "Voidwyrm",
                country_type: "guardian_dragon",
                icon: null,
                generated_name: false,
              },
            ],
            label: "Voidwyrm",
            label_is_generated_name: false,
          },
        ],
      ]),
    });
    await open("save");
    await land(details());
    useInspectorStore.setState({ sections: { "system.initializer": false } });

    const html = overview();
    expect(html).toContain(
      '<div class="ins-init"><div class="ins-init-head"><span class="mono ins-init-name">',
    );
    expect(html).toContain(
      '<span class="k">Countries here</span><span><span class="ins-init-country">Voidwyrm</span></span>',
    );
    expect(html).not.toContain("Change…");
    expect(html).not.toContain("ins-group");
  });

  it("opens the flags on what galaxy generation hid here, one readable line each", async () => {
    const flags = ["AI_hub", "AI_system_2", "hidden_cutholoid"];
    mockedIpc.getSystem.mockImplementation(async (id) => {
      const detail = detailOf(id);
      return { ...detail, system: { ...detail.system, flags } };
    });
    useGameDataStore.setState({
      special: new Map([
        [
          SYSTEM,
          {
            id: SYSTEM,
            primary: "contingency",
            kinds: ["contingency", "cutholoid"],
            initializer: "ai_system_02",
            initializer_known: true,
            source_file: null,
            flags,
            countries: [],
            label: "",
            label_is_generated_name: false,
          },
        ],
      ]),
    });
    await open("save");
    await land(details());

    const html = overview();
    expect(shown(html)).toContain(`${kindTitle("contingency")} ${kindTitle("cutholoid")}`);
    expect(html).toContain("<div>AI_system_2</div>");
  });

  it("keeps the flags closed on a system that hides nothing", async () => {
    const flags = ["story_flag"];
    mockedIpc.getSystem.mockImplementation(async (id) => {
      const detail = detailOf(id);
      return { ...detail, system: { ...detail.system, flags } };
    });
    await open("save");
    await land(details());

    const html = overview();
    expect(html).not.toContain("<div>story_flag</div>");
    expect(html).not.toContain("Contingency hub");
  });

  it("says it is still reading until the record arrives", async () => {
    await open("save");
    expect(overview()).toContain("Reading the system");
  });
});

/** The install's classes for the binary under test, its bodies and a class to change it to. */
const CLASSES = {
  sc_g: ["pc_g_star"],
  sc_binary_1: ["pc_a_star", "pc_pulsar"],
  sc_binary_2: ["pc_b_star", "pc_neutron_star"],
};
const NAMES = { sc_binary_1: "X-ray Binary", sc_binary_2: "Neutron Binary" };

describe("a save system's wormhole pair", () => {
  it("names the natural wormhole's other end and says how to take the pair out", async () => {
    await open("save");
    await land(details());
    useGalaxyStore.setState({ bypasses: [{ type: "wormhole", a: SYSTEM, b: 3 }] });

    const html = overview();
    expect(sections(html)).toContain("Wormhole pair");
    expect(html).toContain("Wormhole pair with ");
    expect(html).toContain("Sirius");
    expect(html).toContain("To take the pair out");
  });
});

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
    armStarClasses(CLASSES, NAMES);
    await open("save");
    await land(stars());

    const html = overview();
    // The fixture has no names for the bodies.
    expect(shown(html)).toContain("pc_a_star + pc_pulsar · 1 planet · nebula");
    expect(html).not.toContain("Star class");
    expect(html).not.toContain('aria-haspopup="listbox"');
  });

  it("notes stars no class has, by their names, and what the game treats the system as", async () => {
    armStarClasses(CLASSES, NAMES);
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
    armStarClasses(CLASSES, NAMES);
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

  it("marks each star and planet in the planet list as a page with fields to edit", async () => {
    armStarClasses(CLASSES, NAMES);
    await open("save");
    await land(stars());

    const html = overview();
    expect(shown(html).match(/✎ Edit/g)).toHaveLength(3);
    expect(html).toContain("Open this star&#x27;s page to change its type and size");
    expect(html).toContain(
      "Open this planet&#x27;s page to rename it or change its modifiers, deposits and anomaly",
    );
  });

  it("marks a star as editable and lists it first without game data", async () => {
    useGameDataStore.setState({ status: "idle" });
    await open("save");
    await land(
      details({ planets: [planet(100, "Tarkin"), planet(101, "Alpha", { class: "pc_g_star" })] }),
    );

    const html = overview();
    expect(shown(html).match(/✎ Edit/g)).toHaveLength(2);
    expect(html.indexOf("Alpha")).toBeLessThan(html.indexOf("Tarkin"));
  });

  it("stays plain text on a scenario", async () => {
    armStarClasses(CLASSES, NAMES);
    await open("scenario");
    await land(stars());

    const html = overview();
    expect(html).toContain("X-ray Binary · ");
    expect(html).not.toContain("Star class");
    expect(html).not.toContain('aria-haspopup="listbox"');
    expect(shown(html)).not.toContain("✎ Edit");
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
    at: null,
    planet: null,
    culture: null,
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

describe("a save system's planet rows", () => {
  it("say how far out each body orbits", async () => {
    await open("save");
    await land(details({ planets: [planet(100, "Tarkin", { orbit: 61.6 }), planet(101, "Ossa")] }));

    const html = overview();
    expect(html).toContain("<span>orbit 62</span>");
    expect(html.match(/orbit \d/g)).toHaveLength(1);
  });
});

describe("a system added this session", () => {
  beforeEach(() => {
    mockedIpc.getSystem.mockImplementation(async (id) => {
      const detail = detailOf(id);
      return { ...detail, system: { ...detail.system, star_class: "sc_m", added: true } };
    });
    useGeneratorStore.setState({
      starClasses: [
        { key: "sc_g", label: "Yellow star", odds: 1, randomOdds: 1 },
        { key: "sc_m", label: "Red star", odds: 1, randomOdds: 1 },
      ],
    });
  });

  it("opens with a green block of what only it can have changed, above its position", async () => {
    await open("save");
    await land(details({ planets: [planet(100, "Tarkin")] }));

    const html = overview();
    expect(html).toContain('role="group" aria-label="Added this session"');
    expect(html).toContain("+ added this session");
    expect(html).toContain('aria-label="System name"');
    expect(html).toContain("Red star");
    expect(html).toContain("Reroll");
    expect(html).toContain(">Delete system</button>");
    expect(html.indexOf("Added this session")).toBeLessThan(html.indexOf(">Position<"));
  });

  const BLACK_HOLE_AND_M = ["pc_black_hole", "pc_m_star"];

  /** Opens an added system built of `bodies` from `initializer`, its stars filed as `filed` says. */
  async function openAdded(
    initializer: string,
    bodies: string[],
    filed: [string, FiledClass][] = [],
    starClass = "sc_m",
  ): Promise<string> {
    const added = {
      star_class: starClass,
      added: true,
      initializer,
      bodies: [...bodies, "pc_barren"].map((cls) => ({ class: cls, size: 10 })),
    };
    mockedIpc.getSystem.mockImplementation(async (id) => {
      const detail = detailOf(id);
      return { ...detail, system: { ...detail.system, ...added } };
    });
    armStarClasses({ sc_m: ["pc_m_star"], sc_black_hole: ["pc_black_hole"] }, {}, ["pc_barren"]);
    useGeneratorStore.setState({
      arrangements: [
        arrangement("binary_1", 2, "Close pair", 0.6),
        arrangement("binary_2", 2, "Distant companion", 0.4, { shape: "distant_companion" }),
        arrangement("trinary_1", 3, "Close trio", 1),
      ],
      starTypes: ["pc_black_hole", "pc_m_star", "pc_k_star"].map((key) => starType(key)),
      filed: new Map(filed),
    });
    await open("save");
    useGalaxyStore.getState().applyDelta({
      systems: [{ ...useGalaxyStore.getState().systems.get(SYSTEM)!, ...added }],
    });
    await land(details({ planets: [planet(100, "Tarkin")] }));
    mockedIpc.rerollSystem.mockResolvedValue(editResult());
    return overview();
  }

  const picker = (label: string) =>
    lastDrawn(
      ({ props }) => props.label === label && typeof props.onPick === "function",
      label,
    ) as {
      onPick(key: string | null): void;
      disabled?: boolean;
      title?: string;
    };
  const sentPicks = () => mockedIpc.rerollSystem.mock.calls.map(([id, , pick]) => [id, pick]);
  const built = (layout: string, stars: string[], starClass: string | null) => ({
    kind: "built",
    layout,
    stars,
    star_class: starClass,
    planets: true,
  });

  it("shows a binary's arrangement, stars and map icon, each rebuilding it from its stars", async () => {
    const html = await openAdded("binary_2", BLACK_HOLE_AND_M, [
      ["pc_black_hole+pc_m_star", { kind: "filed", starClass: "sc_black_hole" }],
    ]);
    expect(html).toContain(">Arrangement<");
    expect(html).toContain("Distant companion");
    expect(html).toContain('aria-label="Star 1: Named pc_black_hole"');
    expect(html).toContain('aria-label="Star 2: Named pc_m_star"');
    expect(html).toContain(">Map icon<");
    expect(html).not.toContain(">Star class<");

    picker("Star 2").onPick("pc_k_star");
    await until(() => expect(mockedIpc.rerollSystem).toHaveBeenCalledTimes(1));
    picker("Map icon").onPick("sc_black_hole");
    await until(() => expect(mockedIpc.rerollSystem).toHaveBeenCalledTimes(2));
    picker("Arrangement").onPick("trinary_1");
    await until(() => expect(mockedIpc.rerollSystem).toHaveBeenCalledTimes(3));

    expect(sentPicks()).toEqual([
      [SYSTEM, built("binary_2", ["pc_black_hole", "pc_k_star"], "sc_m")],
      [SYSTEM, built("binary_2", ["pc_black_hole", "pc_m_star"], null)],
      [SYSTEM, built("trinary_1", ["pc_black_hole", "pc_m_star", "pc_black_hole"], "sc_m")],
    ]);
  });

  it("names the map icon by its class alone, the automatic one clearing the choice and another setting it", async () => {
    const filed: [string, FiledClass][] = [
      ["pc_black_hole+pc_m_star", { kind: "filed", starClass: "sc_black_hole" }],
    ];
    const fileable = () => {
      const { starClasses } = useGameDataStore.getState();
      useGameDataStore.setState({
        starClasses: new Map([...starClasses].map(([k, v]) => [k, { ...v, fileable: true }])),
      });
    };
    await openAdded("binary_2", BLACK_HOLE_AND_M, filed, "sc_black_hole");
    fileable();
    const html = overview();
    expect(html).not.toContain("(automatic)");
    expect(html).toMatch(/aria-label="Map icon: sc_black_hole"/);
    const items = (picker("Map icon") as unknown as { items: { key: string }[] }).items;
    expect(items.map((i) => i.key).sort()).toEqual(["sc_black_hole", "sc_m"]);

    picker("Map icon").onPick("sc_m");
    await until(() => expect(mockedIpc.rerollSystem).toHaveBeenCalledTimes(1));
    expect(sentPicks()).toEqual([
      [SYSTEM, built("binary_2", ["pc_black_hole", "pc_m_star"], "sc_m")],
    ]);

    await openAdded("binary_2", BLACK_HOLE_AND_M, filed, "sc_m");
    fileable();
    overview();
    picker("Map icon").onPick("sc_black_hole");
    await until(() => expect(mockedIpc.rerollSystem).toHaveBeenCalledTimes(2));
    expect(sentPicks()[1]).toEqual([
      SYSTEM,
      built("binary_2", ["pc_black_hole", "pc_m_star"], null),
    ]);
  });

  it("holds a binary's changes until its automatic class is known, and says why it is not", async () => {
    await openAdded("binary_2", BLACK_HOLE_AND_M);
    expect(picker("Star 1").disabled).toBe(true);
    expect(picker("Map icon").disabled).toBe(true);
    expect(picker("Arrangement").disabled).toBe(true);

    const refused = "pc_rock is no star";
    const html = await openAdded("binary_2", BLACK_HOLE_AND_M, [
      ["pc_black_hole+pc_m_star", { kind: "refused", reason: refused }],
    ]);
    expect(html).toContain(refused);
    expect(picker("Star 2").disabled).toBe(true);
    expect(picker("Star 2").title).toBe(refused);
  });

  it("keeps the star class picker for a special layout of two stars", async () => {
    const html = await openAdded("special_pair", BLACK_HOLE_AND_M);
    expect(html).toContain(">Star class<");
    expect(html).not.toContain(">Arrangement<");
    expect(html).not.toContain(">Map icon<");
  });

  it("turns a single star into a pair of it, filed automatically", async () => {
    const html = await openAdded("basic_init_01", ["pc_m_star"]);
    expect(html).toContain(">Arrangement<");
    expect(html).toContain(">Star class<");
    picker("Arrangement").onPick("binary_1");
    await until(() => expect(mockedIpc.rerollSystem).toHaveBeenCalledTimes(1));
    expect(sentPicks()).toEqual([[SYSTEM, built("binary_1", ["pc_m_star", "pc_m_star"], null)]]);
  });

  it("is plain on a system the file already held", async () => {
    mockedIpc.getSystem.mockImplementation(async (id) => detailOf(id));
    await open("save");
    await land(details({ planets: [planet(100, "Tarkin")] }));

    const html = overview();
    expect(html).not.toContain("Added this session");
    expect(html).not.toContain("added this session");
    expect(html).not.toContain("Delete system");
  });
});

describe("the Planets header's system view button", () => {
  it("offers the view on a save or a scenario until it shows this system", async () => {
    await open("save");
    await land(details({ planets: [planet(100, "Tarkin")] }));
    expect(buttons(overview())).toContain("Show in system view");

    useSceneStore.getState().enterSystem(SYSTEM);
    expect(overview()).not.toContain("Show in system view");

    useSceneStore.getState().exitScene();
    await open("scenario");
    await land(details({ planets: [planet(100, "Tarkin")] }));
    expect(buttons(overview())).toContain("Show in system view");
  });
});
