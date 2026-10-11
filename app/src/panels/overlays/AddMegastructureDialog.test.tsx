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
import { WRITTEN_FINISHED, type MegastructureSpot } from "../../lib/megastructurePicks";
import { bindStores } from "../../store/bindStores";
import { OPEN_RESULT } from "../../store/fixture";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { armSession, resetStores } from "../../store/storeFixture";
import { megastructureTypeView, starbaseSummary, systemDetails } from "../../test/builders";
import { inSystem, openWith } from "../../test/session";
import { AddMegastructureDialog } from "./AddMegastructureDialog";

bindStores();

const SYSTEM = 0;
const OWNER = 3;
const star: MegastructureSpot = { kind: "body", body: 1, star: true };

const dialog = () => renderToStaticMarkup(<AddMegastructureDialog />);

function ownSystem(owner: number | null) {
  const systems = new Map(useGalaxyStore.getState().systems);
  systems.set(SYSTEM, { ...systems.get(SYSTEM)!, owner });
  useGalaxyStore.setState({ systems });
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
  const types = [
    megastructureTypeView("dyson_sphere_0", { placement: onStar }),
    megastructureTypeView("dyson_sphere_1", {
      upgrade_from: ["dyson_sphere_0"],
      placement: onStar,
      produces: [["energy", 1000]],
    }),
    megastructureTypeView("think_tank_0", { entity: null }),
  ];
  useGameDataStore.setState({
    status: "ready",
    megastructureTypes: new Map(types.map((t) => [t.key, t])),
    names: new Map([
      ["dyson_sphere_0", "Dyson Sphere Site"],
      ["dyson_sphere_1", "Dyson Sphere"],
      ["think_tank_0", "Science Nexus Site"],
      ["dyson_sphere_1_DESC", "A fully operational Dyson Sphere - §G100%§! energy generation."],
    ]),
  });
  useMegastructureAddStore.setState({ prompt: { system: SYSTEM, spot: star } });
});

describe("the Add megastructure dialog", () => {
  it("opens on the first family's finished stage, with its stages as tiles and its preview beside them", () => {
    ownSystem(OWNER);
    const html = dialog();

    expect(html).toContain('aria-label="Megastructure family: Dyson Sphere Site"');
    expect(html).toContain('aria-label="Dyson Sphere Site stages"');
    expect(html).toMatch(/aria-selected="false"[^>]*>.*?Dyson Sphere Site<\/span>/);
    expect(html).toMatch(/aria-selected="true"[^>]*>.*?Dyson Sphere<\/span>/);
    expect(html).toContain("<h2>Dyson Sphere</h2>");
    expect(html).toContain("Stage 2 of 2");
    expect(html).toContain("+1000 Energy");
    expect(html).toContain("A fully operational Dyson Sphere - 100% energy generation.");
    expect(html).toContain(WRITTEN_FINISHED);
  });

  it("draws the models in the owner's culture, bare for no owner", () => {
    ownSystem(OWNER);
    expect(dialog()).toContain('src="tex:model:mammalian_01:dyson_sphere_1_entity"');

    ownSystem(null);
    const html = dialog();
    expect(html).toContain('src="tex:model:none:dyson_sphere_1_entity"');
    expect(html).not.toContain("mammalian_01");
  });

  it("shows the megastructure icon for a type with no model", () => {
    useMegastructureAddStore.setState({
      prompt: { system: SYSTEM, spot: { kind: "body", body: 12, star: false } },
    });
    const html = dialog();
    expect(html).toContain("<h2>Science Nexus Site</h2>");
    expect(html).toContain(`src="tex:${MEGASTRUCTURE_ICON_KEY}"`);
    expect(html).not.toContain("Stage ");
  });

  it("says when no type fits the spot, and offers no Add", () => {
    useMegastructureAddStore.setState({
      prompt: { system: SYSTEM, spot: { kind: "space", x: 10, y: 10 } },
    });
    const html = dialog();
    expect(html).toContain("No megastructure the game data defines can go here.");
    expect(html).toContain('type="submit" disabled=""');
  });
});
