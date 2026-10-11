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
  WRITTEN_FINISHED,
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
    }),
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
      ["dyson_sphere_5_DESC", "A fully operational Dyson Sphere - §G100%§! energy generation."],
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
    expect(html).toMatch(/aria-selected="true"[^>]*>Dyson Sphere<\/li>/);
    expect(html).toContain('aria-label="Dyson Sphere stages"');
    expect(html).toMatch(/aria-selected="false"[^>]*>.*?Dyson Sphere Site<\/span>/);
    expect(html).toMatch(/aria-selected="true"[^>]*title="Dyson Sphere">.*?Dyson Sphere<\/span>/);
    expect(html).toContain("<h2>Dyson Sphere</h2>");
    expect(html).toContain("Stage 2 of 2");
    expect(html).toContain("+1000 Energy");
    expect(html).toContain("A fully operational Dyson Sphere - 100% energy generation.");
    expect(html).toContain(WRITTEN_FINISHED);
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

  it("lists the base game's megastructures first and a mod's under its name, and greys out a second relay with the reason", () => {
    inSystem(
      systemDetails({
        id: SYSTEM,
        megastructures: [megastructureSummary({ kind: "hyper_relay", planet: null })],
      }),
    );
    openAt(space);
    const html = dialog();
    expect(html.indexOf("Base game")).toBeLessThan(html.indexOf("Zeta Structures"));
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
