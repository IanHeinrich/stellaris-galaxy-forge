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
  NO_MODEL,
  NO_OWNER_NOTE,
  OWNER_NOTE,
  READING_FITS,
  WRITTEN_FINISHED,
  fitsUnread,
} from "../../lib/megastructureCopy";
import { bindStores } from "../../store/bindStores";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { AddMegastructureDialog } from "./AddMegastructureDialog";
import { OWNER, dialog, openAt, ownSystem, setUpDialog, space } from "./addMegastructureFixture";

bindStores();

beforeEach(setUpDialog);

describe("the Add megastructure dialog", () => {
  it("opens on a star on the Dyson Sphere's finished stage, with its stages as tiles and its preview beside them", () => {
    ownSystem(OWNER);
    const html = dialog();

    expect(html).toContain('aria-label="Megastructures"');
    expect(html).toMatch(
      /aria-selected="true"[^>]*><span[^>]*><\/span><span[^>]*><span[^>]*>Dyson Sphere<\/span>/,
    );
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

  it("shows a list option's picture and category beside its name, and an empty square for one without", () => {
    const types = new Map(useGameDataStore.getState().megastructureTypes);
    const category = "Megastructure · Basic Resource Production";
    types.set("dyson_sphere_0", { ...types.get("dyson_sphere_0")!, category });
    types.set("dyson_sphere_5", { ...types.get("dyson_sphere_5")!, portrait: "sprite:GFX_dyson" });
    useGameDataStore.setState({ megastructureTypes: types });
    const html = dialog();

    expect(html).toContain(
      '<span class="megastructure-add-portrait"><img src="tex:sprite:GFX_dyson" alt=""/></span>' +
        '<span class="megastructure-add-entry"><span class="megastructure-add-name">Dyson Sphere</span>' +
        `<span class="megastructure-add-category muted" title="${category}">${category}</span>`,
    );
    expect(html).toContain(
      '<span class="megastructure-add-portrait"></span>' +
        '<span class="megastructure-add-entry"><span class="megastructure-add-name">Loom</span>' +
        '<span class="megastructure-add-summary muted">',
    );
    expect(html).toContain(
      '<span class="megastructure-add-banner"><img src="tex:sprite:GFX_dyson" alt=""/></span>' +
        "<h2>Dyson Sphere</h2>",
    );
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
    const html = dialog({ dyson_sphere_5: { variant: "dyson_b_star" } });
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

  it("marks a type it has no model for, and shows the megastructure icon", () => {
    openAt({ kind: "body", body: 12, star: false });
    const html = dialog();
    expect(html).toContain("<h2>Science Nexus Site</h2>");
    expect(html).toContain(`src="tex:${MEGASTRUCTURE_ICON_KEY}"`);
    expect(html).toContain(NO_MODEL);
    expect(html).not.toContain("Stage ");
  });

  it("lists the base game's megastructures first and a mod's under its name, opens past a second relay, and greys it out with the shell's reason", () => {
    const relayed = {
      hyper_relay: {
        refusal: "The system already has a Hyper Relay.",
      },
    };
    openAt(space);
    let html = dialog(relayed);
    expect(html.indexOf("Base game")).toBeLessThan(html.indexOf("Zeta Structures"));
    expect(html).toContain(">Hyper Relay</span>");
    expect(html).toContain("<h2>Beacon</h2>");

    const types = new Map(useGameDataStore.getState().megastructureTypes);
    types.delete("mod_beacon");
    useGameDataStore.setState({ megastructureTypes: types });
    html = dialog(relayed);
    expect(html).toContain("<h2>Hyper Relay</h2>");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("The system already has a Hyper Relay.");
    expect(html).toContain('type="submit" class="primary" disabled=""');
  });

  it("says what goes at the spot is being read until the shell answers, and why it couldn't be", () => {
    useMegastructureAddStore.setState({ fits: null, fitsError: null });
    let html = renderToStaticMarkup(<AddMegastructureDialog />);
    expect(html).toContain(READING_FITS);
    expect(html).toContain('type="submit" class="primary" disabled=""');
    useMegastructureAddStore.setState({ fitsError: "no such system" });
    html = renderToStaticMarkup(<AddMegastructureDialog />).replace(/&#x27;/g, "'");
    expect(html).toContain(fitsUnread("no such system"));
  });

  it("says when no type fits the spot, and offers no Add", () => {
    useGameDataStore.setState({ megastructureTypes: new Map() });
    openAt(space);
    const html = dialog();
    expect(html).toContain("No megastructure the game data defines can go here.");
    expect(html).toContain('type="submit" class="primary" disabled=""');
  });
});
