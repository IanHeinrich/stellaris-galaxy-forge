import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CountryNode } from "../../../generated/CountryNode";
import { countryNode, OPEN_RESULT } from "../../../store/fixture";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The emblem comes from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { useEntityStore } from "../../../store/entityStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry, type InspectorTab } from "../../../store/inspectorStore";
import { armSession, resetStores } from "../../../store/storeFixture";
import { openWith } from "../../../test/session";
import { drawnBy, drawnField } from "../../../test/drawn";
import { SwatchField, ToggleField } from "../../EditField";
import { CountryView, MAP_COLORS_NEED_4_5 } from "./CountryView";
import { mockedIpc } from "../../../test/ipc";

bindStores();

/** An empire of a 4.4 save, with no map colours. */
const EMPIRE = countryNode();

/** The same empire in a 4.5 save, with a map border and fill of its own. */
const CHOSEN: CountryNode = {
  ...EMPIRE,
  use_map_color: true,
  painted_border: "intense_red",
  painted_fill: "light_pink",
  has_map_colors: true,
};

const PALETTE = [
  { name: "intense_red", map: "#e02020", flag: "#e02020", ship: "#e02020" },
  { name: "light_pink", map: "#f0b0c0", flag: "#f0b0c0", ship: "#f0b0c0" },
];

const PAGE: Entry = { ref: { kind: "country", id: EMPIRE.id }, label: "Test Empire" };

const openSaveWith = (country: CountryNode) =>
  openWith(OPEN_RESULT, { galaxy: { countries: [country] } });

/** The country's page on `tab`, drilled onto from a system as the stack always has one under it. */
function page(tab: InspectorTab): string {
  useInspectorStore.setState({
    stack: [{ ref: { kind: "system", id: 1 }, label: "Sol" }, PAGE],
    tab,
  });
  return renderToStaticMarkup(<CountryView entry={PAGE} />);
}

beforeEach(() => {
  resetStores();
  armSession();
  useEntityStore.getState().clear();
  useGameDataStore.setState({
    status: "ready",
    mapColors: new Map(PALETTE.map((c) => [c.name, c])),
    mapColorSource: null,
  });
});

describe("an empire's Overview", () => {
  it("opens with the map colour fields, then what the empire is", async () => {
    await openSaveWith(CHOSEN);

    const html = page("overview");
    expect(html).toContain("Test Empire");
    expect(html).toContain('aria-label="Map colours"');
    expect(html).toContain('class="icon-picker-trigger edit-field"');
    expect(html).toContain('aria-label="Border: intense_red"');
    expect(html).toContain("Use flag colours instead");
    expect(html.indexOf("Map colours")).toBeLessThan(html.indexOf("About"));
    expect(html).toContain('title="Select the capital system"');
    expect(html).toContain("2 systems");
    expect(html).toContain('class="ins-locked"');
    expect(html).toContain("editable · plain text is information");
  });

  it("gives a 4.4 save's empire disabled fields and the reason", async () => {
    await openSaveWith(EMPIRE);

    const html = page("overview");
    expect(html).toContain(MAP_COLORS_NEED_4_5);
    expect(html).toContain(`title="${MAP_COLORS_NEED_4_5}" disabled=""`);
    expect(html).not.toContain("Use flag colours instead");
  });

  it("keeps the generic view on the Data tab", async () => {
    await openSaveWith(CHOSEN);

    const html = page("data");
    expect(html).not.toContain("Map colours");
    expect(html).toContain("#7");
  });
});

describe("an empire's map colour fields", () => {
  it("shows the current border and fill with their swatches, and the game's palette", async () => {
    await openSaveWith(CHOSEN);

    const html = page("overview");
    expect(html).toContain('aria-label="Border: intense_red"');
    expect(html).toContain('aria-label="Fill: light_pink"');
    expect(html).toContain("background:#e02020");
    expect(html).toContain("background:#f0b0c0");
    expect(html).not.toMatch(/<input[^>]*checked/);
    expect(html).toContain("Palette: Stellaris");
    expect(html).not.toContain(MAP_COLORS_NEED_4_5);
  });

  it("ticks the flag colours box when map colours are off, and names a colour it cannot find", async () => {
    await openSaveWith({ ...CHOSEN, use_map_color: false, painted_border: "red" });

    const html = page("overview");
    expect(html).toMatch(/<input[^>]*checked/);
    expect(html).toContain('aria-label="Border: unknown: red"');
  });

  it("sends the pair a pick makes, and the flag colours the box asks for", async () => {
    await openSaveWith(CHOSEN);
    drawnBy(() => page("overview"));

    drawnField(SwatchField, "Border").onPick("light_pink");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetEmpireMapColors",
        country: CHOSEN.id,
        colors: { border: "light_pink", fill: "light_pink" },
      }),
    );

    drawnField(ToggleField, "Use flag colours instead").onChange(true);
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetEmpireMapColors",
        country: CHOSEN.id,
        colors: null,
      }),
    );
  });

  it("names the mod the palette comes from, and that the save needs it", async () => {
    await openSaveWith(CHOSEN);
    useGameDataStore.setState({ mapColorSource: "More Colours" });

    const html = page("overview");
    expect(html).toContain("Palette: More Colours");
    expect(html).toContain("The save needs this mod to show these colours.");
  });
});
