import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import type { BodySpawn } from "../../../generated/BodySpawn";
import { bindStores } from "../../../store/bindStores";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { useNameFormatsStore } from "../../../store/nameFormatsStore";
import { bodyLayout, name } from "../../../test/builders";
import { bodySpawn, systemSpawn } from "../../../test/spawn";
import { details, land, open, overview, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { PlanetView } from "./PlanetView";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
  useNameFormatsStore.setState({ formats: new Map() });
});

const page = (id: number, label: string) => {
  const entry: Entry = { ref: { kind: "body", system: SYSTEM, id }, label };
  useInspectorStore.setState({ tab: "overview" });
  return renderToStaticMarkup(<PlanetView entry={entry} />);
};

/** The value of the row labelled `label`, and what follows it up to the next row. */
function row(html: string, label: string): string {
  const start = html.indexOf(`<span class="k">${label}</span>`);
  expect(start, `a ${label} row`).toBeGreaterThan(-1);
  const rest = html.slice(start + label.length + 22);
  const next = rest.indexOf('<span class="k">');
  return next === -1 ? rest : rest.slice(0, next);
}

/** Names system `SYSTEM` as the map does. */
function nameSystem(key: string): void {
  const systems = new Map(useGalaxyStore.getState().systems);
  const system = systems.get(SYSTEM);
  if (system === undefined) throw new Error("the fixture's system is missing");
  systems.set(SYSTEM, { ...system, name: { ...name(key), literal: true } });
  useGalaxyStore.setState({ systems });
}

/** A planet drawn from the classes that fit its orbit, named by the game. */
function drawn(id: number, over: Partial<BodySpawn> = {}) {
  return planet(id, "", {
    class: "random",
    drawn: true,
    size: null,
    ring: null,
    spawn: bodySpawn({
      class: {
        state: "rolled",
        pool: {
          kind: "random",
          draw: "random",
          at_orbit: [
            { class: "pc_toxic", weight: 1 },
            { class: "pc_barren", weight: 3 },
          ],
        },
      },
      ...over,
    }),
  });
}

