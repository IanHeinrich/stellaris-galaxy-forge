import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// The texture cache cannot fill in a static render, so each picture shows the key it asks for first.
vi.mock("../useTextureUrl", () => ({
  useTextureUrl: (keys: readonly string[]) => `tex:${keys[0]}`,
}));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import type { RingWorldClearing } from "../../generated/RingWorldClearing";
import { MEGASTRUCTURE_ICON_KEY } from "../../lib/details/icons";
import {
  BODY_HAS_MEGASTRUCTURE,
  HABITAT_ORBITAL_HOST_TAKEN,
  HABITAT_ORBITAL_OWNER_NOTE,
  HABITAT_OWNER_NOTE,
  NO_MODEL,
  NO_OWNER_NOTE,
  OWNER_NOTE,
  WRITTEN_FINISHED,
  habitatOrbitalNote,
  writtenAsHabitat,
  type MegastructureSpot,
} from "../../lib/megastructurePicks";
import {
  CLEAR_PLANETS,
  LEAVE_PLANETS,
  QUADRANTS,
  RING_WRITTEN,
  SET_ALL,
} from "../../lib/ringWorldAdd";
import { bindStores } from "../../store/bindStores";
import { useDetailsStore } from "../../store/detailsStore";
import { OPEN_RESULT } from "../../store/fixture";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { armSession, resetStores } from "../../store/storeFixture";
import {
  megastructureSummary,
  megastructureSwap,
  megastructureTypeView,
  planetSummary,
  starbaseSummary,
  systemDetails,
} from "../../test/builders";
import { inSystem, openWith } from "../../test/session";
import { AddMegastructureDialog } from "./AddMegastructureDialog";

bindStores();

const SYSTEM = 0;
const OWNER = 3;
const star: MegastructureSpot = { kind: "body", body: 1, star: true };
const space: MegastructureSpot = { kind: "space", x: 10, y: 10 };
const LOOM = ["loom_0", "loom_1", "loom_2", "loom_3", "loom_4", "loom_5"];

const dialog = () => renderToStaticMarkup(<AddMegastructureDialog />);

function ownSystem(owner: number | null) {
  const systems = new Map(useGalaxyStore.getState().systems);
  systems.set(SYSTEM, { ...systems.get(SYSTEM)!, owner });
  useGalaxyStore.setState({ systems });
}

function openAt(spot: MegastructureSpot) {
  useMegastructureAddStore.setState({ prompt: { system: SYSTEM, spot } });
}

beforeEach(async () => {
  resetStores();
  armSession();
  await openWith(OPEN_RESULT);
  inSystem(
    systemDetails({
      id: SYSTEM,
      starbase: starbaseSummary({ owner: OWNER, culture: "mammalian_01" }),
    }),
  );
  const onStar = { place: "body", star_only: true } as const;
  const outside = { place: "free", outside_gravity_well: true } as const;
  const types = [
    megastructureTypeView("dyson_sphere_0", { placement: onStar }),
    megastructureTypeView("dyson_sphere_5", {
      upgrade_from: ["dyson_sphere_0"],
      placement: onStar,
      produces: [["energy", 1000]],
      country_effects: [{ key: "country_resource_max_add", value: 5, text: "+5 Max Energy" }],
      construction_summary: [
        {
          on: "system",
          kind: "modifier",
          key: "dyson_glow",
          name: "Dyson Glow",
          permanent: true,
          conditional: false,
        },
      ],
      swaps: [megastructureSwap("dyson_b_star", { classes: ["pc_b_star"] })],
    }),
    megastructureTypeView("dyson_b_star", { placement: onStar }),
    ...LOOM.map((key, i) =>
      megastructureTypeView(key, {
        upgrade_from: i === 0 ? [] : [LOOM[i - 1]],
        placement: onStar,
        source: "Zeta Structures",
        base_game: false,
      }),
    ),
    megastructureTypeView("think_tank_0", { entity: null }),
    megastructureTypeView("hyper_relay", { placement: outside, bypass_type: "relay_bypass" }),
    megastructureTypeView("mod_beacon", {
      placement: outside,
      source: "Zeta Structures",
      base_game: false,
    }),
  ];
  useGameDataStore.setState({
    status: "ready",
    megastructureTypes: new Map(types.map((t) => [t.key, t])),
    names: new Map([
      ["dyson_sphere_0", "Dyson Sphere Site"],
      ["dyson_sphere_5", "Dyson Sphere"],
      ["think_tank_0", "Science Nexus Site"],
      ["hyper_relay", "Hyper Relay"],
      ["mod_beacon", "Beacon"],
      ["dyson_b_star", "B-class Dyson Sphere"],
      ["loom_0", "Loom Site"],
      ["loom_1", "Loom Frame"],
      ["loom_2", "Loom Weave"],
      ["loom_3", "Loom Hum"],
      ["loom_4", "Loom Glow"],
      ["loom_5", "Loom"],
    ]),
    texts: new Map([
      ["dyson_sphere_5_DESC", "A fully operational Dyson Sphere - §G100%§! energy generation."],
      ["dyson_b_star_DESC", "A Dyson Sphere around a blue star."],
    ]),
  });
  useMegastructureAddStore.setState({ last: null });
  openAt(star);
});

