import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { bodySpawn, systemSpawn } from "../../../test/spawn";
import { bindStores } from "../../../store/bindStores";
import { drawnBy, lastDrawn } from "../../../test/drawn";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { bodyLayout, planetClassView } from "../../../test/builders";
import { hintOf } from "../../../test/hints";
import { poolRows } from "../../../test/poolRows";
import { details, land, open, planet, resetStores, row, SYSTEM } from "../inspectorFixture";
import { PlanetView } from "./PlanetView";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

const page = (id: number, label: string) => {
  const entry: Entry = { ref: { kind: "body", system: SYSTEM, id }, label };
  useInspectorStore.setState({ tab: "overview" });
  return renderToStaticMarkup(<PlanetView entry={entry} />);
};

const ROLLED = { state: "rolled" as const, pool: { kind: "random" as const, draw: "random" } };

describe("a scenario body's page", () => {
  it("says which copy of its block it is and when the game places it, and what the game rolls", async () => {
    const seventh = planet(106, "", {
      class: "random",
      drawn: true,
      size: null,
      ring: null,
      layout: bodyLayout({ orbit: { min: 245, max: 245 } }),
      spawn: bodySpawn({ always: false, copy: 7, count: { min: 2, max: 10 }, class: ROLLED }),
    });
    await open("scenario");
    await land(details({ planets: [seventh], spawn: systemSpawn() }));

    const html = drawnBy(() => page(106, "Random planet"));
    const head = html.slice(0, html.indexOf("</div>"));
    expect(head).not.toContain("may not spawn");
    expect(html).toContain(">7th of 2 to 10 planets like this one · not in every game</span>");
    expect(hintOf("Copies")).toBe(
      "The game places 2 to 10 planets like this one. This is the 7th, so it is only there when the game places 7 or more.",
    );
    expect(row(html, "Name")).toContain(">Random</span>");
    expect(row(html, "Name")).not.toContain("ins-st-unknown");
    expect(hintOf("Name")).toBe("The game picks a name for it at random when a new game starts.");
    expect(row(html, "Class")).toContain(">Random class</span>");
    expect(hintOf("Class")).toContain("Rolled from the classes that fit its orbit.");
    expect(row(html, "Size")).toContain(">Suits its class</span>");
    expect(hintOf("Size")).toContain("The game rolls these to suit the class the planet gets.");
    expect(row(html, "Ring")).toContain(">Rolled</span>");
    expect(row(html, "Model")).toContain(">Suits its class</span>");
    expect(hintOf("Model")).toBe("The game rolls these to suit the class the planet gets.");
    expect(html).not.toContain("Anomaly");
    expect(html).not.toContain("edit-field");
    expect(html).not.toContain("Deposits");
    expect(html).not.toContain("Modifiers");
  });

  it("says a moon around a planet not every game has may be missing too, and when a lone optional moon is placed", async () => {
    const moon = planet(107, "", {
      class: "random",
      moon: true,
      parent: 106,
      spawn: bodySpawn({ always: false, copy: 1, count: { min: 1, max: 1 }, class: ROLLED }),
    });
    const optional = planet(108, "", {
      class: "random",
      moon: true,
      parent: 105,
      spawn: bodySpawn({ always: false, copy: 1, count: { min: 0, max: 1 }, class: ROLLED }),
    });
    await open("scenario");
    await land(details({ planets: [moon, optional], spawn: systemSpawn() }));

    drawnBy(() => page(107, "Random moon"));
    expect(hintOf("Copies")).toBe("Some games have this moon and some don&#x27;t.");
    expect(page(108, "Random moon")).toContain(">Not in every game</span>");
    expect(hintOf("Copies")).toBe("Some games have this moon and some don&#x27;t.");
  });

  it("names a class the initializer changes a moon to as a moon class", async () => {
    const moon = planet(107, "", {
      class: "pc_barren",
      moon: true,
      spawn: bodySpawn({ changed_class: "random" }),
    });
    await open("scenario");
    await land(details({ planets: [moon], spawn: systemSpawn() }));

    expect(row(page(107, "Moon"), "Class")).toContain("random moon");
  });

  it("shows a fixed body's stated name, model, deposits, features, flags and start, read-only", async () => {
    usePlanetDataStore.setState({
      modifiers: new Map([
        [
          "yuht_homeworld",
          {
            key: "yuht_homeworld",
            name: "Yuht Homeworld",
            static_modifier: null,
            icon: null,
            icon_frame: null,
            effects: [],
          },
        ],
      ]),
    });
    const earth = planet(100, "Earth", {
      class: "pc_continental",
      size: 18,
      ring: false,
      deposit_keys: [{ key: "d_engineering_10", count: 1 }],
      spawn: bodySpawn({
        class: { state: "fixed", class: "pc_continental" },
        entity: "continental_planet_earth_entity",
        deposits: [
          { kind: "clear", category: null },
          { kind: "add", deposit: "d_engineering_10" },
        ],
        no_blockers: true,
        features: {
          modifier: null,
          none: true,
          cleared: false,
          added: [{ modifier: "yuht_homeworld", days: -1 }],
        },
        anomalies: { categories: [], prevented: "body" },
        flags: ["planet_earth"],
        starting_planet: true,
        script: [
          {
            key: "save_global_event_target_as",
            text: "save_global_event_target_as = sol_system_earth",
            modelled: 0,
          },
        ],
        variables: [{ key: "orbit_distance", variable: "@base_moon_distance" }],
      }),
    });
    await open("scenario");
    await land(details({ planets: [earth], spawn: systemSpawn() }));

    const html = drawnBy(() => page(100, "Earth"));
    const head = html.slice(0, html.indexOf("</div>"));
    expect(head).toContain('<span class="chip">start planet</span>');
    expect(hintOf("Start planet")).toBe("An empire that spawns here can start on this planet.");
    expect(head).not.toContain("may not spawn");
    expect(row(html, "Name")).toContain("Earth");
    expect(row(html, "Class")).toContain("Continental World");
    expect(row(html, "Ring")).toContain("No");
    expect(row(html, "Model")).toContain("continental_planet_earth_entity");
    expect(hintOf("Model")).toBe('<span class="mono">continental_planet_earth_entity</span>');
    expect(html).toContain("Deposits · 1");
    expect(html).toContain("d_engineering_10");
    expect(html).toContain(
      "Only these. The initializer clears the deposits the game rolls, then adds these.",
    );
    const stopped = row(html, "Stopped");
    expect(stopped).toContain("⊘</span>Blockers</span>");
    expect(stopped).toContain("⊘</span>Anomaly</span>");
    expect(stopped).not.toContain("Planet features");
    expect(hintOf("Stopped")).toContain("The game rolls no blockers for this planet.");
    expect(hintOf("Stopped")).toContain("No anomaly can appear on this planet.");
    expect(html).toContain("Modifiers · 1");
    expect(html).toContain("Yuht Homeworld");
    expect(html).toContain("permanent");
    expect(html).toContain("The game rolls no other planet features for this planet.");
    expect(html).toContain("Flags · 1");
    expect(html).toContain("planet_earth");
    expect(html).toMatch(
      /<span class="ins-group-title"><span id="[^"]*" class="ins-hinted">Script at game start<\/span><\/span><span class="ins-group-tail">1 line<\/span>/,
    );
    expect(hintOf("Script at game start")).toBe(
      "The game runs these lines once, when a new game starts.",
    );
    expect(html).not.toContain("hyperlanes exist");
    expect(html).toContain(
      '<span class="snippet-key">save_global_event_target_as</span> = sol_system_earth',
    );
    expect(row(html, "Orbit step")).toContain('From <span class="mono">@base_moon_distance</span>');
    expect(hintOf("Orbit step")).toBe("A value the game files define once and reuse.");
    expect(html).not.toContain("edit-field");
    expect(html).not.toContain("pl-dep-remove");
    expect(html).not.toContain("+ Add");
  });

  it("shows a home planet with no deposits as its badge and short rows, each explanation in its card", async () => {
    const gatria = planet(100, "Gatria", {
      class: "pc_continental",
      size: 16,
      spawn: bodySpawn({
        class: { state: "fixed", class: "pc_continental" },
        home_planet: true,
        no_blockers: true,
        features: { modifier: null, none: true, cleared: false, added: [] },
        anomalies: { categories: [], prevented: "body" },
        variables: [{ key: "size", variable: "@gatria_size" }],
      }),
    });
    await open("scenario");
    await land(details({ planets: [gatria], spawn: systemSpawn() }));

    const html = drawnBy(() => page(100, "Gatria"));
    const head = html.slice(0, html.indexOf("</div>"));
    expect(head).toContain('<span class="chip">home planet</span>');
    expect(head).not.toContain("title=");
    expect(hintOf("Home planet")).toBe("The home planet of the empire placed in this system.");
    expect(head).not.toContain("start planet");
    expect(row(html, "Name")).toContain("Gatria");
    expect(row(html, "Name")).not.toContain("<div");
    expect(row(html, "Class")).toContain("Continental World");
    expect(row(html, "Class")).not.toContain("ins-why");
    expect(html).not.toContain("ins-why");
    expect(row(html, "Model")).toContain(">Suits its class</span>");
    expect(hintOf("Model")).toBe("The game rolls these to suit the class the planet gets.");
    const stopped = row(html, "Stopped");
    expect(stopped).toContain("⊘</span>Blockers</span>");
    expect(stopped).toContain("⊘</span>Planet features</span>");
    expect(stopped).toContain("⊘</span>Anomaly</span>");
    expect(hintOf("Size")).toContain(
      '<span class="ins-set-by">Size: from <span class="mono">@gatria_size</span></span>',
    );
    expect(html).not.toContain('<span class="k">Deposits</span>');
    expect(html).not.toContain('class="ins-sec-title">Deposits');
  });

  it("gives an unknown class its reason, and an anomaly the initializer places with no remove button", async () => {
    const ideal = planet(100, "Alpha Centauri III", {
      class: "ideal_design_class",
      drawn: true,
      spawn: bodySpawn({
        class: { state: "unknown", written: "ideal_design_class", reason: "ideal" },
        anomalies: { categories: ["ALPHA_CENTAURI_CAT"], prevented: "body" },
      }),
    });
    await open("scenario");
    await land(details({ planets: [ideal], spawn: systemSpawn() }));

    const html = drawnBy(() => page(100, "Alpha Centauri III"));
    expect(row(html, "Class")).toContain(
      '<span class="ins-st-unknown">Decided at game start</span>',
    );
    expect(row(html, "Class")).not.toContain("On a scenario map");
    expect(hintOf("Class")).toContain("On a scenario map no empire is nearby yet");
    expect(html).toContain("ALPHA_CENTAURI_CAT");
    expect(html).toContain("Placed by the initializer. It is found when the planet is surveyed.");
    expect(html).not.toContain("Remove ALPHA_CENTAURI_CAT");
  });

  it("gives a star of a rolled list the list's odds, and no ring or model", async () => {
    const star = planet(99, "", {
      class: "pc_k_star",
      star_class: "sc_k",
      role: "primary",
      spawn: bodySpawn({
        class: { state: "rolled", pool: { kind: "star_list", list: "rl_pair" } },
      }),
    });
    const spawn = systemSpawn({
      star: {
        state: "rolled",
        list: "rl_pair",
        members: [
          { key: "sc_k", weight: 1 },
          { key: "sc_g", weight: 3 },
        ],
      },
    });
    await open("scenario");
    await land(details({ planets: [star], spawn }));

    const html = drawnBy(() => page(99, "Star"));
    expect(row(html, "Class")).toContain("One of 2 star classes");
    expect(row(html, "Class")).not.toContain("rl_pair");
    expect(hintOf("Class")).toBe("From the game&#x27;s star list rl_pair.");
    expect(poolRows(row(html, "Class")).map((r) => [r.name, r.chance])).toEqual([
      ["sc_g", "75%"],
      ["sc_k", "25%"],
    ]);
    expect(html).not.toContain('<span class="k">Ring</span>');
    expect(html).not.toContain('<span class="k">Model</span>');
    expect(html).not.toContain("Anomaly");
  });

  it("names a cleared category in words, lists a set deposit without guessing what it replaces, and names a habitable draw", async () => {
    const world = planet(100, "World", {
      class: "random_colonizable",
      drawn: true,
      deposit_keys: [{ key: "d_zro_1", count: 1 }],
      spawn: bodySpawn({
        class: { state: "rolled", pool: { kind: "random", draw: "random_colonizable" } },
        deposits: [
          { kind: "clear", category: "deposit_cat_rare_resources" },
          { kind: "set", deposit: "d_zro_1", category: null, replaces: "unknown" },
        ],
      }),
    });
    await open("scenario");
    await land(details({ planets: [world], spawn: systemSpawn() }));

    const html = drawnBy(() => page(100, "World"));
    expect(html).toContain("The initializer clears the rare resources deposits the game rolls.");
    expect(html).not.toContain("deposit_cat_");
    expect(html).toContain("d_zro_1");
    expect(html).not.toContain("replaces");
    expect(row(html, "Class")).toContain(">Habitable class</span>");
    expect(hintOf("Class")).toContain("Rolled from the habitable classes that fit its orbit.");
  });

  it("shows script as written, its nesting moved left, and a long one cut behind a control that shows the rest", async () => {
    const nested = `if = {
		limit = { has_leviathans = yes }
		set_owner = event_target:owner
	}`;
    const long = Array.from({ length: 14 }, (_, i) => ({
      key: `set_planet_flag`,
      text: `set_planet_flag = flag_${i}`,
      modelled: 0,
    }));
    const world = planet(100, "World", {
      class: "pc_barren",
      spawn: bodySpawn({ script: [{ key: "if", text: nested, modelled: 0 }, ...long] }),
    });
    await open("scenario");
    await land(details({ planets: [world], spawn: systemSpawn() }));

    const html = drawnBy(() => page(100, "World"));
    expect(html).toContain(
      '<span class="snippet-line"><span class="snippet-keyword">if</span> = {</span>' +
        '<span class="snippet-line">	<span class="snippet-keyword">limit</span> = {',
    );
    expect(html).toContain(
      '<span class="snippet-line">	<span class="snippet-key">set_owner</span> = ' +
        '<span class="snippet-scope">event_target:owner</span></span><span class="snippet-line">}</span>',
    );
    expect(html).toContain("Show all 18 lines");
    expect(html).not.toContain("flag_13");
    expect(html).toContain('aria-expanded="false"');
    const more = lastDrawn(
      (el) => el.type === "button" && el.props.className === "link snippet-more",
      "the show all control",
    ) as { onClick(): void; "aria-expanded": boolean };
    expect(more["aria-expanded"]).toBe(false);
  });

  it("lists a random moon on its planet's page as a moon", async () => {
    const world = planet(100, "World", { class: "pc_barren", spawn: bodySpawn() });
    const moon = planet(101, "", {
      class: "random",
      moon: true,
      parent: 100,
      spawn: bodySpawn({ class: ROLLED }),
    });
    await open("scenario");
    await land(details({ planets: [world, moon], spawn: systemSpawn() }));

    const html = page(100, "World");
    expect(html).toContain(">Random moon</span>");
    expect(html).not.toContain("Random planet");
    expect(html).not.toContain("ins-prow moon");
  });

  it("has no Deposits or Planet features row, or folded group, for a body whose pools are empty", async () => {
    const empty = { state: "rolled" as const, entries: [] };
    const star = planet(99, "", {
      class: "pc_k_star",
      star_class: "sc_k",
      role: "primary",
      spawn: bodySpawn({
        class: { state: "fixed", class: "pc_k_star" },
        rolled_deposits: empty,
        rolled_features: empty,
      }),
    });
    const world = planet(100, "", {
      class: "random",
      drawn: true,
      spawn: bodySpawn({ class: ROLLED, rolled_deposits: empty, rolled_features: empty }),
    });
    await open("scenario");
    await land(details({ planets: [star, world], spawn: systemSpawn() }));

    for (const [id, label] of [
      [99, "Star"],
      [100, "Planet"],
    ] as const) {
      const html = page(id, label);
      expect(html).not.toContain('<span class="k">Deposits</span>');
      expect(html).not.toContain('<span class="k">Planet features</span>');
      expect(html).not.toContain("What it can roll");
      expect(html).not.toContain("Depends on the class it gets.");
    }
  });

  it("calls an asteroid an asteroid in its stopped, deposit, feature and anomaly lines", async () => {
    const rock = planet(100, "Rock", {
      class: "pc_asteroid",
      spawn: bodySpawn({
        class: { state: "fixed", class: "pc_asteroid" },
        no_blockers: true,
        deposits: [{ kind: "clear", category: null }],
        features: { modifier: null, none: true, cleared: false, added: [] },
        anomalies: { categories: [], prevented: "body" },
      }),
    });
    useGameDataStore.setState({
      planetClasses: new Map([
        ["pc_asteroid", planetClassView("pc_asteroid", false, null, { asteroid: true })],
      ]),
    });
    await open("scenario");
    await land(details({ planets: [rock], spawn: systemSpawn() }));

    const html = drawnBy(() => page(100, "Rock"));
    const hints = hintOf("Stopped");
    expect(hints).toContain("No anomaly can appear on this asteroid.");
    expect(hints).toContain("The game rolls no blockers for this asteroid.");
    expect(hints.replace("planet features", "")).not.toContain("planet");
    const body = html.slice(html.indexOf("ins-sec"));
    expect(body.replace(/planet features|class="[^"]*"/gi, "")).not.toMatch(/planet/i);
  });

  it("names an anomaly prevented across the system", async () => {
    const barren = planet(100, "Barren", {
      class: "pc_barren",
      spawn: bodySpawn({ anomalies: { categories: [], prevented: "system" } }),
    });
    await open("scenario");
    await land(details({ planets: [barren], spawn: systemSpawn({ prevent_anomalies: true }) }));

    const html = drawnBy(() => page(100, "Barren"));
    expect(row(html, "Stopped")).toContain("⊘</span>Anomaly</span>");
    expect(hintOf("Stopped")).toBe(
      '<span class="ins-set-by">No anomaly can appear anywhere in this system.</span>',
    );
    expect(html).not.toContain(">Anomaly</span></button>");
  });
});
