import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEntityStore } from "../../../store/entityStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { useSceneStore } from "../../../store/sceneStore";
import { drawnBy, lastDrawn, type DrawnProps } from "../../../test/drawn";
import { details, land, open, overview, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { DrillLink, DrillRow } from "../parts";
import { StarRowIcon } from "../StarIcon";
import { bodyLayout, planetClassView, starClassView } from "../../../test/builders";
import { mockedIpc } from "../../../test/ipc";
import { rolledBody, systemRoll } from "../../../test/rolls";
import { planetPage } from "../../../test/builders";
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

const fixed = (value: number) => ({ min: value, max: value });

const layout = bodyLayout;

const TARKIN = planet(100, "Tarkin", {
  class: "random_colonizable",
  drawn: true,
  colonised: true,
  capital: true,
  size: null,
  deposits: [{ resource: "minerals", amount: 7 }],
  deposit_keys: [{ key: "d_mineral_fields", count: 2 }],
  layout: layout({
    orbit: { min: 40, max: 60 },
    orbit_step: { min: 40, max: 60 },
    size: { min: 10, max: 20 },
  }),
});

const YAVIN = planet(101, "Yavin", {
  class: "pc_gas_giant",
  moon: true,
  parent: 100,
  pre_ftl: true,
  size: 8,
  layout: layout({
    orbit: { min: 5, max: 5 },
    orbit_step: { min: 5, max: 5 },
    angle_step: { min: 30, max: 30 },
    size: { min: 8, max: 8 },
  }),
});

const entry = (id: number, label: string): Entry => ({
  ref: { kind: "body", system: SYSTEM, id },
  label,
});

const page = (id: number, label: string) => {
  useInspectorStore.setState({ tab: "overview" });
  return renderToStaticMarkup(<PlanetView entry={entry(id, label)} />);
};

/** Presses the last drawn element that passes `test`, as a click on it would. */
function press(test: (el: { type: unknown; props: DrawnProps }) => boolean, what: string): void {
  (lastDrawn(test, what) as { onOpen(): void }).onOpen();
}

const top = () => {
  const { stack } = useInspectorStore.getState();
  return stack[stack.length - 1];
};

/** The scenario open on `SYSTEM`, its record listing Tarkin and its moon Yavin. */
async function openTarkin(): Promise<void> {
  await open("scenario");
  await land(details({ planets: [TARKIN, YAVIN] }));
  useInspectorStore.getState().setRoot({ ref: { kind: "system", id: SYSTEM }, label: "Alpha" });
}

describe("a scenario body's page", () => {
  it("has no tabs of a save's entity behind it", async () => {
    await openTarkin();
    useInspectorStore.setState({ tab: "data" });
    expect(renderToStaticMarkup(<PlanetView entry={entry(100, "Tarkin")} />)).toContain(
      '<span class="k">Class</span><span>random</span>',
    );
  });

  it("shows the class, size, orbit and angle the initializer gives, ranges and random included", async () => {
    await openTarkin();

    const html = page(100, "Tarkin");
    expect(html).toContain('<span class="name">Tarkin</span>');
    expect(html).toContain('<span class="k">Class</span><span>random</span>');
    expect(html).toMatch(/<span class="k">Size<\/span><span><span class="sz">.*10–20<\/span>/);
    expect(html).toContain('<span class="k">Orbit radius</span><span>40–60</span>');
    const head = html.slice(0, html.indexOf("</div>"));
    expect(head).toContain(">colonised</span>");
    expect(head).toContain(">capital</span>");
    expect(head).not.toContain("pre-FTL");
    expect(html).toContain("Deposits · 2");
    expect(html).toContain('<span class="l1 mono">d_mineral_fields</span>');
    expect(html).not.toContain("pl-dep-remove");
    expect(html).not.toContain("+ Add deposit…");
    expect(html).not.toContain("Orbits");
    expect(html).not.toContain("Terraforming");
    expect(html).not.toContain("Modifiers");
  });

  it("shows each body's step out from the running orbit as the core gives it", async () => {
    // basic_init_05: the last ice asteroid at 240, then change_orbit = -210 and a planet 30 out.
    const ice = planet(102, "Ice Asteroid", {
      class: "pc_ice_asteroid",
      layout: layout({ orbit: fixed(240), orbit_step: fixed(0) }),
    });
    const naboo = planet(103, "Naboo", {
      class: "pc_continental",
      layout: layout({
        orbit: fixed(60),
        orbit_step: fixed(30),
        turns_from: 102,
      }),
    });
    const hoth = planet(104, "Hoth", {
      class: "pc_frozen",
      layout: layout({
        orbit: { min: 70, max: 80 },
        orbit_step: { min: 10, max: 20 },
        turns_from: 103,
      }),
    });
    await open("scenario");
    await land(details({ planets: [ice, naboo, hoth] }));

    expect(page(103, "Naboo")).toContain('<span class="k">Orbit step</span><span>+30</span>');
    expect(page(104, "Hoth")).toContain('<span class="k">Orbit step</span><span>+10–20</span>');
  });

  it("shows each body's turn from the body before it, linked by name and radius, and any angle for a body naming none", async () => {
    const ice = planet(102, "Ice Asteroid", {
      class: "pc_ice_asteroid",
      layout: layout({ orbit: fixed(240), orbit_step: fixed(240), angle_step: fixed(70) }),
    });
    const naboo = planet(103, "Naboo", {
      class: "pc_continental",
      layout: layout({
        orbit: fixed(60),
        orbit_step: fixed(60),
        angle_step: { min: 90, max: 270 },
        turns_from: 102,
      }),
    });
    const anywhere = planet(104, "Dagobah", {
      class: "pc_tropical",
      layout: layout({
        orbit: fixed(120),
        orbit_step: fixed(60),
        angle_step: { min: 0, max: 360 },
        turns_from: 103,
      }),
    });
    mockedIpc.getSystemRoll.mockResolvedValue(
      systemRoll({
        system: SYSTEM,
        bodies: [
          rolledBody({ id: 100, orbit: 50, angle: 10 }),
          rolledBody({ id: 102, orbit: 240, angle: 250 }),
          rolledBody({ id: 103, orbit: 60, angle: 20, from: 250 }),
          rolledBody({ id: 104, orbit: 120, angle: 300, from: 20 }),
        ],
      }),
    );
    await open("scenario");
    await land(details({ planets: [TARKIN, ice, naboo, anywhere] }));
    useDetailsStore.getState().requestRoll(SYSTEM, 0);
    await vi.advanceTimersByTimeAsync(0);

    expect(page(102, "Ice Asteroid")).toContain(
      '<span class="k">Angle step</span><span>+70°</span>',
    );
    const html = drawnBy(() => page(103, "Naboo"));
    expect(html).toContain('<span class="k">Angle step</span><span>+90–270° from <button');
    expect(html).toContain("Ice Asteroid at 240 ›</button>");
    const link = lastDrawn((el) => el.type === DrillLink, "the anchor's link") as {
      onHover(on: boolean): void;
      onOpen(): void;
    };
    link.onHover(true);
    expect(useSceneStore.getState().linkedBody).toBe(102);
    link.onHover(false);
    expect(useSceneStore.getState().linkedBody).toBeNull();
    link.onHover(true);
    link.onOpen();
    expect(top()).toEqual(entry(102, "Ice Asteroid"));
    expect(useSceneStore.getState().linkedBody).toBeNull();

    expect(page(104, "Dagobah")).toContain("any angle from ");
    expect(page(104, "Dagobah")).toContain("Naboo at 60 ›");
    expect(page(100, "Tarkin")).toContain(
      '<span class="k">Angle step</span><span>any angle</span>',
    );
    expect(page(103, "Naboo")).not.toContain('<span class="k">Angle</span>');
  });

  it("names no body to turn from when the one before stands at the centre", async () => {
    const star = planet(102, "Star", {
      class: "pc_g_star",
      layout: layout({ orbit: fixed(0), orbit_step: fixed(0) }),
    });
    const naboo = planet(103, "Naboo", {
      class: "pc_continental",
      layout: layout({
        orbit: fixed(60),
        orbit_step: fixed(60),
        angle_step: { min: 90, max: 270 },
        turns_from: 102,
      }),
    });
    await open("scenario");
    await land(details({ planets: [star, naboo] }));

    expect(page(103, "Naboo")).toContain('<span class="k">Angle step</span><span>+90–270°</span>');
  });

  it("says the game places a body whose initializer gives no orbit", async () => {
    await open("scenario");
    await land(details({ planets: [planet(102, "Drifter", { class: "pc_barren" })] }));

    expect(page(102, "Drifter")).toContain(
      '<span class="k">Orbit radius</span><span>random</span>',
    );
  });

  it("says whether a body has a ring, or that the game rolls it", async () => {
    const ringed = planet(102, "Ringed", { class: "pc_gas_giant", ring: true });
    const bare = planet(103, "Bare", { class: "pc_barren", ring: false });
    const rolled = planet(104, "Rolled", { class: "pc_gas_giant", ring: null });
    await open("scenario");
    await land(details({ planets: [ringed, bare, rolled] }));

    expect(page(102, "Ringed")).toContain('<span class="k">Ring</span><span>Yes</span>');
    expect(page(103, "Bare")).toContain('<span class="k">Ring</span><span>No</span>');
    expect(page(104, "Rolled")).toContain(
      '<span class="k">Ring</span><span>Rolled by the game</span>',
    );
  });

  it("gives no orbit or angle step to a save's body", async () => {
    const saved = planet(100, "Tarkin", {
      layout: layout({ orbit: fixed(50), at: [50, 0], size: fixed(16) }),
    });
    await open("save");
    await land(details({ planets: [saved] }));
    mockedIpc.getPlanetPage.mockResolvedValue(planetPage({ id: 100 }));
    useEntityStore.getState().requestPlanetPage(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(useEntityStore.getState().pages.has(100)).toBe(true);

    const html = page(100, "Tarkin");
    expect(html).toContain("Orbit radius");
    expect(html).not.toContain("Orbit step");
    expect(html).not.toContain("Angle step");
  });

  it("lists a planet's moons, each opening its own page", async () => {
    await openTarkin();

    const html = drawnBy(() => page(100, "Tarkin"));
    expect(html).toContain("Moons");
    expect(html).toContain("Yavin");
    press((el) => el.type === DrillRow, "the moon's row");

    expect(top()).toEqual(entry(101, "Yavin"));
  });

  it("links a moon to the body it orbits, with its fixed orbit", async () => {
    await openTarkin();

    const html = drawnBy(() => page(101, "Yavin"));
    expect(html).toContain('<span class="k">Orbit radius</span><span>5</span>');
    expect(html).toMatch(/<span class="k">Size<\/span><span><span class="sz">.*8<\/span>/);
    expect(html).toContain(">pre-FTL</span>");
    expect(html).toContain("Orbits");
    press((el) => el.type === DrillLink, "the parent's link");

    expect(top()).toEqual(entry(100, "Tarkin"));
  });

  it("heads a scenario star with its star class's icon", async () => {
    const pulsar = starClassView("sc_pulsar", "pc_pulsar");
    await open("scenario");
    useGameDataStore.setState({
      starClasses: new Map([[pulsar.key, pulsar]]),
      planetClasses: new Map([["pc_pulsar", planetClassView("pc_pulsar")]]),
    });
    const star = planet(99, "Din", {
      class: "pc_pulsar",
      star_class: "sc_pulsar",
      layout: layout({ orbit: fixed(0) }),
    });
    await land(details({ planets: [star] }));

    drawnBy(() => page(99, "Din"));
    expect(lastDrawn((el) => el.type === StarRowIcon, "the star's icon").view).toBe(pulsar);
  });

  it("heads each star of a binary with its own class's icon, as the system view draws it", async () => {
    const binary = starClassView("sc_binary_ab", "pc_a_star", "pc_b_star");
    const a = starClassView("sc_a", "pc_a_star");
    const b = starClassView("sc_b", "pc_b_star");
    await open("scenario");
    useGameDataStore.setState({
      starClasses: new Map([binary, a, b].map((view) => [view.key, view])),
      planetClasses: new Map(["pc_a_star", "pc_b_star"].map((key) => [key, planetClassView(key)])),
    });
    const first = planet(98, "Primary", {
      class: "pc_a_star",
      star_class: "sc_a",
      layout: layout({ orbit: fixed(25) }),
    });
    const second = planet(99, "Companion", {
      class: "pc_b_star",
      star_class: "sc_b",
      layout: layout({ orbit: fixed(25) }),
    });
    await land(details({ planets: [first, second] }));

    drawnBy(() => page(99, "Companion"));
    expect(lastDrawn((el) => el.type === StarRowIcon, "the star's icon").view).toBe(b);
    drawnBy(() => page(98, "Primary"));
    expect(lastDrawn((el) => el.type === StarRowIcon, "the star's icon").view).toBe(a);
  });

  it("waits for the system's record, and says so when the record does not list the body", async () => {
    await open("scenario");
    expect(page(100, "Tarkin")).toContain("Reading the system…");

    await land(details({ planets: [YAVIN] }));
    const html = page(100, "Tarkin");
    expect(html).toContain('<span class="name">Tarkin</span>');
    expect(html).toContain("This body is not in the system any more.");
  });

  it("opens from a row of the system's planet list", async () => {
    await openTarkin();

    const html = drawnBy(overview);
    expect(html).toContain('class="ins-prow" role="button"');
    press(
      (el) => el.type === DrillRow && String(el.props.className).startsWith("ins-prow"),
      "a planet row",
    );

    expect(top().ref).toEqual({ kind: "body", system: SYSTEM, id: 101 });
  });
});