describe("the Add megastructure dialog", () => {
  it("opens on a star on the Dyson Sphere's finished stage, with its stages as tiles and its preview beside them", () => {
    ownSystem(OWNER);
    const html = dialog();

    expect(html).toContain('aria-label="Megastructures"');
    expect(html).toMatch(/aria-selected="true"[^>]*><span[^>]*>Dyson Sphere<\/span>/);
    expect(html).toContain('aria-label="Dyson Sphere stages"');
    expect(html).toMatch(/aria-selected="false"[^>]*title="Dyson Sphere Site">.*?>Site<\/span>/);
    expect(html).toMatch(/aria-selected="true"[^>]*title="Dyson Sphere">.*?>Finished<\/span>/);
    expect(html).toContain("<h2>Dyson Sphere</h2>");
    expect(html).toContain("Stage 2 of 2: Finished");
    expect(html).toContain("+1000 Energy");
    expect(html).toContain(WRITTEN_FINISHED);
  });

  it("shows a tile's place in its row above its short name, and a list option's summary under its name", () => {
    let html = dialog();
    expect(html).toContain('<span class="megastructure-add-summary muted">6 stages</span>');
    expect(html).toContain(">2 stages · by star class</span>");

    useMegastructureAddStore.setState({ last: "loom_1" });
    html = dialog();
    expect(html).toMatch(/title="Loom Frame">.*?>2 of 6<\/span><span[^>]*>Frame<\/span>/);
    expect(html).toMatch(/>6 of 6<\/span><span[^>]*>Finished<\/span>/);
  });

  it("renders the game's description with its colours, and puts the preview's parts in order", () => {
    const html = dialog();
    expect(html).toContain(
      'A fully operational Dyson Sphere - <span class="gt-G">100%</span> energy generation.',
    );
    expect(html).not.toContain("§");
    const parts = [
      "<h2>Dyson Sphere</h2>",
      "Stage 2 of 2: Finished",
      "A fully operational",
      "Produces each month",
      "Empire effects",
      "+5 Max Energy",
      "Adding it also writes",
      "A Dyson Glow modifier on the system",
    ].map((part) => html.indexOf(part));
    expect(parts).not.toContain(-1);
    expect(parts).toEqual([...parts].sort((a, b) => a - b));
  });

  it("leaves out the parts of the preview that have nothing to say", () => {
    useMegastructureAddStore.setState({ last: "loom_5" });
    const html = dialog();
    expect(html).toContain("<h2>Loom</h2>");
    expect(html).not.toContain("Produces each month");
    expect(html).not.toContain("Empire effects");
    expect(html).not.toContain("Adding it also writes");
    expect(html).not.toContain("megastructure-add-description");
  });

  it("reads Add as the stage and its place, and names the type the star swaps it for", () => {
    expect(dialog()).toContain(">Add Dyson Sphere, stage 2 of 2</button>");
    expect(dialog()).not.toContain("B-class Dyson Sphere");

    useMegastructureAddStore.setState({ last: "loom_1" });
    expect(dialog()).toContain(">Add Frame, stage 2 of 6</button>");

    useMegastructureAddStore.setState({ last: null });
    openAt({ kind: "body", body: 1, star: true, class: "pc_b_star" });
    const html = dialog();
    expect(html).toContain("<h2>B-class Dyson Sphere</h2>");
    expect(html).toContain("A Dyson Sphere around a blue star.");
    expect(html).toContain(">Add Dyson Sphere, stage 2 of 2</button>");
  });

  it("names the system's owner, draws the models in its culture, and says who gets an unowned system's", () => {
    ownSystem(OWNER);
    let html = dialog();
    expect(html).toContain(OWNER_NOTE);
    expect(html).toContain('src="tex:model:mammalian_01:dyson_sphere_5_entity"');
    expect(html).not.toContain("<select");

    ownSystem(null);
    html = dialog();
    expect(html).toContain("No owner");
    expect(html).toContain(NO_OWNER_NOTE);
    expect(html).toContain('src="tex:model:none:dyson_sphere_5_entity"');
  });

  it("opens on the type added last when it goes here", () => {
    useMegastructureAddStore.setState({ last: "dyson_sphere_0" });
    expect(dialog()).toContain("<h2>Dyson Sphere Site</h2>");
  });

  it("marks a type it has no model for, and shows the megastructure icon", () => {
    openAt({ kind: "body", body: 12, star: false });
    const html = dialog();
    expect(html).toContain("<h2>Science Nexus Site</h2>");
    expect(html).toContain(`src="tex:${MEGASTRUCTURE_ICON_KEY}"`);
    expect(html).toContain(NO_MODEL);
    expect(html).not.toContain("Stage ");
  });

  it("swaps a stage for the star's type only while the save's global flags allow it", () => {
    const types = new Map(useGameDataStore.getState().megastructureTypes);
    const dyson = types.get("dyson_sphere_5")!;
    types.set("dyson_sphere_5", {
      ...dyson,
      swaps: [
        megastructureSwap("dyson_b_star", { flags: ["giga_scaling"], classes: ["pc_b_star"] }),
      ],
    });
    useGameDataStore.setState({ megastructureTypes: types });
    openAt({ kind: "body", body: 1, star: true, class: "pc_b_star" });
    expect(dialog()).toContain("<h2>Dyson Sphere</h2>");

    useGalaxyStore.setState({ globalFlags: new Set(["giga_scaling"]) });
    expect(dialog()).toContain("<h2>B-class Dyson Sphere</h2>");
  });

  it("lists the base game's megastructures first and a mod's under its name, opens past a second relay, and greys it out with the reason", () => {
    inSystem(
      systemDetails({
        id: SYSTEM,
        megastructures: [megastructureSummary({ kind: "hyper_relay", planet: null })],
      }),
    );
    openAt(space);
    let html = dialog();
    expect(html.indexOf("Base game")).toBeLessThan(html.indexOf("Zeta Structures"));
    expect(html).toContain(">Hyper Relay</span>");
    expect(html).toContain("<h2>Beacon</h2>");

    const types = new Map(useGameDataStore.getState().megastructureTypes);
    types.delete("mod_beacon");
    useGameDataStore.setState({ megastructureTypes: types });
    html = dialog();
    expect(html).toContain("<h2>Hyper Relay</h2>");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("The system already has a hyper relay.");
    expect(html).toContain('type="submit" disabled=""');
  });

  it("says when no type fits the spot, and offers no Add", () => {
    useGameDataStore.setState({ megastructureTypes: new Map() });
    openAt(space);
    const html = dialog();
    expect(html).toContain("No megastructure the game data defines can go here.");
    expect(html).toContain('type="submit" disabled=""');
  });
});

