import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// The texture cache cannot fill in a static render, so each picture shows the key it asks for first.
vi.mock("../useTextureUrl", () => ({
  useTextureUrl: (keys: readonly string[]) => `tex:${keys[0]}`,
}));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import {
  HABITAT_ORBITAL_HOST_TAKEN,
  HABITAT_ORBITAL_OWNER_NOTE,
  HABITAT_OWNER_NOTE,
  habitatOrbitalNote,
  writtenAsHabitat,
} from "../../lib/megastructureCopy";
import type { MegastructureSpot } from "../../lib/megastructurePicks";
import { bindStores } from "../../store/bindStores";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { megastructureSummary, megastructureTypeView, systemDetails } from "../../test/builders";
import { inSystem } from "../../test/session";
import { OWNER, SYSTEM, dialog, openAt, ownSystem, setUpDialog } from "./addMegastructureFixture";

bindStores();

beforeEach(setUpDialog);

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
