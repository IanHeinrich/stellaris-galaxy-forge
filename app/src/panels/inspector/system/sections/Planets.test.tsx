import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../api/ipc");
vi.mock("../../../../api/events");
vi.mock("../../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../../test/drawn"));

import { bindStores } from "../../../../store/bindStores";
import { useInspectorStore } from "../../../../store/inspectorStore";
import { useMapChromeStore } from "../../../../store/mapChromeStore";
import { bodyLayout } from "../../../../test/builders";
import { drawnBy, lastDrawn } from "../../../../test/drawn";
import { details, land, open, overview, planet, resetStores, SYSTEM } from "../../inspectorFixture";
import { DrillRow } from "../../parts";

bindStores();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

/** The second line of the row named `name`: its class, size, orbit and the rest. */
function rowLine(html: string, name: string): string {
  const row = html.slice(html.indexOf(`>${name}<`));
  const line = row.slice(row.indexOf('class="l2"'));
  return line.slice(0, line.indexOf("</span></span>"));
}

describe("the Planets section", () => {
  it("shows a scenario body's size range, as its page does", async () => {
    await open("scenario");
    const ranged = planet(100, "Tarkin", {
      size: 10,
      layout: bodyLayout({ size: { min: 10, max: 25 } }),
    });
    await land(details({ planets: [ranged] }));

    expect(rowLine(overview(), "Tarkin")).toContain("10–25");
  });

  it("shows a save body's one size", async () => {
    await open("save");
    const fixed = planet(100, "Tarkin", {
      size: 16,
      layout: bodyLayout({ size: { min: 16, max: 16 } }),
    });
    await land(details({ planets: [fixed] }));

    const line = rowLine(overview(), "Tarkin");
    expect(line).toContain("16");
    expect(line).not.toContain("–");
  });

  it("opens a save body's page on the system that lists it", async () => {
    await open("save");
    await land(details({ planets: [planet(100, "Tarkin")] }));

    drawnBy(overview);
    const row = lastDrawn(
      (el) => el.type === DrillRow && String(el.props.className).startsWith("ins-prow"),
      "a planet row",
    ) as { onOpen(): void };
    row.onOpen();

    const { stack } = useInspectorStore.getState();
    expect(stack[stack.length - 1].ref).toEqual({ kind: "body", system: SYSTEM, id: 100 });
  });

  it("opens a body row's menu at the pointer on a right-click", async () => {
    const area = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
    vi.stubGlobal("document", { querySelector: () => area });
    await open("save");
    await land(details({ planets: [planet(100, "Tarkin")] }));

    drawnBy(overview);
    const row = lastDrawn(
      (el) => el.type === DrillRow && String(el.props.className).startsWith("ins-prow"),
      "a planet row",
    ) as { onContextMenu(e: object): void };
    const preventDefault = vi.fn();
    row.onContextMenu({ preventDefault, clientX: 40, clientY: 30 });

    expect(preventDefault).toHaveBeenCalled();
    expect(useMapChromeStore.getState().contextMenu).toEqual({
      target: { kind: "bodyRow", system: SYSTEM, id: 100 },
      x: 30,
      y: 10,
    });
  });
});
