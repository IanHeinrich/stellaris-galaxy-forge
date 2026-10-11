import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import type { BodySpawn } from "../../../generated/BodySpawn";
import { depositBars } from "../../../lib/details/depositBars";
import { FEATURE_CHANCE_TITLE } from "../../../lib/details/spawnFacts";
import { bindStores } from "../../../store/bindStores";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useDetailsStore } from "../../../store/detailsStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { mockedIpc } from "../../../test/ipc";
import { rolledBody, systemRoll } from "../../../test/rolls";
import { useNameFormatsStore } from "../../../store/nameFormatsStore";
import { depositTypeView, resourceAmount } from "../../../store/fixtures/planet";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { bodyLayout, name } from "../../../test/builders";
import { bodySpawn, systemSpawn } from "../../../test/spawn";
import { details, land, open, overview, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { Rolled, RolledMark } from "../states";
import { BarLineView } from "./DepositPoolBars";
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

/** A segment of a deposit roll's bar, as it renders. */
interface ShownSegment {
  lit: boolean;
  grow: number;
  fill: string;
  text: string;
  label: string;
}

/** The rows of a deposit roll's bars, in order, each with its parts as they render. */
function barRows(html: string) {
  return [
    ...html.matchAll(
      /<div id="[^"]*" class="pl-pool-row" role="group" aria-label="([^"]*)"[^>]*>(.*?)<\/span><\/div>/g,
    ),
  ].map(([, title, inner]) => {
    const width = /class="pl-pool-bar" style="width:([^"]*)"/.exec(inner)?.[1];
    const segments: ShownSegment[] = [
      ...inner.matchAll(
        /class="pl-pool-seg( lit)?" style="flex-grow:([^;]*);background:([^;]*);color:([^"]*)">([^<]*)<\/span>/g,
      ),
    ].map(([, lit, grow, fill, text, label]) => ({
      lit: lit !== undefined,
      grow: Number(grow),
      fill,
      text,
      label,
    }));
    const chance = /class="muted pl-pool-chance"[^>]*>([^<]*)$/.exec(inner)?.[1];
    return { title, html: inner, width, segments, chance };
  });
}