describe("what a scenario body can roll", () => {
  it("lists the classes that fit its orbit with their odds, and a list's members with what the game may do", async () => {
    const listed = planet(101, "Listed", {
      class: "rl_cold",
      drawn: true,
      spawn: bodySpawn({
        class: {
          state: "rolled",
          pool: {
            kind: "planet_list",
            list: "rl_cold",
            members: [
              { key: "pc_arctic", weight: null },
              { key: "pc_tundra", weight: null },
            ],
          },
        },
      }),
    });
    const fixedOrbit = { ...drawn(100), layout: bodyLayout({ orbit: { min: 95, max: 95 } }) };
    await open("scenario");
    await land(details({ planets: [fixedOrbit, listed], spawn: systemSpawn() }));

    const cls = row(page(100, "Planet"), "Class");
    expect(cls).toContain("Rolled from the classes that fit its orbit");
    expect(cls).toMatch(/barren\S* 75% · \S*toxic\S* 25%/i);
    expect(cls).not.toContain("depends on");
    const list = row(page(101, "Listed"), "Class");
    expect(list).toContain("One of 2, from rl_cold");
    expect(list).toContain("The game may roll any of these, whether or not it fits the orbit.");
  });

  it("lists the classes without odds where the orbit is a range or the star is rolled", async () => {
    const ranged = { ...drawn(100), layout: bodyLayout({ orbit: { min: 90, max: 140 } }) };
    const fixedOrbit = { ...drawn(101), layout: bodyLayout({ orbit: { min: 95, max: 95 } }) };
    const listedStar = systemSpawn({
      star: { state: "rolled", list: "rl_pair", members: [{ key: "sc_g", weight: 1 }] },
    });
    await open("scenario");
    await land(details({ planets: [ranged, fixedOrbit], spawn: listedStar }));

    const wide = row(page(100, "Planet"), "Class");
    expect(wide).toMatch(/barren\S* · \S*toxic/i);
    expect(wide).not.toContain("%");
    expect(wide).toContain(
      "Which of these it can be depends on where it lands and on the star the system rolls.",
    );
    expect(row(page(101, "Planet"), "Class")).toContain(
      "Which of these it can be depends on the star the system rolls.",
    );
  });

  it("marks a body the game never places on its page and its row, and the moons around it", async () => {
    const never = drawn(100, { orbit_fit: "never" });
    const moon = planet(101, "", {
      class: "random",
      moon: true,
      parent: 100,
      spawn: bodySpawn({ orbit_fit: "never" }),
    });
    await open("scenario");
    await land(details({ planets: [never, moon], spawn: systemSpawn() }));

    const html = page(100, "Planet");
    const head = html.slice(0, html.indexOf("</div>"));
    expect(head).toContain('<span class="ins-block-count ins-never">never placed</span>');
    expect(html).toContain(
      "The game never places this planet. None of the classes it can roll fit its orbit.",
    );
    expect(page(101, "Moon")).toContain(
      "The game never places this moon, because it never places the body it orbits.",
    );
    expect(overview()).toContain(">never placed</span>");
  });

  it("says some games lack a body whose orbit no class fits around some stars", async () => {
    await open("scenario");
    await land(
      details({ planets: [drawn(100, { orbit_fit: "sometimes" })], spawn: systemSpawn() }),
    );

    expect(page(100, "Planet")).toContain(
      "Some games have this planet and some don&#x27;t. At some of the orbits it can land at, none of the classes it can roll fit.",
    );
    expect(overview()).toContain('class="ins-block-count ins-st-rolled"');
  });

  it("lists the deposits and features it can also roll, likeliest first with their chances", async () => {
    const world = drawn(100, {
      rolled_deposits: {
        state: "rolled",
        entries: [
          { key: "d_energy_1", chance: 0.25 },
          { key: "d_minerals_1", chance: 0.75 },
        ],
      },
      rolled_features: {
        state: "rolled",
        entries: [
          { key: "pm_carbon_world", chance: null },
          { key: "pm_mineral_poor", chance: 0.5 },
        ],
      },
    });
    await open("scenario");
    await land(details({ planets: [world], spawn: systemSpawn() }));

    const html = page(100, "Planet");
    expect(html).toContain("Can roll · 2");
    expect(html).toMatch(/Minerals 1 75% ·<\/span><span[^>]*>Energy 1 25%/);
    expect(html).toContain("Can roll · planet features");
    expect(html).toMatch(/Mineral Poor 50% ·<\/span><span>Carbon World</);
  });

  it("shows nothing more for a pool the initializer stops, and why for one the class decides", async () => {
    const fixed = drawn(100, {
      rolled_deposits: { state: "fixed" },
      rolled_features: { state: "fixed" },
    });
    const unknown = drawn(101, {
      rolled_deposits: { state: "unknown" },
      rolled_features: { state: "unknown" },
    });
    await open("scenario");
    await land(details({ planets: [fixed, unknown], spawn: systemSpawn() }));

    const plain = page(100, "Planet");
    expect(plain).not.toContain("Can roll");
    expect(plain).not.toContain("Deposits");
    const html = page(101, "Planet");
    expect(html).toContain('<span class="ins-st-unknown">Decided by the class it rolls</span>');
    expect(html).toContain("The game rolls deposits for the class it picks.");
    expect(html).toContain("The game rolls planet features for the class it picks.");
  });

  it("gives a rolled ring its chance", async () => {
    await open("scenario");
    await land(
      details({
        planets: [drawn(100, { ring: { state: "rolled", chance: 0.12 } })],
        spawn: systemSpawn(),
      }),
    );

    expect(row(page(100, "Planet"), "Ring")).toContain(
      '<span class="ins-st-rolled" title="Rolled when the game starts">12% chance</span>',
    );
  });

  it("names a body after the system, its numeral rolled where bodies before it may not spawn", async () => {
    const second = drawn(100, {
      naming: {
        state: "template",
        format: "PLANET_NAME_FORMAT",
        parent: null,
        numerals: ["II", "III"],
      },
    });
    const moon = planet(101, "", {
      class: "random",
      moon: true,
      parent: 100,
      spawn: bodySpawn({
        naming: {
          state: "template",
          format: "SUBPLANET_NAME_FORMAT",
          parent: 100,
          numerals: ["a"],
        },
      }),
    });
    await open("scenario");
    nameSystem("Yunak");
    await land(details({ planets: [second, moon], spawn: systemSpawn() }));

    const html = page(100, "Yunak II");
    expect(html).toContain('<span class="name">Yunak II</span>');
    expect(row(html, "Name")).toContain(
      '<span class="ins-st-rolled" title="Rolled when the game starts">Yunak II</span>',
    );
    expect(row(html, "Name")).toContain(
      "The game numbers planets in order, so this one is Yunak II or Yunak III, depending on how many before it are placed.",
    );
    expect(page(101, "Yunak IIa")).toContain('<span class="name">Yunak IIa</span>');
    expect(overview()).toContain("Yunak II</span>");
  });

  it("says a body is named after a system that has no name yet", async () => {
    const first = drawn(100, {
      naming: { state: "template", format: "PLANET_NAME_FORMAT", parent: null, numerals: ["I"] },
    });
    await open("scenario");
    nameSystem("");
    await land(details({ planets: [first], spawn: systemSpawn() }));

    const html = page(100, "Planet");
    expect(row(html, "Name")).toContain("Named after the system");
    expect(html).toContain("Stellaris picks the system&#x27;s name when the game starts.");
  });

  it("says a moon is named after its planet when the planet's name can't be told", async () => {
    const asteroid = planet(100, "", {
      class: "pc_asteroid",
      spawn: bodySpawn({ naming: { state: "unknown" } }),
    });
    const moon = planet(101, "", {
      class: "random",
      moon: true,
      parent: 100,
      spawn: bodySpawn({
        naming: {
          state: "template",
          format: "SUBPLANET_NAME_FORMAT",
          parent: 100,
          numerals: ["a"],
        },
      }),
    });
    await open("scenario");
    nameSystem("Yunak");
    await land(details({ planets: [asteroid, moon], spawn: systemSpawn() }));

    const html = page(101, "Moon");
    expect(row(html, "Name")).toContain("Named after the planet it orbits");
    expect(html).toContain("That planet&#x27;s name isn&#x27;t known until the game starts.");
    expect(html).not.toContain("Named after the system");
  });

  it("fills a star's name format as the install writes it", async () => {
    useNameFormatsStore.setState({ formats: new Map([["STAR_NAME_1_OF_2", "$NAME$ Prime"]]) });
    const star = planet(99, "", {
      class: "pc_g_star",
      star_class: "sc_g",
      role: "primary",
      spawn: bodySpawn({
        naming: { state: "template", format: "STAR_NAME_1_OF_2", parent: null, numerals: [] },
      }),
    });
    await open("scenario");
    nameSystem("Yunak $& Co");
    await land(details({ planets: [star], spawn: systemSpawn() }));

    expect(page(99, "Star")).toContain('<span class="name">Yunak $&amp; Co Prime</span>');
  });
});

