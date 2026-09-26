import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BodyLayout } from "../../../generated/BodyLayout";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { drawnBy, lastDrawn, type DrawnProps } from "../../../test/drawn";
import { details, land, open, overview, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { DrillLink, DrillRow } from "../parts";
import { StarRowIcon } from "../StarIcon";
import { planetClassView, starClassView } from "../../../test/builders";
import { ScenarioBodyView } from "./ScenarioBodyView";
import { INSPECTOR_VIEWS } from "./views";

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

function layout(extra: Partial<BodyLayout>): BodyLayout {
  return { orbit: null, angle: null, at: null, size: null, ...extra };
}

const TARKIN = planet(100, "Tarkin", {
  class: "random_colonizable",
  colonised: true,
  capital: true,
  size: null,
  deposits: [{ resource: "minerals", amount: 7 }],
  layout: layout({ orbit: { min: 40, max: 60 }, size: { min: 10, max: 20 } }),
});

const YAVIN = planet(101, "Yavin", {
  class: "pc_gas_giant",
  moon: true,
  parent: 100,
  pre_ftl: true,
  size: 8,
  layout: layout({
    orbit: { min: 5, max: 5 },
    angle: { min: 30, max: 30 },
    size: { min: 8, max: 8 },
  }),
});

const entry = (id: number, label: string): Entry => ({
  ref: { kind: "body", system: SYSTEM, id },
  label,
});

const page = (id: number, label: string) =>
  renderToStaticMarkup(<ScenarioBodyView entry={entry(id, label)} />);

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
  it("is the Body view, which needs nothing of the document", () => {
    expect(INSPECTOR_VIEWS.body.label).toBe("Body");
    expect(INSPECTOR_VIEWS.body.component).toBe(ScenarioBodyView);
    expect(INSPECTOR_VIEWS.body.requires).toBeUndefined();
  });

  it("shows the class, size, orbit and angle the initializer gives, ranges and random included", async () => {
    await openTarkin();

    const html = page(100, "Tarkin");
    expect(html).toContain('<span class="name">Tarkin</span>');
    expect(html).toContain('<span class="k">Class</span><span>random</span>');
    expect(html).toMatch(/<span class="k">Size<\/span><span><span class="sz">.*10–20<\/span>/);
    expect(html).toContain('<span class="k">Orbit radius</span><span>40–60</span>');
    expect(html).toContain('<span class="k">Angle</span><span>random</span>');
    const head = html.slice(0, html.indexOf("</div>"));
    expect(head).toContain(">colonised</span>");
    expect(head).toContain(">capital</span>");
    expect(head).not.toContain("pre-FTL");
    expect(html).toContain('title="Minerals 7"');
    expect(html).not.toContain("Orbits");
    expect(html).not.toContain("Terraforming");
    expect(html).not.toContain("Modifiers");
  });

  it("shows each body's step out from the previous orbit about its parent, both ends of a range", async () => {
    const naboo = planet(102, "Naboo", {
      class: "pc_continental",
      layout: layout({ orbit: { min: 60, max: 85 }, angle: fixed(90) }),
    });
    await open("scenario");
    await land(details({ planets: [TARKIN, YAVIN, naboo] }));

    expect(page(100, "Tarkin")).toContain('<span class="k">Orbit step</span><span>+40–60</span>');
    expect(page(101, "Yavin")).toContain('<span class="k">Orbit step</span><span>+5</span>');
    expect(page(102, "Naboo")).toContain('<span class="k">Orbit step</span><span>+20–25</span>');
  });

  it("shows each body's turn from the body before it that names an angle, and none for a body naming none", async () => {
    const first = planet(102, "Naboo", {
      class: "pc_continental",
      layout: layout({ orbit: fixed(60), angle: { min: 90, max: 270 } }),
    });
    const second = planet(103, "Hoth", {
      class: "pc_frozen",
      layout: layout({ orbit: fixed(90), angle: { min: 180, max: 540 } }),
    });
    const anywhere = planet(104, "Dagobah", {
      class: "pc_tropical",
      layout: layout({ orbit: fixed(120), angle: { min: 180, max: 900 } }),
    });
    await open("scenario");
    await land(details({ planets: [TARKIN, first, second, anywhere] }));

    expect(page(102, "Naboo")).toContain('<span class="k">Angle step</span><span>+90–270°</span>');
    expect(page(103, "Hoth")).toContain(
      '<span class="k">Angle step</span><span>+90–270° from Naboo</span>',
    );
    expect(page(104, "Dagobah")).toContain(
      '<span class="k">Angle step</span><span>any angle from Hoth</span>',
    );
    expect(page(100, "Tarkin")).not.toContain("Angle step");
  });

  it("gives no orbit step to a save's body", async () => {
    await open("save");
    await land(details({ planets: [TARKIN, YAVIN] }));

    const html = page(100, "Tarkin");
    expect(html).toContain('<span class="k">Orbit radius</span>');
    expect(html).not.toContain("Orbit step");
  });

  it("lists a planet's moons, each opening its own page", async () => {
    await openTarkin();

    const html = drawnBy(() => page(100, "Tarkin"));
    expect(html).toContain("Moons");
    expect(html).toContain("Yavin");
    press((el) => el.type === DrillRow, "the moon's row");

    expect(top()).toEqual(entry(101, "Yavin"));
  });

  it("links a moon to the body it orbits, with its fixed orbit and angle", async () => {
    await openTarkin();

    const html = drawnBy(() => page(101, "Yavin"));
    expect(html).toContain('<span class="k">Orbit radius</span><span>5</span>');
    expect(html).toContain('<span class="k">Angle</span><span>30°</span>');
    expect(html).toMatch(/<span class="k">Size<\/span><span><span class="sz">.*8<\/span>/);
    expect(html).toContain(">pre-FTL</span>");
    expect(html).toContain("Orbits");
    press((el) => el.type === DrillLink, "the parent's link");

    expect(top()).toEqual(entry(100, "Tarkin"));
  });

  it("heads a star the initializer writes as its system's star class with that class's icon", async () => {
    const pulsar = starClassView("sc_pulsar", "pc_pulsar");
    await open("scenario");
    useGameDataStore.setState({
      starClasses: new Map([[pulsar.key, pulsar]]),
      planetClasses: new Map([["pc_pulsar", planetClassView("pc_pulsar")]]),
    });
    const star = planet(99, "Din", { class: "sc_pulsar", layout: layout({ orbit: fixed(0) }) });
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
      class: "sc_binary_ab",
      layout: layout({ orbit: fixed(25), angle: fixed(0) }),
    });
    const second = planet(99, "Companion", {
      class: "sc_binary_ab",
      layout: layout({ orbit: fixed(25), angle: fixed(180) }),
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

    expect(top().ref).toEqual({ kind: "body", system: SYSTEM, id: expect.any(Number) });
  });
});
