import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// The texture cache cannot fill in a static render, so each picture shows the key it asks for first.
vi.mock("../useTextureUrl", () => ({
  useTextureUrl: (keys: readonly string[]) => `tex:${keys[0]}`,
}));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import type { MegastructureSpot } from "../../lib/megastructurePicks";
import { PLANET_CHANGE_LABEL, PLANET_KEPT_NOTE } from "../../lib/planetChangeAdd";
import { bindStores } from "../../store/bindStores";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { megastructureTypeView } from "../../test/builders";
import { dialog, openAt, setUpDialog } from "./addMegastructureFixture";

bindStores();

beforeEach(setUpDialog);

describe("the Add megastructure dialog for a type that changes its planet", () => {
  const gasGiant: MegastructureSpot = { kind: "body", body: 6, star: false, class: "pc_gas_giant" };

  beforeEach(() => {
    const orchid = megastructureTypeView("yggdrasil_orchid_3", {
      planet_change: { class: "pc_food_giant", size: null },
    });
    const data = useGameDataStore.getState();
    useGameDataStore.setState({
      megastructureTypes: new Map([[orchid.key, orchid]]),
      names: new Map([
        ...data.names,
        ["yggdrasil_orchid_3", "Orchid Project"],
        ["pc_gas_giant", "Gas Giant"],
        ["pc_food_giant", "Food Giant"],
      ]),
    });
    openAt(gasGiant);
  });

  it("offers to change the planet as the game does, picked on opening, or keep its class", () => {
    const html = dialog();
    expect(html).toContain(PLANET_CHANGE_LABEL);
    expect(html).toMatch(
      /<input type="radio" name="megastructure-planet" checked=""\/><span>Change to Food Giant, as in the game<\/span>/,
    );
    expect(html).toMatch(
      /<input type="radio" name="megastructure-planet"\/><span>Keep Gas Giant<\/span>/,
    );
    expect(html).toContain("becomes a Food Giant.");
  });

  it("says the planet keeps its class once Keep is picked", () => {
    useMegastructureAddStore.setState({ keepPlanet: true });
    const html = dialog();
    expect(html).toMatch(
      /<input type="radio" name="megastructure-planet" checked=""\/><span>Keep Gas Giant<\/span>/,
    );
    expect(html).toContain(PLANET_KEPT_NOTE);
    expect(html).not.toContain("becomes a Food Giant.");
  });

  it("shows no planet choice for a type that leaves its planet alone", () => {
    const nexus = megastructureTypeView("think_tank_3");
    useGameDataStore.setState({ megastructureTypes: new Map([[nexus.key, nexus]]) });
    expect(dialog()).not.toContain('name="megastructure-planet"');
  });
});
