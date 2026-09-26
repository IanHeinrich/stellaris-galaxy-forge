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
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { drawnBy, lastDrawn, type DrawnProps } from "../../../test/drawn";
import { details, land, open, overview, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { DrillLink, DrillRow } from "../parts";
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
