import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { bindStores } from "../../../store/bindStores";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useDetailsStore } from "../../../store/detailsStore";
import { drawnBy } from "../../../test/drawn";
import { hintOf } from "../../../test/hints";
import { mockedIpc } from "../../../test/ipc";
import { classRows } from "../../../test/poolRows";
import { rolledBody, systemRoll } from "../../../test/rolls";
import { useNameFormatsStore } from "../../../store/nameFormatsStore";
import { bodyLayout } from "../../../test/builders";
import { bodySpawn, systemSpawn } from "../../../test/spawn";
import {
  DIE,
  details,
  land,
  nameSystem,
  open,
  overview,
  page,
  planet,
  randomPlanet,
  resetStores,
  rolled,
  row,
  SYSTEM,
} from "../inspectorFixture";
import { Rolled } from "../states";

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
    const fixedOrbit = {
      ...randomPlanet(100),
      layout: bodyLayout({ orbit: { min: 95, max: 95 } }),
    };
    await open("scenario");
    await land(details({ planets: [fixedOrbit, listed], spawn: systemSpawn() }));

    const cls = row(
      drawnBy(() => page(100, "Planet")),
      "Class",
    );
    expect(cls).toContain(">Random class</span>");
    expect(hintOf("Class")).toContain("Rolled from the classes that fit its orbit.");
    const odds = classRows(cls).map((r) => [r.name.toLowerCase(), r.width, r.chance]);
    expect(odds).toEqual([
      [expect.stringContaining("barren"), "100.0%", "75%"],
      [expect.stringContaining("toxic"), "33.3%", "25%"],
    ]);
    const list = row(
      drawnBy(() => page(101, "Listed")),
      "Class",
    );
    expect(list).toContain("One of 2 classes");
    expect(list).not.toContain("rl_cold");
    expect(hintOf("Class")).toBe(
      '<span class="ins-set-by">From the game&#x27;s class list rl_cold.</span><span class="ins-set-by">The game may roll any class in this list, even one that doesn&#x27;t fit the orbit.</span>',
    );
  });

  it("lists classes that show under one name as one row, which picks none of them", async () => {
    const listed = planet(101, "Listed", {
      class: "rl_barren",
      drawn: true,
      spawn: bodySpawn({
        class: {
          state: "rolled",
          pool: {
            kind: "planet_list",
            list: "rl_barren",
            members: [
              { key: "pc_barren", weight: null },
              { key: "pc_barren_cold", weight: null },
              { key: "pc_frozen", weight: null },
              { key: "pc_toxic", weight: null },
            ],
          },
        },
      }),
    });
    await open("scenario");
    useGameDataStore.setState({
      names: new Map([
        ["pc_barren", "Barren World"],
        ["pc_barren_cold", "Barren World"],
        ["pc_frozen", "Frozen World"],
        ["pc_toxic", "Toxic World"],
      ]),
    });
    await land(details({ planets: [listed], spawn: systemSpawn() }));

    const rows = classRows(row(page(101, "Listed"), "Class"));
    expect(rows.map((r) => [r.name, /aria-pressed/.test(r.html)])).toEqual([
      ["Barren World", false],
      ["Frozen World", true],
      ["Toxic World", true],
    ]);
  });

  it("lists the classes without odds where the orbit is a range or the star is rolled", async () => {
    const ranged = { ...randomPlanet(100), layout: bodyLayout({ orbit: { min: 90, max: 140 } }) };
    const fixedOrbit = {
      ...randomPlanet(101),
      layout: bodyLayout({ orbit: { min: 95, max: 95 } }),
    };
    const listedStar = systemSpawn({
      star: { state: "rolled", list: "rl_pair", members: [{ key: "sc_g", weight: 1 }] },
    });
    await open("scenario");
    await land(details({ planets: [ranged, fixedOrbit], spawn: listedStar }));

    const wide = row(
      drawnBy(() => page(100, "Planet")),
      "Class",
    );
    expect(hintOf("Class")).toBe(
      '<span class="ins-set-by">Rolled from the classes that fit its orbit.</span>' +
        '<span class="ins-set-by">Which of these it can be depends on its orbit and on the system&#x27;s star.</span>',
    );
    const listed = classRows(wide);
    expect(listed.map((r) => r.name.toLowerCase())).toEqual([
      expect.stringContaining("barren"),
      expect.stringContaining("toxic"),
    ]);
    expect(listed.every((r) => r.cell === "" && r.chance === "")).toBe(true);
    expect(listed.every((r) => r.icon.includes('class="pi'))).toBe(true);
    drawnBy(() => page(101, "Planet"));
    expect(hintOf("Class")).toBe(
      '<span class="ins-set-by">Rolled from the classes that fit its orbit.</span>' +
        '<span class="ins-set-by">Which of these it can be depends on the system&#x27;s star.</span>',
    );
  });

  it("marks a body the game never places on its page and its row, and the moons around it", async () => {
    const never = randomPlanet(100, { orbit_fit: "never" });
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
    expect(overview().match(/>never placed<\/span>/g)).toHaveLength(2);
  });

  it("says some games lack a body whose orbit no class fits around some stars", async () => {
    await open("scenario");
    await land(
      details({ planets: [randomPlanet(100, { orbit_fit: "sometimes" })], spawn: systemSpawn() }),
    );

    expect(drawnBy(() => page(100, "Planet"))).toContain(">Not in every game</span>");
    expect(hintOf("Copies")).toBe(
      "Some games have this planet and some don&#x27;t. At some of the orbits it can land at, none of the classes it can roll fit.",
    );
    expect(drawnBy(overview)).toContain(
      `<span class="ins-block-count ins-st-rolled">${DIE}0 to 1</span>`,
    );
    expect(hintOf("Copies")).toBe("Some games have this planet and some don&#x27;t.");
  });

  it("names a body after the system, its numeral rolled where bodies before it may not spawn", async () => {
    const second = randomPlanet(100, {
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

    const html = drawnBy(() => page(100, "Yunak II"));
    expect(html).toContain('<span class="name">Yunak II</span>');
    expect(row(html, "Name")).toContain(rolled("Yunak II"));
    expect(hintOf("Name")).toBe(
      "The game numbers planets in order, so this one is Yunak II or Yunak III, depending on how many before it are placed.",
    );
    expect(page(101, "Yunak IIa")).toContain('<span class="name">Yunak IIa</span>');
    expect(overview()).toContain(`<span class="l1">${rolled("Yunak II to III")}</span>`);
  });

  it("says a body is named after a system that has no name yet", async () => {
    const first = randomPlanet(100, {
      naming: { state: "template", format: "PLANET_NAME_FORMAT", parent: null, numerals: ["I"] },
    });
    await open("scenario");
    nameSystem("");
    await land(details({ planets: [first], spawn: systemSpawn() }));

    const html = drawnBy(() => page(100, "Planet"));
    expect(row(html, "Name")).toContain("Named after the system");
    expect(hintOf("Name")).toBe("The game picks the system&#x27;s name when a new game starts.");
  });

  it("says a moon is named after its planet when the planet's name can't be told", async () => {
    const asteroid = planet(100, "", {
      class: "pc_barren",
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

    const html = drawnBy(() => page(101, "Moon"));
    expect(row(html, "Name")).toContain("Named after the planet it orbits");
    expect(hintOf("Name")).toBe(
      "That planet&#x27;s name isn&#x27;t known until a new game starts.",
    );
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

/** A moon of planet 100, the given copy of a block of one to four, named with `numerals`. */
function moonCopy(id: number, copy: number, numerals: string[]) {
  return planet(id, "", {
    class: "random",
    moon: true,
    parent: 100,
    spawn: bodySpawn({
      always: copy === 1,
      copy,
      count: { min: 1, max: 4 },
      naming: { state: "template", format: "SUBPLANET_NAME_FORMAT", parent: 100, numerals },
    }),
  });
}

describe("a scenario body's name in lists and links", () => {
  it("numbers the copies of a moon block in order, since each is there only when the one before it is", async () => {
    const riadore = randomPlanet(100, {
      naming: { state: "template", format: "PLANET_NAME_FORMAT", parent: null, numerals: ["I"] },
    });
    await open("scenario");
    nameSystem("Riadore");
    await land(
      details({
        planets: [
          riadore,
          moonCopy(101, 1, ["a"]),
          moonCopy(102, 2, ["b"]),
          moonCopy(103, 3, ["b", "c"]),
          moonCopy(104, 4, ["b", "c", "d"]),
        ],
        spawn: systemSpawn(),
      }),
    );

    const html = page(100, "Riadore I");
    const moons = html.slice(html.indexOf("Moons"));
    for (const name of ["Riadore Ia", "Riadore Ib", "Riadore Ic", "Riadore Id"]) {
      expect(moons.split(`<span class="l1">${name}</span>`)).toHaveLength(2);
    }
  });

  it("shows a body whose numeral can vary by the span of its names on a row, and by its first name in the Orbits link", async () => {
    const riadore = randomPlanet(100, {
      naming: {
        state: "template",
        format: "PLANET_NAME_FORMAT",
        parent: null,
        numerals: ["I", "II"],
      },
    });
    const moon = moonCopy(101, 1, ["a"]);
    const third = moonCopy(102, 2, ["b", "c"]);
    await open("scenario");
    nameSystem("Riadore");
    await land(details({ planets: [riadore, moon, third], spawn: systemSpawn() }));

    expect(page(100, "Riadore I")).toContain(
      `<span class="l1">${rolled("Riadore Ia to IIa")}</span>`,
    );
    expect(row(page(101, "Riadore Ia"), "Orbits")).toContain(rolled("Riadore I"));
    expect(page(100, "Riadore I")).toContain(
      `<span class="l1">${rolled("Riadore Ib to IIc")}</span>`,
    );
  });

  it("names the body an angle turns from by its given name", async () => {
    const first = planet(100, "", {
      class: "pc_gas_giant",
      layout: bodyLayout({ orbit: { min: 55, max: 55 }, angle_step: { min: 70, max: 70 } }),
      spawn: bodySpawn({
        class: { state: "fixed", class: "pc_gas_giant" },
        naming: { state: "template", format: "PLANET_NAME_FORMAT", parent: null, numerals: ["I"] },
      }),
    });
    const second = planet(101, "", {
      class: "pc_barren",
      layout: bodyLayout({
        orbit: { min: 175, max: 175 },
        orbit_step: { min: 120, max: 120 },
        angle_step: { min: 90, max: 270 },
        turns_from: 100,
      }),
      spawn: bodySpawn({
        naming: { state: "template", format: "PLANET_NAME_FORMAT", parent: null, numerals: ["II"] },
      }),
    });
    mockedIpc.getSystemRoll.mockResolvedValue(
      systemRoll({
        system: SYSTEM,
        bodies: [
          rolledBody({ id: 100, orbit: 55, angle: 10 }),
          rolledBody({ id: 101, orbit: 175, angle: 200, from: 10 }),
        ],
      }),
    );
    await open("scenario");
    nameSystem("Riadore");
    await land(details({ planets: [first, second], spawn: systemSpawn() }));
    useDetailsStore.getState().requestRoll(SYSTEM, 0);
    await vi.advanceTimersByTimeAsync(0);

    const angle = row(page(101, "Riadore II"), "Angle step");
    expect(angle).toContain("Riadore I");
    expect(angle).toContain(" (orbit 55)");
    expect(angle).not.toContain("Gas Giant");
  });
});

describe("the rolled look", () => {
  it("leads a rolled value with a die that says on hover what it means", () => {
    expect(DIE).toContain('title="Rolled when a new game starts"');
    expect(renderToStaticMarkup(<Rolled>2 to 10</Rolled>)).toBe(rolled("2 to 10"));
  });
});
