import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// The texture cache cannot fill in a static render, so each picture shows the key it asks for first.
vi.mock("../useTextureUrl", () => ({
  useTextureUrl: (keys: readonly string[]) => `tex:${keys[0]}`,
}));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import type { HostMoonsFit } from "../../generated/HostMoonsFit";
import { HOST_MOONS_LABEL } from "../../lib/hostMoonsAdd";
import { bindStores } from "../../store/bindStores";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { megastructureTypeView } from "../../test/builders";
import { dialog, openAt, setUpDialog } from "./addMegastructureFixture";

bindStores();

beforeEach(setUpDialog);

describe("the Add megastructure dialog for a type that removes its planet's moons", () => {
  const SHIPYARD = "giga_equatorial_shipyard_3";
  const withMoons = (host_moons: HostMoonsFit) => dialog({ [SHIPYARD]: { host_moons } });

  beforeEach(() => {
    const shipyard = megastructureTypeView(SHIPYARD, {
      host_planet: true,
      removes_host_moons: true,
    });
    const data = useGameDataStore.getState();
    useGameDataStore.setState({
      megastructureTypes: new Map([[shipyard.key, shipyard]]),
      names: new Map([...data.names, [SHIPYARD, "Equatorial Shipyard"]]),
    });
    openAt({ kind: "body", body: 6, star: false, class: "pc_molten" });
  });

  it("offers to remove the moons as the game does, picked on opening, or keep them", () => {
    const html = withMoons({ kind: "removable", count: 3 });
    expect(html).toContain(HOST_MOONS_LABEL);
    expect(html).toMatch(
      /<input type="radio" name="megastructure-moons" checked=""\/><span>Remove its 3 moons, as the game does<\/span>/,
    );
    expect(html).toMatch(
      /<input type="radio" name="megastructure-moons"\/><span>Keep its moons<\/span>/,
    );
    expect(withMoons({ kind: "removable", count: 1 })).toContain(
      "Remove its moon, as the game does",
    );
  });

  it("picks Keep once the player keeps them for the type", () => {
    useMegastructureAddStore.setState({ keepMoonsOf: SHIPYARD });
    expect(withMoons({ kind: "removable", count: 3 })).toMatch(
      /<input type="radio" name="megastructure-moons" checked=""\/><span>Keep its moons<\/span>/,
    );
  });

  it("picks Keep and turns Remove off with the reason where the save refuses to remove them", () => {
    const html = withMoons({ kind: "refused", reason: "a moon of it holds a colony" });
    expect(html).toMatch(
      /<input type="radio" disabled="" name="megastructure-moons"\/><span>Remove its moons, as the game does<\/span>/,
    );
    expect(html).toMatch(
      /<input type="radio" name="megastructure-moons" checked=""\/><span>Keep its moons<\/span>/,
    );
    expect(html).toContain("A moon of it holds a colony.");
  });

  it("shows no moons choice on a planet with no moons, or for a type that keeps them", () => {
    expect(withMoons({ kind: "kept" })).not.toContain('name="megastructure-moons"');
    const nexus = megastructureTypeView("think_tank_3");
    useGameDataStore.setState({ megastructureTypes: new Map([[nexus.key, nexus]]) });
    expect(dialog({ think_tank_3: { host_moons: { kind: "removable", count: 3 } } })).not.toContain(
      'name="megastructure-moons"',
    );
  });
});