/** One entry of a roll line, as it shows: its name, then its chance muted, then a dot when more follow. */
function pick(name: string, chance: string, title: string, more: boolean, hover?: string): string {
  const dot = more ? '<span aria-hidden="true">·</span>' : "";
  const named = hover === undefined ? "<span>" : `<span title="${hover}">`;
  return `<span class="ins-pool-pick">${named}${name}</span><span class="muted" title="${title}">${chance}</span>${dot}</span>`;
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
    expect(list).toContain(
      "The game may roll any class in this list, even one that doesn&#x27;t fit the orbit.",
    );
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
    expect(overview().match(/>never placed<\/span>/g)).toHaveLength(2);
  });

  it("says some games lack a body whose orbit no class fits around some stars", async () => {
    await open("scenario");
    await land(
      details({ planets: [drawn(100, { orbit_fit: "sometimes" })], spawn: systemSpawn() }),
    );

    expect(page(100, "Planet")).toContain(
      "Some games have this planet and some don&#x27;t. At some of the orbits it can land at, none of the classes it can roll fit.",
    );
    expect(overview()).toContain(
      `<span class="ins-block-count ins-st-rolled" title="Some games have this planet and some don&#x27;t.">${DIE}0 to 1</span>`,
    );
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
    expect(html).toContain("Can roll · 2 deposits");
    expect(barRows(html).map((r) => r.title)).toEqual(["Minerals 1 · 75%", "Energy 1 · 25%"]);
    expect(html).toContain("Can roll · 2 planet features");
    expect(html).toContain(pick("Mineral Poor", "50%", FEATURE_CHANCE_TITLE, true));
    expect(html).toContain('<span class="ins-pool-pick"><span>Carbon World</span></span>');
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
    expect(html).toContain("Can also roll · 1 deposit");
    expect(barRows(html).map((r) => r.title)).toEqual(["Mineral Field · 100%"]);
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
        ["d_toxic_kelp", depositTypeView("d_toxic_kelp", { name: "Toxic Kelp", blocker: true })],
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
    expect(html).toContain("Can roll · 6 deposits");
    const rows = barRows(html);
    expect(rows.map((r) => r.title)).toEqual([
      "Minerals · 40%",
      "Mystery · 30%",
      "Energy · 27%",
      "Toxic Kelp · &lt;1%",
    ]);
    const [minerals, mystery, energyRow, kelp] = rows;
    expect(minerals.width).toBe("100.0%");
    expect(energyRow.width).toBe("67.5%");
    expect(minerals.html).toContain(
      '<span class="pl-pool-key" role="img" aria-label="Minerals"><span class="gi">M</span></span>',
    );
    expect(minerals.html).not.toContain(">Minerals<");
    expect(minerals.chance).toBe("40%");
    expect(minerals.html).not.toContain("title=");
    expect(energyRow.segments.map((g) => g.grow.toFixed(3))).toEqual(["0.481", "0.481", "0.037"]);
    expect(energyRow.segments.map((g) => g.fill)).toEqual(["#ffe08a", "#d99100", "#8a5a00"]);
    expect(energyRow.segments.map((g) => g.text)).toEqual(["#1b1f27", "#f4f6fa", "#f4f6fa"]);
    expect(energyRow.segments.map((g) => g.label)).toEqual(["+2", "+3", ""]);

    expect(mystery.segments.map((g) => g.fill)).toEqual(["#aab0ba"]);
    expect(kelp.html).not.toContain('class="gi"');
    expect(kelp.html).toContain('<span class="pl-pool-key pl-pool-name">Toxic Kelp</span>');
    expect(html).toContain("--pool-key:72px");
    expect(kelp.segments).toHaveLength(1);
    expect(kelp.segments[0].label).toBe("");
    expect(kelp.chance).toBe("&lt;1%");
    expect(html).not.toContain("£");
  });

  it("shows a resource's amounts on hover, each with its share and the deposits behind it, and lights the hovered one", () => {
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
    const shown = (amount: number | null) =>
      renderToStaticMarkup(
        <BarLineView row={row} hover={{ shown: true, amount }} onHover={() => undefined} />,
      );

    const html = shown(3);
    const card = html.slice(html.indexOf('class="dp-card'));
    expect(card).toContain(
      '<span class="dp-card-name"><span class="gi">E</span>Energy Credits · 44%</span>',
    );
    const lines = card.split(/<span class="pl-pool-line(?= lit"|")/).slice(1);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.startsWith(" lit"))).toEqual([false, true]);
    expect(lines[0]).toContain('<span class="pl-pool-amount">+2</span>');
    expect(lines[0]).toContain('<span class="pl-pool-line-chance">26%</span>');
    expect(lines[0]).not.toContain("pl-pool-deposits");
    expect(lines[1]).toContain('<span class="pl-pool-amount">+3</span>');
    expect(lines[1]).toContain('<span class="pl-pool-line-chance">18%</span>');
    expect(card).toContain(
      '<span class="muted pl-pool-deposits">Energy Deposit, Rich Energy Field</span>',
    );
    expect(card).toContain(
      '<span class="dp-card-note muted">Chance one deposit the game rolls here is this one.</span>',
    );
    expect(html.match(/class="pl-pool-seg lit"/g)).toHaveLength(1);
    expect(html).toContain('class="pl-pool-seg lit" style="flex-grow:0.409');

    const unhovered = renderToStaticMarkup(
      <BarLineView row={row} hover={{ shown: false, amount: null }} onHover={() => undefined} />,
    );
    expect(unhovered).not.toContain("dp-card");
    expect(unhovered).not.toContain(" lit");
  });

  it("shows a deposit that yields nothing on hover by its name and chance", () => {
    const [row] = depositBars(
      [{ key: "d_toxic_kelp", chance: 0.004 }],
      new Map([["d_toxic_kelp", depositTypeView("d_toxic_kelp", { name: "Toxic Kelp" })]]),
    );
    const html = renderToStaticMarkup(
      <BarLineView row={row} hover={{ shown: true, amount: null }} onHover={() => undefined} />,
    );
    const card = html.slice(html.indexOf('class="dp-card'));
    expect(card).toContain('<span class="dp-card-name">Toxic Kelp · &lt;1%</span>');
    expect(card).not.toContain("pl-pool-line");
    expect(card).toContain("Chance one deposit the game rolls here is this one.");
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

    const html = page(100, "Yunak II");
    expect(html).toContain('<span class="name">Yunak II</span>');
    expect(row(html, "Name")).toContain(rolled("Yunak II"));
    expect(row(html, "Name")).toContain(
      "The game numbers planets in order, so this one is Yunak II or Yunak III, depending on how many before it are placed.",
    );
    expect(page(101, "Yunak IIa")).toContain('<span class="name">Yunak IIa</span>');
    expect(overview()).toContain(`<span class="l1">${rolled("Yunak II")}</span>`);
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
    expect(html).toContain("The game picks the system&#x27;s name when it starts.");
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

    const html = overview();
    expect(html).toContain('<span class="ins-st-unknown">150 to 380</span>');
    expect(html).toContain(
      "The initializer also sets an offset of 40. This range leaves it out, because Galaxy Forge can&#x27;t tell how the game applies it.",
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
    expect(html).toContain(rolled("150 to 380"));
    expect(html).toContain(rolled("120 to 140"));
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

  it("shows a body whose numeral can vary by its first name in the rolled look, on a row and in the Orbits link", async () => {
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

    expect(page(100, "Riadore I")).toContain(`<span class="l1">${rolled("Riadore Ia")}</span>`);
    expect(row(page(101, "Riadore Ia"), "Orbits")).toContain(rolled("Riadore I"));
    expect(page(100, "Riadore I")).toContain(`<span class="l1">${rolled("Riadore Ib")}</span>`);
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
    expect(angle).toContain(" at 55");
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
