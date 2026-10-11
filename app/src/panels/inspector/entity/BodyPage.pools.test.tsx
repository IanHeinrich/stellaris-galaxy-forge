import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import type { BodySpawn } from "../../../generated/BodySpawn";
import { depositBars } from "../../../lib/details/depositBars";
import { oddsRows, readableTint, starListName } from "../../../lib/details/oddsBars";
import { NEUTRAL_RAMP } from "../../../lib/details/resourceColors";
import { starGlyph } from "../../../lib/visual/starGlyphs";
import { bindStores } from "../../../store/bindStores";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useDetailsStore } from "../../../store/detailsStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { drawnBy } from "../../../test/drawn";
import { openGroups } from "../../../test/groups";
import { hintOf } from "../../../test/hints";
import { mockedIpc } from "../../../test/ipc";
import { poolChips, poolRows } from "../../../test/poolRows";
import { rolledBody, systemRoll } from "../../../test/rolls";
import { useNameFormatsStore } from "../../../store/nameFormatsStore";
import { depositTypeView, resourceAmount } from "../../../store/fixtures/planet";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { bodyLayout, name } from "../../../test/builders";
import { bodySpawn, systemSpawn } from "../../../test/spawn";
import { details, land, open, overview, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { Rolled, RolledMark } from "../states";
import { BarLineView, DepositChipView } from "./DepositPoolBars";
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

/** The edit row labelled `label`, up to the next edit row. */
function editRow(html: string, label: string): string {
  const start = html.indexOf(`<span class="edit-label">${label}</span>`);
  expect(start, `a ${label} row`).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const next = rest.indexOf('<span class="edit-label">');
  return next === -1 ? rest : rest.slice(0, next);
}

/** The die that marks a rolled value, as it renders. */
const DIE = renderToStaticMarkup(<RolledMark />);

/** A value in the rolled look, as it renders. */
function rolled(text: string): string {
  return `<span class="ins-st-rolled">${DIE}${text}</span>`;
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

/** The rows of the Deposits section, without the Class row's or the Modifiers section's. */
function depositRows(html: string) {
  const start = html.indexOf('class="ins-sec-title">Deposits');
  const end = html.indexOf('class="ins-sec-title">Modifiers');
  return poolRows(html.slice(start, end === -1 ? undefined : end));
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

    const cls = row(
      drawnBy(() => page(100, "Planet")),
      "Class",
    );
    expect(cls).toContain(">Random class</span>");
    expect(hintOf("Class")).toContain("Rolled from the classes that fit its orbit.");
    const odds = poolRows(cls).map((r) => [r.name.toLowerCase(), r.width, r.chance]);
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

  it("lists classes that show under one name as one row", async () => {
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
      ]),
    });
    await land(details({ planets: [listed], spawn: systemSpawn() }));

    const rows = poolRows(row(page(101, "Listed"), "Class"));
    expect(rows.map((r) => r.name)).toEqual(["Barren World", "Frozen World"]);
  });

  it("lists the classes without odds where the orbit is a range or the star is rolled", async () => {
    const ranged = { ...drawn(100), layout: bodyLayout({ orbit: { min: 90, max: 140 } }) };
    const fixedOrbit = { ...drawn(101), layout: bodyLayout({ orbit: { min: 95, max: 95 } }) };
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
    const listed = poolRows(wide);
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
    expect(overview().match(/>never placed<\/span>/g)).toHaveLength(2);
  });

  it("says some games lack a body whose orbit no class fits around some stars", async () => {
    await open("scenario");
    await land(
      details({ planets: [drawn(100, { orbit_fit: "sometimes" })], spawn: systemSpawn() }),
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
    expect(html).toContain("Can roll · 2 kinds");
    expect(depositRows(html).map((r) => r.title)).toEqual(["Minerals 1 · 75%", "Energy 1 · 25%"]);
    expect(html).toContain("Can roll · 2 planet features");
    const features = poolRows(html.slice(html.indexOf("planet features")));
    expect(features.map((r) => [r.name, r.width, r.chance])).toEqual([
      ["Mineral Poor", "100.0%", "50%"],
      ["Carbon World", undefined, ""],
    ]);
  });

  it("lists what a planet can also roll after the deposits and features it states, by their game data names", async () => {
    usePlanetDataStore.setState({
      depositTypes: new Map([
        ["d_engineering_10", depositTypeView("d_engineering_10", { name: "Engineering Site" })],
        ["d_minerals_1", depositTypeView("d_minerals_1", { name: "Mineral Field" })],
      ]),
    });
    const world = drawn(100, {
      features: { modifier: "pm_tidal_locked", none: false, cleared: false, added: [] },
      rolled_deposits: { state: "rolled", entries: [{ key: "d_minerals_1", chance: 1 }] },
      rolled_features: {
        state: "rolled",
        entries: [
          { key: "pm_carbon_world", chance: null },
          { key: "pm_mineral_poor", chance: null },
          { key: "pm_chthonian", chance: null },
        ],
      },
    });
    await open("scenario");
    await land(
      details({
        planets: [{ ...world, deposit_keys: [{ key: "d_engineering_10", count: 1 }] }],
        spawn: systemSpawn(),
      }),
    );

    const html = page(100, "Planet");
    expect(html).toContain("Engineering Site");
    expect(html).toContain("Can also roll · 1 kind");
    expect(depositRows(html).map((r) => r.title)).toEqual(["Mineral Field · 100%"]);
    expect(html).not.toContain("Minerals 1");
    expect(html).toContain("Can also roll · 3 planet features");
  });

  it("shows the deposits it can roll as one bar per resource, split by amount from the least, likeliest first", async () => {
    const energy = (amount: number) =>
      depositTypeView(`d_energy_${amount}`, {
        name: `£energy£ +${amount}`,
        yields: [resourceAmount("energy", amount, "Energy")],
      });
    usePlanetDataStore.setState({
      depositTypes: new Map([
        ["d_energy_2", energy(2)],
        ["d_energy_3", energy(3)],
        ["d_energy_5", energy(5)],
        [
          "d_minerals_2",
          depositTypeView("d_minerals_2", { yields: [resourceAmount("minerals", 2, "Minerals")] }),
        ],
        [
          "d_mystery_1",
          depositTypeView("d_mystery_1", { yields: [resourceAmount("sr_mystery", 1, "Mystery")] }),
        ],
        [
          "d_toxic_kelp",
          depositTypeView("d_toxic_kelp", {
            name: "Toxic Kelp",
            blocker: true,
            yields: [resourceAmount("energy", 1, "Energy")],
          }),
        ],
      ]),
    });
    const world = drawn(100, {
      rolled_deposits: {
        state: "rolled",
        entries: [
          { key: "d_energy_3", chance: 0.13 },
          { key: "d_energy_2", chance: 0.13 },
          { key: "d_energy_5", chance: 0.01 },
          { key: "d_minerals_2", chance: 0.4 },
          { key: "d_mystery_1", chance: 0.3 },
          { key: "d_toxic_kelp", chance: 0.004 },
        ],
      },
    });
    await open("scenario");
    await land(details({ planets: [world], spawn: systemSpawn() }));

    const html = page(100, "Planet");
    expect(html).toContain("Can roll · 3 resources");
    const rows = depositRows(html);
    expect(rows.map((r) => r.title)).toEqual([
      "Minerals · 40%",
      "Mystery · 30%",
      "Energy · 27%",
      "Toxic Kelp · &lt;1%",
    ]);
    const [minerals, mystery, energyRow, kelp] = rows;
    expect(minerals.width).toBe("100.0%");
    expect(energyRow.width).toBe("67.5%");
    expect(minerals.icon).toBe(
      '<span role="img" aria-label="Minerals"><span class="gi">M</span></span>',
    );
    expect(minerals.name).toBe("");
    expect(minerals.chance).toBe("40%");
    expect(minerals.html).not.toContain("title=");
    expect(energyRow.segments.map((g) => g.grow.toFixed(3))).toEqual(["0.481", "0.481", "0.037"]);
    expect(energyRow.segments.map((g) => g.fill)).toEqual(["#ffe08a", "#d99100", "#8a5a00"]);
    expect(energyRow.segments.map((g) => g.text)).toEqual(["#1b1f27", "#f4f6fa", "#f4f6fa"]);
    expect(energyRow.segments.map((g) => g.label)).toEqual(["+2", "+3", ""]);

    expect(mystery.segments.map((g) => g.fill)).toEqual(["#aab0ba"]);
    expect(kelp.html).not.toContain('class="gi"');
    expect(kelp.name).toBe("Toxic Kelp");
    expect(kelp.segments).toHaveLength(1);
    expect(kelp.segments[0].label).toBe("");
    expect(kelp.chance).toBe("&lt;1%");
    expect(html).not.toContain("£");
  });

  it("shows a resource's amounts on hover, each with its share and the deposits behind it", () => {
    const energy = (key: string, amount: number, depositName: string) =>
      [
        key,
        depositTypeView(key, {
          name: depositName,
          yields: [resourceAmount("energy", amount, "Energy Credits")],
        }),
      ] as const;
    const views = new Map([
      energy("d_energy_2", 2, "£energy£ +2"),
      energy("d_energy_3", 3, "Energy Deposit"),
      energy("d_rich_energy_3", 3, "Rich Energy Field"),
    ]);
    const [row] = depositBars(
      [
        { key: "d_energy_3", chance: 0.1 },
        { key: "d_energy_2", chance: 0.26 },
        { key: "d_rich_energy_3", chance: 0.08 },
      ],
      views,
    );
    const html = renderToStaticMarkup(<BarLineView row={row} shown onShow={() => undefined} />);
    const card = html.slice(html.indexOf('class="dp-card'));
    expect(card).toContain(
      '<span class="dp-card-name"><span class="gi">E</span>Energy Credits · 44%</span>',
    );
    const lines = card.split('<span class="pl-pool-line">').slice(1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('<span class="pl-pool-amount">+2</span>');
    expect(lines[0]).toContain('<span class="pl-pool-line-chance">26%</span>');
    expect(lines[0]).not.toContain("pl-pool-deposits");
    expect(lines[1]).toContain('<span class="pl-pool-amount">+3</span>');
    expect(lines[1]).toContain('<span class="pl-pool-line-chance">18%</span>');
    expect(card).toContain(
      '<span class="muted pl-pool-deposits">Energy Deposit, Rich Energy Field</span>',
    );
    expect(card).toContain(
      '<span class="dp-card-note muted">How likely a deposit rolled here is to give this resource, at each amount.</span>',
    );

    const unhovered = renderToStaticMarkup(
      <BarLineView row={row} shown={false} onShow={() => undefined} />,
    );
    expect(unhovered).not.toContain("dp-card");
  });

  it("shows an unknown-odds resource's amounts on hover with no bars, and says the class decides", () => {
    const view = (key: string, name: string, amount: number) =>
      [
        key,
        depositTypeView(key, {
          name,
          yields: [resourceAmount("energy", amount, "Energy Credits")],
        }),
      ] as const;
    const views = new Map([
      view("d_energy_2", "£energy£ +2", 2),
      view("d_energy_3", "Energy Deposit", 3),
    ]);
    const [row] = depositBars(
      [
        { key: "d_energy_2", chance: null },
        { key: "d_energy_3", chance: null },
      ],
      views,
    );
    const html = renderToStaticMarkup(<DepositChipView row={row} shown onShow={() => undefined} />);
    const card = html.slice(html.indexOf('class="dp-card'));
    expect(card).toContain(
      '<span class="dp-card-name"><span class="gi">E</span>Energy Credits</span>',
    );
    const lines = card.split('<span class="pl-pool-line">').slice(1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('<span class="pl-pool-amount">+2</span>');
    expect(lines[1]).toContain('<span class="pl-pool-amount">+3</span>');
    expect(lines[1]).toContain('<span class="muted pl-pool-deposits">Energy Deposit</span>');
    expect(card).not.toContain("pl-pool-mini");
    expect(card).not.toContain("pl-pool-line-chance");
    expect(card).not.toContain("How likely");
    expect(card).toContain('<span class="dp-card-note muted">Depends on the class it gets.</span>');

    const asRow = renderToStaticMarkup(<BarLineView row={row} shown onShow={() => undefined} />);
    expect(asRow).toContain("Depends on the class it gets.");
    expect(asRow).not.toContain("pl-pool-mini");
    const unhovered = renderToStaticMarkup(
      <DepositChipView row={row} shown={false} onShow={() => undefined} />,
    );
    expect(unhovered).not.toContain("dp-card");
  });

  it("shows a deposit that yields nothing on hover by its name and chance", () => {
    const [row] = depositBars(
      [{ key: "d_toxic_kelp", chance: 0.004 }],
      new Map([["d_toxic_kelp", depositTypeView("d_toxic_kelp", { name: "Toxic Kelp" })]]),
    );
    const html = renderToStaticMarkup(<BarLineView row={row} shown onShow={() => undefined} />);
    const card = html.slice(html.indexOf('class="dp-card'));
    expect(card).toContain('<span class="dp-card-name">Toxic Kelp · &lt;1%</span>');
    expect(card).not.toContain("pl-pool-line");
    expect(card).toContain(
      "How likely a deposit rolled here is to give this resource, at each amount.",
    );
  });

  it("folds what it can roll under its Deposits row where the class it rolls decides the odds, a resource's amounts in place of a bar", async () => {
    const yielding = (key: string, resource: string, amount: number, label: string) =>
      [key, depositTypeView(key, { yields: [resourceAmount(resource, amount, label)] })] as const;
    usePlanetDataStore.setState({
      depositTypes: new Map([
        yielding("d_minerals_1", "minerals", 1, "Minerals"),
        yielding("d_minerals_2", "minerals", 2, "Minerals"),
        yielding("d_minerals_3", "minerals", 3, "Minerals"),
        yielding("d_energy_1", "energy", 1, "Energy"),
        yielding("d_energy_2", "energy", 2, "Energy"),
        yielding("d_energy_5", "energy", 5, "Energy"),
        yielding("d_gases_1", "exotic_gases", 1, "Exotic Gases"),
      ]),
    });
    const gottara = drawn(100, {
      rolled_deposits: {
        state: "rolled",
        entries: [
          "d_minerals_1",
          "d_minerals_2",
          "d_minerals_3",
          "d_energy_1",
          "d_energy_2",
          "d_energy_5",
          "d_gases_1",
        ].map((key) => ({ key, chance: null })),
      },
    });
    await open("scenario");
    await land(details({ planets: [gottara], spawn: systemSpawn() }));

    const html = drawnBy(() => page(100, "Planet"));
    expect(row(html, "Deposits")).toContain(rolled("Suits its class"));
    expect(hintOf("Deposits")).toBe("The game rolls these to suit the class the planet gets.");
    expect(row(html, "Deposits")).toContain(
      '<button type="button" class="ins-group-head" aria-expanded="false">',
    );
    expect(row(html, "Deposits")).toContain(
      '<span class="ins-group-title">What it can roll</span><span class="ins-group-tail">3 resources</span>',
    );
    expect(poolRows(row(html, "Deposits"))).toEqual([]);
    expect(html).not.toContain('class="ins-sec-title">Deposits');
    expect(html).not.toContain("Can roll");

    openGroups("planet.deposits.roll");
    const opened = row(page(100, "Planet"), "Deposits");
    expect(poolRows(opened)).toEqual([]);
    expect(poolChips(opened).map((c) => [c.title, c.amounts])).toEqual([
      ["Minerals", "+1 to +3"],
      ["Energy", "+1, +2, +5"],
      ["Exotic Gases", "+1"],
    ]);
    expect(poolChips(opened)[0].icon).toBe(
      '<span class="pl-pool-icon" role="img" aria-label="Minerals"><span class="gi">M</span></span>',
    );
    expect(opened.match(/Depends on the class it gets\./g)).toHaveLength(1);
    expect(opened.indexOf("Depends on the class it gets.")).toBeLessThan(
      opened.indexOf("pl-pool-chip"),
    );
    expect(opened).not.toContain("The odds depend on");
  });

  it("shows a random class's many classes as icons, and folds its many deposits and features by kind, each name once", async () => {
    const classes = ["pc_desert", "pc_arid", "pc_savannah", "pc_tropical", "pc_toxic", "pc_barren"];
    const yielding = (key: string, resource: string, amount: number, label: string) =>
      [key, depositTypeView(key, { yields: [resourceAmount(resource, amount, label)] })] as const;
    const blocker = (key: string, label: string) =>
      [key, depositTypeView(key, { name: label, blocker: true })] as const;
    usePlanetDataStore.setState({
      depositTypes: new Map([
        yielding("d_minerals_2", "minerals", 2, "Minerals"),
        yielding("d_minerals_5", "minerals", 5, "Minerals"),
        yielding("d_energy_3", "energy", 3, "Energy"),
        blocker("d_active_volcano", "Active Volcano"),
        blocker("d_toxic_kelp", "Toxic Kelp"),
        blocker("d_toxic_kelp_2", "Toxic Kelp"),
        ["d_crystal_forest", depositTypeView("d_crystal_forest", { name: "Crystal Forest" })],
      ]),
      modifiers: new Map(
        [
          ["pm_obsidian_lakes", "Obsidian Lakes"],
          ["pm_obsidian_lakes_2", "Obsidian Lakes"],
          ["pm_asteroid_belt", "Asteroid Belt"],
          ["pm_asteroid_belt_2", "Asteroid Belt"],
          ["pm_high_quality_minerals", "High Quality Minerals"],
        ].map(([key, label]) => [
          key,
          { key, name: label, static_modifier: null, icon: null, icon_frame: null, effects: [] },
        ]),
      ),
    });
    const ulrikae = planet(100, "", {
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
            at_orbit: classes.map((c) => ({ class: c, weight: 1 })),
          },
        },
        rolled_deposits: {
          state: "rolled",
          entries: [
            "d_minerals_2",
            "d_active_volcano",
            "d_minerals_5",
            "d_toxic_kelp",
            "d_energy_3",
            "d_toxic_kelp_2",
            "d_crystal_forest",
          ].map((key) => ({ key, chance: null })),
        },
        rolled_features: {
          state: "rolled",
          entries: [
            "pm_obsidian_lakes",
            "pm_asteroid_belt",
            "pm_obsidian_lakes_2",
            "pm_high_quality_minerals",
            "pm_asteroid_belt_2",
          ].map((key) => ({ key, chance: null })),
        },
      }),
    });
    await open("scenario");
    await land(details({ planets: [ulrikae], spawn: systemSpawn() }));

    const html = drawnBy(() => page(100, "Planet"));
    const cls = row(html, "Class");
    expect(poolRows(cls)).toEqual([]);
    const strip = cls.slice(cls.indexOf('class="pl-class-strip"'));
    expect(strip.match(/class="ins-hinted"/g)).toHaveLength(classes.length);
    expect(strip.match(/class="pi/g)).toHaveLength(classes.length);
    expect(strip).toContain('role="img" aria-label="Toxic"');
    expect(strip).not.toContain(">Toxic<");
    expect(hintOf("Toxic")).toBe('<span class="mono">pc_toxic</span>');

    const deposits = row(html, "Deposits");
    expect(deposits).toContain(rolled("Suits its class"));
    expect(deposits).toContain('aria-expanded="false"');
    expect(deposits).toContain('<span class="ins-group-tail">2 resources</span>');
    expect(deposits).not.toContain("Blockers");
    const features = row(html, "Planet features");
    expect(features).toContain(rolled("Suits its class"));
    expect(hintOf("Planet features")).toBe(
      "The game rolls these to suit the class the planet gets.",
    );
    expect(features).toContain('aria-expanded="false"');
    expect(features).toContain('<span class="ins-group-tail">3 planet features</span>');
    expect(features).not.toContain("Obsidian Lakes");
    expect(html).not.toContain('class="ins-sec-title">Deposits');
    expect(html).not.toContain('class="ins-sec-title">Modifiers');

    openGroups("planet.deposits.roll", "planet.features.roll");
    const opened = drawnBy(() => page(100, "Planet"));
    const rolledDeposits = row(opened, "Deposits");
    expect(poolRows(rolledDeposits)).toEqual([]);
    expect(poolChips(rolledDeposits).map((c) => [c.title, c.amounts])).toEqual([
      ["Minerals", "+2, +5"],
      ["Energy", "+3"],
    ]);
    expect(rolledDeposits).toMatch(
      /<div class="pl-pool-kinds">Blockers: <span id="[^"]*" class="ins-hinted" tabindex="0">2 kinds<\/span><\/div>/,
    );
    expect(hintOf("Blockers")).toBe("Active Volcano, Toxic Kelp");
    expect(rolledDeposits).toMatch(/<div class="pl-pool-kinds">Other: <span[^>]*>1 kind<\/span>/);
    expect(hintOf("Other")).toBe("Crystal Forest");
    expect(rolledDeposits).not.toContain("Active Volcano");
    const openedFeatures = row(opened, "Planet features");
    expect(openedFeatures).toContain(
      '<div class="pl-pool-names">Obsidian Lakes, Asteroid Belt, High Quality Minerals</div>',
    );
    expect(openedFeatures.match(/Depends on the class it gets\./g)).toHaveLength(1);
    expect(openedFeatures.indexOf("Depends on")).toBeLessThan(
      openedFeatures.indexOf("pl-pool-names"),
    );
    expect(openedFeatures).not.toContain("more</span>");
  });

  it("lists a few classes without odds a row each, and adds up the chances of features that share a name", async () => {
    const classes = ["pc_desert", "pc_arid", "pc_savannah", "pc_tropical"];
    usePlanetDataStore.setState({
      modifiers: new Map(
        [
          ["pm_asteroid_belt", "Asteroid Belt"],
          ["pm_asteroid_belt_2", "Asteroid Belt"],
          ["pm_mineral_poor", "Mineral Poor"],
        ].map(([key, label]) => [
          key,
          { key, name: label, static_modifier: null, icon: null, icon_frame: null, effects: [] },
        ]),
      ),
    });
    const four = planet(100, "", {
      class: "random",
      drawn: true,
      spawn: bodySpawn({
        class: {
          state: "rolled",
          pool: {
            kind: "random",
            draw: "random",
            at_orbit: classes.map((c) => ({ class: c, weight: 1 })),
          },
        },
        rolled_features: {
          state: "rolled",
          entries: [
            { key: "pm_mineral_poor", chance: 0.4 },
            { key: "pm_asteroid_belt", chance: 0.3 },
            { key: "pm_asteroid_belt_2", chance: 0.2 },
          ],
        },
      }),
    });
    await open("scenario");
    await land(details({ planets: [four], spawn: systemSpawn() }));

    const html = page(100, "Planet");
    expect(poolRows(row(html, "Class"))).toHaveLength(classes.length);
    expect(html).not.toContain("pl-class-strip");
    expect(html).toContain("Can roll · 2 planet features");
    const features = poolRows(html.slice(html.indexOf("planet features")));
    expect(features.map((r) => [r.name, r.chance])).toEqual([
      ["Asteroid Belt", "50%"],
      ["Mineral Poor", "40%"],
    ]);
  });

  describe("with no odds known", () => {
    const keys = Array.from({ length: 11 }, (_, i) => `pm_feature_${i}`);

    /** The Planet features row of a planet that can roll `count` features, its roll list open. */
    async function featuresRow(count: number): Promise<string> {
      usePlanetDataStore.setState({
        modifiers: new Map(
          keys.map((key, i) => [
            key,
            {
              key,
              name: `Feature ${i}`,
              static_modifier: null,
              icon: null,
              icon_frame: null,
              effects: [],
            },
          ]),
        ),
      });
      const world = drawn(100, {
        rolled_features: {
          state: "rolled",
          entries: keys.slice(0, count).map((key) => ({ key, chance: null })),
        },
      });
      await open("scenario");
      await land(details({ planets: [world], spawn: systemSpawn() }));
      openGroups("planet.features.roll");
      return row(
        drawnBy(() => page(100, "Planet")),
        "Planet features",
      );
    }

    it("lists at most eight feature names, and the rest as a count with the whole list on hover", async () => {
      const features = await featuresRow(11);
      expect(features).toContain('<span class="ins-group-tail">11 planet features</span>');
      expect(features.match(/Depends on the class it gets\./g)).toHaveLength(1);
      expect(features).toMatch(
        /<div class="pl-pool-names">Feature 0, Feature 1, Feature 2, Feature 3, Feature 4, Feature 5, Feature 6, Feature 7, <span id="[^"]*" class="ins-hinted" tabindex="0">\+3 more<\/span><\/div>/,
      );
      expect(features).not.toContain("Feature 8,");
      expect(hintOf("All planet features")).toBe(keys.map((_, i) => `Feature ${i}`).join(", "));
    });

    it("lists eight feature names whole", async () => {
      const features = await featuresRow(8);
      expect(features).not.toContain("more</span>");
      expect(features).toContain("Feature 6, Feature 7</div>");
    });
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
    const html = drawnBy(() => page(101, "Planet"));
    for (const label of ["Model", "Deposits", "Planet features"]) {
      expect(row(html, label)).toContain(rolled("Suits its class"));
      expect(row(html, label)).not.toContain("What it can roll");
      expect(hintOf(label)).toBe("The game rolls these to suit the class the planet gets.");
    }
    expect(html).not.toContain('class="ins-sec-title">Deposits');
    expect(html).not.toContain('class="ins-sec-title">Modifiers');
  });

  it("gives a ring its class decides its own row, rolled to suit the class", async () => {
    await open("scenario");
    await land(
      details({ planets: [drawn(100, { ring: { state: "unknown" } })], spawn: systemSpawn() }),
    );

    expect(
      row(
        drawnBy(() => page(100, "Planet")),
        "Ring",
      ),
    ).toContain(rolled("Suits its class"));
    expect(hintOf("Ring")).toBe("The game rolls these to suit the class the planet gets.");
  });

  it("gives a rolled ring its chance", async () => {
    await open("scenario");
    await land(
      details({
        planets: [drawn(100, { ring: { state: "rolled", chance: 0.12 } })],
        spawn: systemSpawn(),
      }),
    );

    expect(row(page(100, "Planet"), "Ring")).toContain(rolled("12% chance"));
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
    const first = drawn(100, {
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

describe("odds bars", () => {
  it("drop a star class name's leading English Class, and leave other names as they are", () => {
    expect(starListName("Class G Star")).toBe("G Star");
    expect(starListName("class M Red Giant")).toBe("M Red Giant");
    expect(starListName("Black Hole")).toBe("Black Hole");
    expect(starListName("Classic Star")).toBe("Classic Star");
    expect(starListName("Étoile de classe G")).toBe("Étoile de classe G");
  });

  it("scale each row to the likeliest, and fall back to a neutral tone for a colour too dark or unknown", () => {
    const rows = oddsRows(
      [
        { key: "sc_g", share: 0.6 },
        { key: "sc_black_hole", share: 0.3 },
        { key: "sc_weird", share: 0.1 },
      ],
      (key) => readableTint(starGlyph(key).tint),
    );
    expect(rows.map((r) => [r.key, r.width.toFixed(3), r.color])).toEqual([
      ["sc_g", "1.000", "#ffe066"],
      ["sc_black_hole", "0.500", NEUTRAL_RAMP[1]],
      ["sc_weird", "0.167", "#9aa3ad"],
    ]);
  });
});

describe("the rolled look", () => {
  it("leads a rolled value with a die that says on hover what it means", () => {
    const die = renderToStaticMarkup(<RolledMark />);
    expect(die).toContain(
      '<span class="ins-die" role="img" aria-label="Rolled when a new game starts" title="Rolled when a new game starts"><svg viewBox="0 0 10 10" aria-hidden="true"><rect',
    );
    expect(die.match(/<circle /g)).toHaveLength(3);
    expect(renderToStaticMarkup(<Rolled>2 to 10</Rolled>)).toBe(
      `<span class="ins-st-rolled">${die}2 to 10</span>`,
    );
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

    const html = drawnBy(() => overview());
    expect(html).toContain('<span class="ins-st-unknown">150 to 380</span>');
    expect(html).not.toContain("adds 40");
    expect(hintOf("Inner radius")).toBe(
      "The initializer adds 40 to this in a way Galaxy Forge can&#x27;t work out, so the range leaves it out.",
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
    expect(editRow(html, "Inner radius")).toContain(rolled("150 to 380"));
    expect(editRow(html, "rocky_asteroid_belt")).toContain(rolled("120 to 140"));
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
    const riadore = drawn(100, {
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
    const riadore = drawn(100, {
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
    expect(html).toContain(`<span class="l1">${rolled("Yunak I to III")}`);
    expect(html).toContain(">random class</span>");
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
