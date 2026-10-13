import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// The texture cache cannot fill in a static render, so each picture shows the key it asks for first.
vi.mock("../useTextureUrl", () => ({
  useTextureUrl: (keys: readonly string[]) => `tex:${keys[0]}`,
}));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import type { RingWorldClearing } from "../../generated/RingWorldClearing";
import {
  CLEAR_PLANETS,
  LEAVE_PLANETS,
  OTHER_SIZE,
  QUADRANTS,
  RING_WRITTEN,
  SET_ALL,
} from "../../lib/ringWorldAdd";
import { bindStores } from "../../store/bindStores";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { megastructureTypeView, planetSummary, systemDetails } from "../../test/builders";
import { inSystem } from "../../test/session";
import {
  SYSTEM,
  dialog,
  openAt,
  setUpDialog,
  star,
  type FitsOver,
} from "./addMegastructureFixture";

bindStores();

beforeEach(setUpDialog);

describe("the Add megastructure dialog on a ring world", () => {
  const ringWorld = { place: "unsupported", why: { kind: "ring_world" } } as const;
  const literal = (text: string) => ({
    name: { key: text, literal: true, variables: [] },
    name_key: text,
  });
  const html = (over: FitsOver = {}) => dialog(over).replace(/&#x27;/g, "'");
  const clearing = (over: Partial<RingWorldClearing> = {}): RingWorldClearing => ({
    system: SYSTEM,
    bodies: [5, 4, 2, 3],
    moons: 1,
    colonies: [2],
    belts: 1,
    starbase_bodies: [],
    megastructures: [],
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
      ringSize: null,
      ringClear: false,
      clearing: clearing(),
      clearingError: null,
    });
    openAt(star);
  });

  it("offers the site and the Ring on a star, with a grid of quadrants A to D, all finished", () => {
    const page = html();
    expect(page).toMatch(
      /aria-selected="true"[^>]*><span[^>]*><\/span><span[^>]*><span[^>]*>Ring World<\/span>/,
    );
    expect(page).toMatch(/title="Ring World Site">.*?>Site<\/span>/);
    expect(page).toMatch(/aria-selected="true"[^>]*title="Ring World">.*?>Ring<\/span>/);
    expect(page).not.toContain('aria-disabled="true"');
    for (const quadrant of QUADRANTS) {
      expect(page).toMatch(new RegExp(`aria-label="${quadrant} Finished"[^>]*checked=""`));
      expect(page).toContain(`aria-label="${quadrant} Damaged"`);
    }
    expect(page).not.toContain("Restored");
    expect(page).not.toContain('aria-label="Size"');
    expect(page).toContain(SET_ALL);
    expect(page).not.toContain("quadrants are finished");
    expect(page).toContain(LEAVE_PLANETS);
    expect(page).toContain(CLEAR_PLANETS);
    expect(page).toContain(RING_WRITTEN);
    expect(page).toContain(">Add Ring World</button>");
    expect(page).not.toContain("Clearing deletes");
  });

  it("warns before Add what clearing deletes, colonies by planet name", () => {
    useMegastructureAddStore.setState({ ringClear: true });
    const page = html();
    expect(page).toContain(
      "Clearing deletes 3 planets, 1 moon and 1 belt, and the colony on Lachium I.",
    );
    expect(page.indexOf("Clearing deletes")).toBeLessThan(page.indexOf(">Add Ring World</button>"));
    expect(page).not.toContain('type="submit" class="primary" disabled=""');
  });

  it("names the megastructure on a planet clearing deletes", () => {
    useMegastructureAddStore.setState({
      ringClear: true,
      clearing: clearing({ megastructures: [{ id: 7, body: 3 }] }),
    });
    expect(html()).toContain(
      "Clearing deletes 3 planets, 1 moon and 1 belt, and the colony on Lachium I and the megastructure on Lachium II.",
    );
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
    expect(page).toContain('type="submit" class="primary" disabled=""');
  });

  it("greys out the Ring with the reason the shell refuses its ring world", () => {
    const refusal =
      "Galaxy Forge can't build Ring World Frame from the game data: it lays out no ring.";
    const page = html({ ring_world_2_intermediate: { refusal } });
    expect(page).toContain(
      "Galaxy Forge can't build Ring World Frame from the game data: it lays out no ring.",
    );
    expect(page).toContain('aria-disabled="true"');
    expect(page).not.toContain(SET_ALL);
    expect(page).toContain(">Add Ring World Site</button>");
  });

  describe("with Gigastructural Engineering's titanic ring", () => {
    const giga = { source: "Gigastructural Engineering", base_game: false } as const;

    beforeEach(() => {
      const types = new Map(useGameDataStore.getState().megastructureTypes);
      const frame = types.get("ring_world_2_intermediate")!;
      types.set(frame.key, { ...frame, ring_world_radius: 45 });
      for (const type of [
        megastructureTypeView("ringworld_titanic_0", {
          ...giga,
          placement: { place: "body", star_only: true },
        }),
        megastructureTypeView("ringworld_titanic_1", {
          ...giga,
          upgrade_from: ["ringworld_titanic_0"],
          placement: ringWorld,
          ring_world_radius: 90,
          ring_world_refused_stages: ["damaged", "restored"],
        }),
      ]) {
        types.set(type.key, type);
      }
      useGameDataStore.setState({
        megastructureTypes: types,
        names: new Map([
          ...useGameDataStore.getState().names,
          ["ringworld_titanic_0", "Titanic Ringworld Site"],
          ["ringworld_titanic_1", "Titanic Ringworld Frame"],
        ]),
      });
    });

    /** The picks area under the Size row, which keeps one height whatever it shows. */
    const picksArea = (page: string) => {
      const start = page.indexOf('<div class="ring-world-picks-area');
      expect(start).toBeGreaterThan(-1);
      return page.slice(start, page.indexOf('<aside class="megastructure-add-preview', start));
    };
    const sizeFirst = (page: string) =>
      page.indexOf('class="ring-world-picks"') < page.indexOf('aria-label="Size"') &&
      page.indexOf('aria-label="Size"') < page.indexOf("ring-world-picks-area");

    const checked = (page: string, label: string) =>
      new RegExp(`<input type="radio" name="ring-size" checked=""/><span>${label}</span>`).test(
        page,
      );

    it("offers the sizes beside the grid, the base game's ring first, its stage columns all four", () => {
      const page = html();
      expect(page).toContain('aria-label="Size"');
      expect(checked(page, "Ring World")).toBe(true);
      expect(page).toContain("<span>Titanic</span>");
      expect(page).toContain('aria-label="A Damaged"');
      expect(page).toContain(">Add Ring World</button>");
    });

    it("adds the titanic ring once picked, with no Damaged column, and its site from the Site tile", () => {
      useMegastructureAddStore.setState({ ringSize: "ringworld_titanic_1" });
      const page = html();
      expect(checked(page, "Titanic")).toBe(true);
      expect(page).toContain('aria-label="A Ruined"');
      expect(page).not.toContain("Damaged");
      expect(page).toContain(">Add Titanic Ringworld</button>");
      expect(page).toMatch(/title="Titanic Ringworld Site">.*?>Site<\/span>/);
    });

    it("greys out the Ring at a size the shell refuses, and keeps the sizes to pick another", () => {
      const overlap = {
        ring_world_2_intermediate: {
          refusal: "This ring would overlap the ring world at orbit 45.",
        },
      };
      const refused = "This ring would overlap the ring world at orbit 45.";
      const page = html(overlap);
      expect(page).toContain('aria-label="Size"');
      expect(page).toContain(`aria-disabled="true" title="${refused}"`);
      expect(page).toContain(">Add Ring World Site</button>");
      const area = picksArea(page);
      expect(area).toContain("ring-world-picks-refused");
      expect(area).toContain(`<p class="megastructure-add-refusal">${refused}</p>`);
      expect(area).toContain(OTHER_SIZE);
      expect(area).not.toContain("ring-world-quadrants");
      expect(page).not.toContain(SET_ALL);
      expect(sizeFirst(page)).toBe(true);

      useMegastructureAddStore.setState({ ringSize: "ringworld_titanic_1" });
      const titanic = html(overlap);
      expect(titanic).not.toContain(refused);
      expect(picksArea(titanic)).toContain("ring-world-quadrants");
      expect(titanic).toContain(SET_ALL);
      expect(sizeFirst(titanic)).toBe(true);
      expect(titanic).not.toContain('type="submit" class="primary" disabled=""');
    });
  });
});