describe("the Add megastructure dialog on a habitat", () => {
  const planet: MegastructureSpot = { kind: "body", body: 2, star: false };
  const footer = () => dialog().replace(/&#x27;/g, "'");

  beforeEach(() => {
    const complex = megastructureTypeView("habitat_central_complex", { habitat: true });
    useGameDataStore.setState({
      megastructureTypes: new Map([[complex.key, complex]]),
      names: new Map([["habitat_central_complex", "Habitat Central Complex"]]),
    });
    useMegastructureAddStore.setState({ last: "habitat_central_complex" });
    openAt(planet);
  });

  it("says the habitat has the owner's skin in a system an empire owns", () => {
    ownSystem(OWNER);
    const html = footer();
    expect(html).toContain(writtenAsHabitat(true));
    expect(html).toContain("It has the habitat skin of the empire that owns the system.");
    expect(html).toContain(HABITAT_OWNER_NOTE);
  });

  it("says the habitat has the class's default skin in a system no one owns", () => {
    ownSystem(null);
    const html = footer();
    expect(html).toContain(writtenAsHabitat(false));
    expect(html).toContain("No one owns the system, so it has the habitat class's default skin.");
    expect(html).not.toContain("the empire that owns the system");
  });
  it("keeps the restored complex a habitat round a planet that has a megastructure", () => {
    const restored = megastructureTypeView("habitat_central_complex_restored", { habitat: true });
    useGameDataStore.setState({
      megastructureTypes: new Map([[restored.key, restored]]),
      names: new Map([["habitat_central_complex_restored", "Restored Habitat Central Complex"]]),
    });
    useMegastructureAddStore.setState({ last: restored.key });
    inSystem(
      systemDetails({
        id: SYSTEM,
        megastructures: [megastructureSummary({ kind: "think_tank_3", planet: 2 })],
      }),
    );
    ownSystem(OWNER);
    const html = footer();
    expect(html).toContain(writtenAsHabitat(true));
    expect(html).toContain(HABITAT_OWNER_NOTE);
    expect(html).not.toContain(BODY_HAS_MEGASTRUCTURE);
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).not.toContain('type="submit" disabled=""');
  });

  describe("with a major orbital", () => {
    beforeEach(() => {
      const restored = megastructureTypeView("habitat_central_complex_restored", {
        habitat: true,
        habitat_orbital: true,
      });
      useGameDataStore.setState({
        megastructureTypes: new Map([[restored.key, restored]]),
        names: new Map([[restored.key, "Restored Habitat Central Complex"]]),
      });
      useMegastructureAddStore.setState({ last: restored.key });
    });

    it("says the orbital goes to the system's owner, in the footer and the Owner line", () => {
      ownSystem(OWNER);
      const html = footer();
      expect(html).toContain(
        "A major orbital is added at its host, owned by the empire that owns the system.",
      );
      expect(html).toContain(habitatOrbitalNote(true, false));
      expect(html).toContain(HABITAT_ORBITAL_OWNER_NOTE);
      expect(html).not.toContain(HABITAT_ORBITAL_HOST_TAKEN);
    });

    it("says the orbital has no owner in a system no one owns", () => {
      ownSystem(null);
      const html = footer();
      expect(html).toContain("A major orbital is added at its host, with no owner.");
      expect(html).not.toContain(HABITAT_ORBITAL_OWNER_NOTE);
    });

    it("says no orbital is added round a planet that has a megastructure", () => {
      inSystem(
        systemDetails({
          id: SYSTEM,
          megastructures: [megastructureSummary({ kind: "think_tank_3", planet: 2 })],
        }),
      );
      ownSystem(OWNER);
      const html = footer();
      expect(html).toContain(HABITAT_ORBITAL_HOST_TAKEN);
      expect(html).not.toContain("A major orbital is added");
      expect(html).not.toContain(HABITAT_ORBITAL_OWNER_NOTE);
    });

    it("says nothing of an orbital for the base complex", () => {
      const complex = megastructureTypeView("habitat_central_complex", { habitat: true });
      useGameDataStore.setState({
        megastructureTypes: new Map([[complex.key, complex]]),
        names: new Map([[complex.key, "Habitat Central Complex"]]),
      });
      useMegastructureAddStore.setState({ last: complex.key });
      ownSystem(OWNER);
      const html = footer();
      expect(html).not.toContain("major orbital");
      expect(html).not.toContain(HABITAT_ORBITAL_HOST_TAKEN);
    });
  });
});

