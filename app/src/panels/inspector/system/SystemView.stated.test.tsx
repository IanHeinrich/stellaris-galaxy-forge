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
import { details, land, open, overview, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { mockedIpc } from "../../../test/ipc";
import { drawnBy, lastDrawn } from "../../../test/drawn";
import { useInspectorStore } from "../../../store/inspectorStore";

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

  it("gives the range of planets in its head and its Planets section", async () => {
    await open("scenario");
    await land(details({ planets: [STAR, second, seventh], spawn }));

    const html = overview();
    const head = headLine(html);
    expect(head).toContain(
      '<span class="ins-st-rolled" title="Rolled when the game starts">Random star</span>',
    );
    expect(head).toContain(">2 to 10 planets</span>");
    expect(html).toContain(`Planets · ${ROLLED_MARK}2 to 10</span></span>`);
    expect(html).toContain("2 to 10 planets · 0 to 10 moons · 0 colonies");
    expect(html).toContain(`Star class · 3 · ${ROLLED_MARK}rolled</span>`);
    expect(sections(html)).toEqual([
      "Spawn point",
      "Star class · 3 · rolled",
      "Planets · 2 to 10",
      "Initializer",
      "Hyperlanes · 4",
      "Scripts · …",
    ]);
    expect(html).not.toContain("may not spawn");
    expect(html).toContain(">rolled class</span>");
  });

  it("lists a block the game places a random number of times as one row, its count explained on hover", async () => {
    const block = { min: 1, max: 4 };
    const copy = (id: number, n: number) =>
      planet(id, "", {
        class: "random",
        drawn: true,
        spawn: bodySpawn({ always: n === 1, copy: n, count: block, class: rolled }),
      });
    const moonOf = (id: number, parent: number) =>
      planet(id, "", {
        class: "random",
        moon: true,
        parent,
        drawn: true,
        spawn: bodySpawn({ always: false, count: { min: 0, max: 1 }, class: rolled }),
      });
    const bodies = [STAR];
    for (let n = 1; n <= 4; n++) bodies.push(copy(98 + 2 * n, n), moonOf(99 + 2 * n, 98 + 2 * n));
    await open("scenario");
    await land(
      details({
        planets: bodies,
        spawn: systemSpawn({ planets: block, moons: { min: 0, max: 4 } }),
      }),
    );

    const html = drawnBy(overview);
    expect(html.split('<div class="ins-prow').length - 1).toBe(2);
    expect(html).toContain(`${ROLLED_MARK}Random planets</span>`);
    expect(html).toContain(`${ROLLED_MARK}any class</span>`);
    expect(html).toContain("<span>each with up to 1 moon</span>");
    expect(html).toContain(
      '<span class="ins-block-count ins-st-rolled" title="The game places 1 to 4 of these planets when it builds the system.">1 to 4</span>',
    );
    expect(html).not.toContain("Random moon");
    expect(html).toContain("1 to 4 planets · 0 to 4 moons · 0 colonies");

    const row = lastDrawn(
      (el) => typeof el.props.onOpen === "function" && el.props.className === "ins-prow",
      "the block's row",
    ) as { onOpen(): void };
    row.onOpen();
    const { stack } = useInspectorStore.getState();
    expect(stack[stack.length - 1].ref).toEqual({ kind: "body", system: SYSTEM, id: 100 });
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

  it("states what only a random galaxy reads in an open group that says it does nothing here", async () => {
    await open("scenario");
    await land(details({ planets: [STAR, second], spawn }));

    const html = overview();
    expect(html).toContain(
      '<button type="button" class="ins-group-head" aria-expanded="true"><span class="tri">▾</span><span class="ins-group-title">Random galaxy settings</span><span class="ins-group-tail">no effect here</span></button>',
    );
    expect(html).toContain(
      "A random galaxy uses these to decide how often to add this system. This map places it by name, so they don&#x27;t apply.",
    );
    expect(html).toContain(
      '<span class="k">Used as</span><span class="mono">misc_system_init</span>',
    );
    expect(html).toContain('<span class="k">How often</span><span>20</span>');
    expect(html).toContain(
      '<span class="mono ins-init-name">basic_init_01</span><button type="button">Change…</button>',
    );
  });

  it("closes a group when asked and remembers it", async () => {
    await open("scenario");
    await land(details({ planets: [STAR, second], spawn }));
    useInspectorStore.getState().toggleSection("system.initializer.random", false);

    const html = overview();
    expect(html).toContain(
      'aria-expanded="false"><span class="tri">▸</span><span class="ins-group-title">Random galaxy settings',
    );
    expect(html).not.toContain("How often");
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
    expect(html).toContain("3 planets · 1 moon · 2 asteroids · 0 colonies");
    expect(head).not.toContain("ins-st-rolled");
    expect(sections(html)).toEqual([
      "Spawn point",
      "Planets · 3",
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
    expect(html).toContain('<span class="k">Per galaxy</span><span>At most 1</span>');
    expect(html).toContain("This system is that one, so a new game won&#x27;t add another.");
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
    expect(sections(html)).toContain("Planets · from a script");
    expect(html).toContain("planets from a script · 0 colonies");
    expect(html).toContain('Planets · <span class="ins-st-unknown">from a script</span>');
    expect(html).toContain(
      '<div class="ins-from">every body comes from grand_archive/voidworms_system_planet_initializer</div>',
    );
    expect(html).toContain(
      '<span class="k">How often</span><span>Starts at 1. The conditions below change it.</span>',
    );
    expect(html).toContain(
      '<span class="snippet-key">base</span> = <span class="snippet-number">1</span>',
    );
    expect(html).toContain(
      '<span class="ins-group-title">Other keys</span><span class="ins-group-tail">1</span>',
    );
    expect(html).toContain(
      '<span class="snippet-key">orbital_line</span> = <span class="snippet-bool">yes</span>',
    );
    expect(html).toContain(
      '<span class="ins-group-title">Script it runs</span><span class="ins-group-tail">1 line</span>',
    );
    expect(html).toContain("create_voidworms_country</span>");
    expect(html).toContain(
      "On a scenario map they run before hyperlanes exist, so lines that look for a neighbouring system find none.",
    );
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
    expect(sections(html)).toContain("Planets · 2");
    expect(html).toContain("2 planets · 1 moon · 1 asteroid · 0 colonies");
  });
});