describe("a scenario system's radii", () => {
  it("shows an inner radius with an offset it leaves out as unknown, and says why", async () => {
    await open("scenario");
    await land(
      details({
        planets: [planet(100, "World", { spawn: bodySpawn() })],
        spawn: systemSpawn({ inner_radius: { min: 150, max: 380 }, inner_radius_offset: 40 }),
      }),
    );

    const html = overview();
    expect(html).toContain('<span class="ins-st-unknown">150 to 380</span>');
    expect(html).toContain(
      "The initializer also sets an offset of 40 for the inner radius. This range doesn&#x27;t count it in, because no game file says how the game uses it.",
    );
  });

  it("shows the inner radius and a drawn belt's radius as ranges", async () => {
    await open("scenario");
    await land(
      details({
        planets: [planet(100, "World", { spawn: bodySpawn() })],
        belts: [{ kind: "rocky_asteroid_belt", inner_radius: 130 }],
        spawn: systemSpawn({
          inner_radius: { min: 150, max: 380 },
          belt_radii: [{ min: 120, max: 140 }],
        }),
      }),
    );

    const html = overview();
    expect(html).toContain("Inner radius");
    expect(html).toContain('title="Rolled when the game starts">150 to 380</span>');
    expect(html).toContain('title="Rolled when the game starts">120 to 140</span>');
  });
});

/** A copy of a three-copy block named after the system, its orbit fit as given. */
function copyOf(id: number, copy: number, fit: BodySpawn["orbit_fit"], numerals: string[]) {
  return drawn(id, {
    copy,
    count: { min: 3, max: 3 },
    orbit_fit: fit,
    naming:
      fit === "never"
        ? undefined
        : { state: "template", format: "PLANET_NAME_FORMAT", parent: null, numerals },
  });
}

describe("a block of copies in the Planets list", () => {
  it("is one row whose count runs from the copies that always fit to those that can, titled with their names", async () => {
    await open("scenario");
    nameSystem("Yunak");
    await land(
      details({
        planets: [
          copyOf(100, 1, "always", ["I"]),
          copyOf(101, 2, "sometimes", ["II"]),
          copyOf(102, 3, "sometimes", ["II", "III"]),
        ],
        spawn: systemSpawn(),
      }),
    );

    const html = overview();
    expect(html.match(/ins-block-count/g)).toHaveLength(1);
    expect(html).toContain('class="ins-block-count ins-st-rolled"');
    expect(html).toContain(">1 to 3</span>");
    expect(html).not.toContain("×3");
    expect(html).toContain("Yunak I to III</span>");
    expect(html).toContain(">any class</span>");
  });

  it("is marked never placed only when no copy can be placed", async () => {
    await open("scenario");
    await land(
      details({
        planets: [
          copyOf(100, 1, "always", ["I"]),
          copyOf(101, 2, "never", []),
          copyOf(102, 3, "never", []),
        ],
        spawn: systemSpawn(),
      }),
    );
    const some = overview();
    expect(some).not.toContain("never placed");
    expect(some).not.toContain("ins-block-count");

    resetStores();
    await open("scenario");
    await land(
      details({
        planets: [
          copyOf(100, 1, "never", []),
          copyOf(101, 2, "never", []),
          copyOf(102, 3, "never", []),
        ],
        spawn: systemSpawn(),
      }),
    );
    const none = overview();
    expect(none.match(/never placed/g)).toHaveLength(1);
  });
});
