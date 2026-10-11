import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bodySpawn, systemSpawn } from "../../../test/spawn";
import { bindStores } from "../../../store/bindStores";
import { drawnBy, lastDrawn } from "../../../test/drawn";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { bodyLayout } from "../../../test/builders";
import { details, land, open, planet, resetStores, SYSTEM } from "../inspectorFixture";
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

/** The value of the row labelled `label`, and what follows it up to the next row. */
function row(html: string, label: string): string {
  const start = html.indexOf(`<span class="k">${label}</span>`);
  expect(start, `a ${label} row`).toBeGreaterThan(-1);
  const rest = html.slice(start + label.length + 22);
  const next = rest.indexOf('<span class="k">');
  return next === -1 ? rest : rest.slice(0, next);
}

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

    const html = page(106, "Random planet");
    const head = html.slice(0, html.indexOf("</div>"));
    expect(head).not.toContain("may not spawn");
    expect(html).toContain(
      "The game places 2 to 10 planets like this one. This is the 7th, so it is only there when the game places 7 or more.",
    );
    expect(row(html, "Name")).toContain("Named by the game when it starts");
    expect(row(html, "Class")).toContain("Rolled from the classes that fit its orbit");
    expect(row(html, "Size")).toContain("Rolled from its class&#x27;s sizes");
    expect(row(html, "Ring")).toContain(">Rolled by the game</span>");
    expect(row(html, "Model")).toContain("One of its class&#x27;s models");
    expect(html).toContain("Can appear when the planet is surveyed.");
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

    expect(page(107, "Random moon")).toContain("Some games have this moon and some don&#x27;t.");
    expect(page(108, "Random moon")).toContain("Some games have this moon and some don&#x27;t.");
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

    const html = page(100, "Earth");
    const head = html.slice(0, html.indexOf("</div>"));
    expect(head).toContain(">start planet</span>");
    expect(head).not.toContain("may not spawn");
    expect(row(html, "Name")).toContain("Earth");
    expect(row(html, "Class")).toContain("Continental World");
    expect(row(html, "Ring")).toContain("No");
    expect(row(html, "Model")).toContain("continental_planet_earth_entity");
    expect(html).toContain("Deposits · 1");
    expect(html).toContain("d_engineering_10");
    expect(html).toContain(
      "No other deposits. The initializer clears the rolled ones before adding these.",
    );
    expect(html).toContain("None. The initializer stops blockers on this planet.");
    expect(html).toContain("Modifiers · 1");
    expect(html).toContain("Yuht Homeworld");
    expect(html).toContain("permanent");
    expect(html).toContain("The initializer stops rolled planet features on this planet.");
    expect(html).not.toContain("None. The initializer stops planet features");
    expect(html).toContain("None. The initializer stops anomalies on this planet.");
    expect(html).toContain("Flags · 1");
    expect(html).toContain("planet_earth");
    expect(row(html, "Start planet")).toContain(
      "The empire that spawns here starts on this planet, unless it brings its own starting system.",
    );
    expect(html).toContain(
      '<span class="ins-group-title">Script it runs</span><span class="ins-group-tail">1 line</span>',
    );
    expect(html).toContain("The game runs these lines once, when it builds the planet.");
    expect(html).toContain(
      '<span class="snippet-key">save_global_event_target_as</span> = sol_system_earth',
    );
    expect(html).toContain(
      '<span class="k">Orbit distance</span><span>Set by the variable <span class="mono">@base_moon_distance</span></span>',
    );
    expect(html).not.toContain("edit-field");
    expect(html).not.toContain("pl-dep-remove");
    expect(html).not.toContain("+ Add");
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

    const html = page(100, "Alpha Centauri III");
    expect(row(html, "Class")).toContain(
      '<span class="ins-st-unknown">Decided when the game starts</span>',
    );
    expect(row(html, "Class")).toContain("On a scenario map there is no empire nearby");
    expect(html).toContain("ALPHA_CENTAURI_CAT");
    expect(html).toContain("Placed by the initializer. It is found when the planet is surveyed.");
    expect(html).not.toContain("None. The initializer stops anomalies");
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

    const html = page(99, "Star");
    expect(row(html, "Class")).toContain("One of 2, from rl_pair");
    expect(row(html, "Class")).toContain("sc_g 75% · sc_k 25%");
    expect(html).not.toContain('<span class="k">Ring</span>');
    expect(html).not.toContain('<span class="k">Model</span>');
    expect(html).toContain("Can appear when the star is surveyed.");
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

    const html = page(100, "World");
    expect(html).toContain("The initializer clears the rolled rare resources deposits.");
    expect(html).not.toContain("deposit_cat_");
    expect(html).toContain("d_zro_1");
    expect(html).not.toContain("replaces");
    expect(row(html, "Class")).toContain("Rolled from the habitable classes that fit its orbit");
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

  it("names an anomaly prevented across the system", async () => {
    const barren = planet(100, "Barren", {
      class: "pc_barren",
      spawn: bodySpawn({ anomalies: { categories: [], prevented: "system" } }),
    });
    await open("scenario");
    await land(details({ planets: [barren], spawn: systemSpawn({ prevent_anomalies: true }) }));

    expect(page(100, "Barren")).toContain("None. The initializer stops anomalies in this system.");
  });
});
