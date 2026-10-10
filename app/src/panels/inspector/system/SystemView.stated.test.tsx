import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detailOf } from "../../../store/fixture";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bodySpawn, systemSpawn } from "../../../test/spawn";
import { bindStores } from "../../../store/bindStores";
import { details, land, open, overview, planet, resetStores } from "../inspectorFixture";
import { mockedIpc } from "../../../test/ipc";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

const STAR = planet(99, "", { class: "pc_k_star", star_class: "sc_k", role: "primary" });

/** Every section the overview opened with, as their headers read with the marks inside them left out. */
function sections(html: string): string[] {
  return [
    ...html.matchAll(
      /class="ins-sec-title(?: muted)?">(.*?)<\/span>(?=<span class="chip|<\/button>)/g,
    ),
  ].map((m) => m[1].replace(/<[^>]*>/g, ""));
}

const ROLLED_MARK = '<span class="ins-st-rolled" title="Rolled when the game starts">';

/** The head's line under the name: the star, the planets and the nebula. */
function headLine(html: string): string {
  const start = html.indexOf('<div class="ins-sub muted">');
  return html.slice(start, html.indexOf("</div>", start));
}

describe("a rolled scenario system", () => {
  // basic_init_01: a star from rl_standard_stars, 2 to 10 planets with 0 to 1 moon each.
  const spawn = systemSpawn({
    star: {
      state: "rolled",
      list: "rl_standard_stars",
      members: [
        { key: "sc_b", weight: 2 },
        { key: "sc_g", weight: 6 },
        { key: "sc_k", weight: 4 },
      ],
    },
    planets: { min: 2, max: 10 },
    moons: { min: 0, max: 10 },
    usage: "misc_system_init",
    usage_odds: { kind: "number", value: 20 },
  });
  const rolled = { state: "rolled" as const, pool: { kind: "random" as const, draw: "random" } };
  const second = planet(101, "Kanthe II", {
    class: "random",
    drawn: true,
    spawn: bodySpawn({ copy: 2, count: { min: 2, max: 10 }, class: rolled }),
  });
  const seventh = planet(106, "Kanthe VII", {
    class: "random",
    drawn: true,
    spawn: bodySpawn({ always: false, copy: 7, count: { min: 2, max: 10 }, class: rolled }),
  });

  it("gives the range of planets in its head and its Planets section, and marks a body that may not spawn", async () => {
    await open("scenario");
    await land(details({ planets: [STAR, second, seventh], spawn }));

    const html = overview();
    const head = headLine(html);
    expect(head).toContain(
      '<span class="ins-st-rolled" title="Rolled when the game starts">Random star</span>',
    );
    expect(head).toContain(">2 to 10 planets</span>");
    expect(html).toContain(`Planets · ${ROLLED_MARK}2 to 10</span> · 0 to 10 moons`);
    expect(html).toContain(`Star class · 3 · ${ROLLED_MARK}rolled</span>`);
    expect(sections(html)).toEqual([
      "Spawn point",
      "Star class · 3 · rolled",
      "Planets · 2 to 10 · 0 to 10 moons · 0 colonies",
      "Initializer",
      "Hyperlanes · 4",
      "Scripts · …",
    ]);
    const row = html.slice(html.indexOf(">Kanthe VII"));
    expect(row.slice(0, row.indexOf(`class="l2"`))).toContain(
      '<span class="chip ins-maybe">may not spawn</span>',
    );
    const other = html.slice(html.indexOf(">Kanthe II<"));
    expect(other.slice(0, other.indexOf("Kanthe VII"))).not.toContain("may not spawn");
    expect(html).toContain(">rolled class</span>");
  });

  it("lists the star list's classes likeliest first, with their odds", async () => {
    await open("scenario");
    await land(details({ planets: [STAR, second], spawn }));

    const html = overview();
    expect(html).toContain("The game rolls one of these when a game starts, as often as shown.");
    const g = html.indexOf(">sc_g<");
    const k = html.indexOf(">sc_k<");
    const b = html.indexOf(">sc_b<");
    expect(g).toBeGreaterThan(-1);
    expect(g).toBeLessThan(k);
    expect(k).toBeLessThan(b);
    expect(html).toContain('<span class="rs">50%</span>');
    expect(html).toContain('<span class="rs">33%</span>');
    expect(html).toContain('<span class="rs">17%</span>');
    expect(html).toContain("from the star list rl_standard_stars");
  });

  it("states what only a random galaxy reads, as facts that do nothing here", async () => {
    await open("scenario");
    await land(details({ planets: [STAR, second], spawn }));

    const html = overview();
    expect(html).toContain("Only in random galaxies");
    expect(html).toContain(
      "A random galaxy uses these to pick this layout. A scenario names the initializer, so they do nothing here.",
    );
    expect(html).toContain(
      '<span class="k">Usage</span><span class="mono">misc_system_init</span>',
    );
    expect(html).toContain('<span class="k">Usage odds</span><span>20</span>');
  });
});

describe("a fixed scenario system", () => {
  const spawn = systemSpawn({
    star: { state: "fixed", class: "sc_m" },
    planets: { min: 3, max: 3 },
    moons: { min: 1, max: 1 },
    asteroids: { min: 2, max: 2 },
    flags: ["yuhtaan", "precursor_system"],
    ambient_objects: [{ kind: "large_debris", body: 100 }],
    max_instances: 1,
    primitive_system: true,
  });
  const bodies = [
    STAR,
    planet(100, "Yuhtaan Majoris", { class: "pc_shattered" }),
    planet(101, "Yuhtaan Minoris", { class: "pc_barren_cold", moon: true, parent: 100 }),
    planet(102, "Yuhtaan II", { class: "pc_barren" }),
    planet(103, "Yuhtaan III", { class: "pc_barren_cold" }),
    planet(104, "", { class: "pc_asteroid" }),
    planet(105, "", { class: "pc_asteroid" }),
  ];

  it("counts its planets in the head, its moons and asteroids beside them, and leaves out the star list", async () => {
    await open("scenario");
    await land(details({ planets: bodies, spawn }));

    const html = overview();
    const head = headLine(html);
    expect(head).toContain("3 planets");
    expect(head).not.toContain("ins-st-rolled");
    expect(sections(html)).toEqual([
      "Spawn point",
      "Planets · 3 · 1 moon · 2 asteroids · 0 colonies",
      "Ambient objects · 1",
      "Flags · 2",
      "Initializer",
      "Hyperlanes · 4",
      "Scripts · …",
    ]);
    expect(html).not.toContain("Only in random galaxies");
  });

  it("lists its ambient objects at their body, and how many a galaxy holds", async () => {
    await open("scenario");
    await land(details({ planets: bodies, spawn }));

    const html = overview();
    expect(html).toContain("Large Debris");
    expect(html).toContain("Yuhtaan Majoris ›");
    expect(html).toContain('<span class="k">Instances</span><span>1 per galaxy</span>');
    expect(html).toContain("A system placed on the map counts first, so the game rolls no other.");
    expect(html).toContain('<span class="k">Pre-FTL</span><span>Yes</span>');
  });
});

describe("a seat's scenario system", () => {
  it("says an empire's own system can replace it, and marks the start planet", async () => {
    mockedIpc.getSystem.mockImplementation(async (id) => {
      const detail = detailOf(id);
      return { ...detail, system: { ...detail.system, spawn_weight: 1 } };
    });
    const earth = planet(100, "Earth", {
      class: "pc_continental",
      spawn: bodySpawn({
        class: { state: "fixed", class: "pc_continental" },
        starting_planet: true,
      }),
    });
    await open("scenario");
    await land(details({ planets: [STAR, earth], spawn: systemSpawn() }));

    const html = overview();
    expect(html).toContain(
      "An empire that spawns here brings its own starting system in place of this one.",
    );
    const row = html.slice(html.indexOf(">Earth"));
    expect(row.slice(0, row.indexOf(`class="l2"`))).toContain(">start planet</span>");
  });
});

describe("a scenario system whose bodies come from a script", () => {
  it("says so in its head and under its list, and shows the script and keys as written", async () => {
    const spawn = systemSpawn({
      planets: null,
      moons: null,
      asteroids: null,
      from_script: "grand_archive/voidworms_system_planet_initializer",
      usage_odds: { kind: "script", text: "usage_odds = {\n\tbase = 1\n}", base: 1 },
      other_keys: [{ key: "orbital_line", text: "orbital_line = yes", modelled: 0 }],
      script: [
        { key: "create_voidworms_country", text: "create_voidworms_country = yes", modelled: 0 },
      ],
      inline_scripts: [
        { script: "grand_archive/voidworms_system_planet_initializer", keys: ["class", "planet"] },
      ],
      variables: [{ key: "spawn_chance", variable: "@voidworm_chance" }],
    });
    await open("scenario");
    await land(details({ planets: [STAR, planet(100, "", { class: "pc_toxic" })], spawn }));

    const html = overview();
    expect(headLine(html)).toContain('<span class="ins-st-unknown">planets from a script</span>');
    expect(sections(html)).toContain("Planets · from a script · 0 colonies");
    expect(html).toContain('Planets · <span class="ins-st-unknown">from a script</span>');
    expect(html).toContain(
      '<div class="ins-from">every body comes from grand_archive/voidworms_system_planet_initializer</div>',
    );
    expect(html).toContain('<span class="k">Usage odds</span><span>1, changed by a script</span>');
    expect(html).toContain("base = 1");
    expect(html).toContain("Other keys · 1");
    expect(html).toContain("orbital_line = yes");
    expect(html).toContain("Script · 1");
    expect(html).toContain("create_voidworms_country = yes");
    expect(html).toContain("On a scenario map there is no root system and no hyperlane neighbour");
    expect(html).toContain(
      "class, planet come from grand_archive/voidworms_system_planet_initializer",
    );
    expect(html).toContain("spawn_chance from @voidworm_chance");
  });
});

describe("a save system's head", () => {
  it("counts planets alone, with its moons and asteroids in the Planets section", async () => {
    await open("save");
    await land(
      details({
        planets: [
          planet(99, "Sol", { class: "pc_g_star" }),
          planet(100, "Earth", { class: "pc_continental" }),
          planet(101, "Luna", { class: "pc_barren_cold", moon: true, parent: 100 }),
          planet(102, "Mars", { class: "pc_arid" }),
          planet(103, "Ceres", { class: "pc_asteroid" }),
        ],
      }),
    );

    const html = overview();
    expect(headLine(html)).toContain("2 planets · nebula");
    expect(sections(html)).toContain("Planets · 2 · 1 moon · 1 asteroid · 0 colonies");
    expect(html).toContain("2 planets · 0 colonies");
  });
});
