import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { depositBars } from "../../../lib/details/depositBars";
import { bindStores } from "../../../store/bindStores";
import { drawnBy } from "../../../test/drawn";
import { openGroups } from "../../../test/groups";
import { hintOf } from "../../../test/hints";
import { classRows, depositRows, poolChips, poolRows } from "../../../test/poolRows";
import { useNameFormatsStore } from "../../../store/nameFormatsStore";
import { depositTypeView, resourceAmount } from "../../../store/fixtures/planet";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { bodySpawn, systemSpawn } from "../../../test/spawn";
import {
  details,
  land,
  open,
  page,
  planet,
  randomPlanet,
  resetStores,
  rolled,
  row,
} from "../inspectorFixture";
import { BarLineView, DepositChipView } from "./DepositPoolBars";

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

describe("the deposits and features a scenario body can roll", () => {
  it("lists the deposits and features it can also roll, likeliest first with their chances", async () => {
    const world = randomPlanet(100, {
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
    const world = randomPlanet(100, {
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
    const world = randomPlanet(100, {
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
    const gottara = randomPlanet(100, {
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
    expect(strip.match(/class="ins-hinted-toggle"/g)).toHaveLength(classes.length);
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
    expect(classRows(row(html, "Class"))).toHaveLength(classes.length);
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
      const world = randomPlanet(100, {
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
    const fixed = randomPlanet(100, {
      rolled_deposits: { state: "fixed" },
      rolled_features: { state: "fixed" },
    });
    const unknown = randomPlanet(101, {
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
      details({
        planets: [randomPlanet(100, { ring: { state: "unknown" } })],
        spawn: systemSpawn(),
      }),
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
        planets: [randomPlanet(100, { ring: { state: "rolled", chance: 0.12 } })],
        spawn: systemSpawn(),
      }),
    );

    expect(row(page(100, "Planet"), "Ring")).toContain(rolled("12% chance"));
  });
});
