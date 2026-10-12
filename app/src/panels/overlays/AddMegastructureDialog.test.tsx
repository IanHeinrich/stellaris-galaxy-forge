import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// The texture cache cannot fill in a static render, so each picture shows the key it asks for first.
vi.mock("../useTextureUrl", () => ({
  useTextureUrl: (keys: readonly string[]) => `tex:${keys[0]}`,
}));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { MEGASTRUCTURE_ICON_KEY } from "../../lib/details/icons";
import {
  HABITAT_OWNER_NOTE,
  NO_MODEL,
  NO_OWNER_NOTE,
  OWNER_NOTE,
  WRITTEN_FINISHED,
  writtenAsHabitat,
  type MegastructureSpot,
} from "../../lib/megastructurePicks";
import { bindStores } from "../../store/bindStores";
import { OPEN_RESULT } from "../../store/fixture";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { armSession, resetStores } from "../../store/storeFixture";
import {
  megastructureSummary,
  megastructureSwap,
  megastructureTypeView,
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
});