describe("the Add megastructure dialog on a ring world", () => {
  const ringWorld = { place: "unsupported", why: { kind: "ring_world" } } as const;
  const literal = (text: string) => ({
    name: { key: text, literal: true, variables: [] },
    name_key: text,
  });
  const html = () => dialog().replace(/&#x27;/g, "'");
  const clearing = (over: Partial<RingWorldClearing> = {}): RingWorldClearing => ({
    system: SYSTEM,
    bodies: [5, 4, 2, 3],
    moons: 1,
    colonies: [2],
    belts: 1,
    starbase_bodies: [],
    ...over,
  });

  beforeEach(() => {
    const types = [
      megastructureTypeView("ring_world_1", { placement: { place: "body", star_only: true } }),
      megastructureTypeView("ring_world_2_intermediate", {
        upgrade_from: ["ring_world_1"],
        placement: ringWorld,
      }),
    ];
    useGameDataStore.setState({
      megastructureTypes: new Map(types.map((t) => [t.key, t])),
      names: new Map([
        ["ring_world_1", "Ring World Site"],
        ["ring_world_2_intermediate", "Ring World Frame"],
      ]),
    });
    inSystem(
      systemDetails({
        id: SYSTEM,
        planets: [
          planetSummary({ id: 1, role: "primary", class: "pc_g_star", ...literal("Lachium") }),
          planetSummary({ id: 2, ...literal("Lachium I"), colonised: true }),
          planetSummary({ id: 3, ...literal("Lachium II") }),
        ],
      }),
    );
    useMegastructureAddStore.setState({
      last: "ring_world_2_intermediate",
      ringStages: ["finished", "finished", "finished", "finished"],
      ringClear: false,
      clearing: clearing(),
      clearingError: null,
    });
    openAt(star);
  });

  it("offers the site and the Ring on a star, with a grid of quadrants A to D, all finished", () => {
    const page = html();
    expect(page).toMatch(/aria-selected="true"[^>]*><span[^>]*>Ring World<\/span>/);
    expect(page).toMatch(/title="Ring World Site">.*?>Site<\/span>/);
    expect(page).toMatch(/aria-selected="true"[^>]*title="Ring World">.*?>Ring<\/span>/);
    expect(page).not.toContain('aria-disabled="true"');
    for (const quadrant of QUADRANTS) {
      expect(page).toMatch(new RegExp(`aria-label="${quadrant} Finished"[^>]*checked=""`));
      expect(page).toContain(`aria-label="${quadrant} Damaged"`);
    }
    expect(page).not.toContain("Restored");
    expect(page).toContain(SET_ALL);
    expect(page).toContain("All 4 quadrants are finished.");
    expect(page).toContain(LEAVE_PLANETS);
    expect(page).toContain(CLEAR_PLANETS);
    expect(page).toContain(RING_WRITTEN);
    expect(page).toContain(">Add Ring World</button>");
    expect(page).not.toContain("Clearing deletes");

    useMegastructureAddStore.setState({
      ringStages: ["finished", "finished", "ruined", "damaged"],
    });
    expect(html()).toContain("A and B finished, C ruined, D damaged.");
  });

  it("warns before Add what clearing deletes, colonies by planet name", () => {
    useMegastructureAddStore.setState({ ringClear: true });
    const page = html();
    expect(page).toContain(
      "Clearing deletes 3 planets, 1 moon and 1 belt, and the colony on Lachium I.",
    );
    expect(page.indexOf("Clearing deletes")).toBeLessThan(page.indexOf(">Add Ring World</button>"));
    expect(page).not.toContain('type="submit" disabled=""');
  });

  it("turns Clear off with the planet a starbase orbits, which the core refuses to clear", () => {
    useMegastructureAddStore.setState({
      ringClear: true,
      clearing: clearing({ starbase_bodies: [3] }),
    });
    const page = html();
    expect(page).toContain(
      "Galaxy Forge can't clear this system: a starbase orbits Lachium II, which clearing would delete.",
    );
    expect(page).toMatch(/<input type="radio" disabled="" name="ring-planets"\/>/);
    expect(page).not.toContain("Clearing deletes");
    expect(page).toContain('type="submit" disabled=""');
  });

  it("greys out a ring world the game data lays out no ring for, with the reason", () => {
    const types = new Map(useGameDataStore.getState().megastructureTypes);
    const frame = types.get("ring_world_2_intermediate")!;
    types.set(frame.key, { ...frame, ring_world_refused: "it lays out no ring" });
    useGameDataStore.setState({ megastructureTypes: types });
    const page = html();
    expect(page).toContain(
      "Galaxy Forge can't build this ring world from the game data: it lays out no ring.",
    );
    expect(page).toContain('aria-disabled="true"');
    expect(page).not.toContain(SET_ALL);
    expect(page).toContain(">Add Ring World Site</button>");
  });

  it("refuses the Ring in a system of two stars, as the core does", () => {
    const planets = useDetailsStore.getState().details.get(SYSTEM)!.planets;
    inSystem(
      systemDetails({
        id: SYSTEM,
        planets: [...planets, planetSummary({ id: 9, role: "star", class: "pc_k_star" })],
      }),
    );
    expect(html()).toContain("The system has 2 stars, and a ring world stands round one.");
  });
});
