import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CountryNode } from "../../../generated/CountryNode";
import type { OpenResult } from "../../../generated/OpenResult";
import { name, OPEN_RESULT } from "../../../store/fixture";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The emblem comes from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import * as ipc from "../../../api/ipc";
import { bindStores } from "../../../store/bindStores";
import { useEditorStore } from "../../../store/editorStore";
import { useEntityStore } from "../../../store/entityStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry, type InspectorTab } from "../../../store/inspectorStore";
import { CountryView, MAP_COLORS_NEED_4_5, MapColorFields } from "./CountryView";

bindStores();

/** An empire of a 4.4 save: its four flag colours and no map colours. */
const EMPIRE: CountryNode = {
  id: 7,
  name: name("NAME_Test_Empire"),
  name_key: "NAME_Test_Empire",
  country_type: "default",
  capital_system: 1,
  system_count: 2,
  colors: ["fixture_blue", "fixture_blue"],
  border_color: null,
  fill_color: null,
  flag_colors: ["red", "purple", "black", "grey"],
  use_map_color: false,
  flag_icon: null,
  flag_background: null,
};

/** The same empire in a 4.5 save, with a map border and fill of its own. */
const CHOSEN: CountryNode = {
  ...EMPIRE,
  flag_colors: ["red", "purple", "black", "grey", "intense_red", "light_pink"],
  use_map_color: true,
};

const PALETTE = [
  { name: "intense_red", map: "#e02020", flag: "#e02020", ship: "#e02020" },
  { name: "light_pink", map: "#f0b0c0", flag: "#f0b0c0", ship: "#f0b0c0" },
];

const PAGE: Entry = { ref: { kind: "country", id: EMPIRE.id }, label: "Test Empire" };

async function openSaveWith(country: CountryNode): Promise<void> {
  const result: OpenResult & { path: string } = {
    ...OPEN_RESULT,
    galaxy: { ...OPEN_RESULT.galaxy, countries: [country] },
  };
  vi.mocked(ipc.openSave).mockResolvedValue(result);
  await useFileSessionStore.getState().openSave(result.path);
}

/** The country's page on `tab`, drilled onto from a system as the stack always has one under it. */
function page(tab: InspectorTab): string {
  useInspectorStore.setState({
    stack: [{ ref: { kind: "system", id: 1 }, label: "Sol" }, PAGE],
    tab,
  });
  return renderToStaticMarkup(<CountryView entry={PAGE} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useGalaxyStore.getState().clear();
  useEntityStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useInspectorStore.setState({ ...useInspectorStore.getInitialState() });
  useGameDataStore.setState({
    ...useGameDataStore.getInitialState(),
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
  const fields = (country: CountryNode) =>
    renderToStaticMarkup(<MapColorFields country={country} />);

  it("shows the current border and fill with their swatches, and the game's palette", () => {
    const html = fields(CHOSEN);
    expect(html).toContain("Map colours");
    expect(html).toContain('aria-label="Border: intense_red"');
    expect(html).toContain('aria-label="Fill: light_pink"');
    expect(html).toContain("background:#e02020");
    expect(html).toContain("background:#f0b0c0");
    expect(html).toContain("Use flag colours instead");
    expect(html).not.toMatch(/<input[^>]*checked/);
    expect(html).toContain("Palette: Stellaris");
    expect(html).not.toContain(MAP_COLORS_NEED_4_5);
  });

  it("ticks the flag colours box when map colours are off, and names a colour it cannot find", () => {
    const html = fields({
      ...CHOSEN,
      flag_colors: [...CHOSEN.flag_colors.slice(0, 4), "red", "purple"],
      use_map_color: false,
    });
    expect(html).toMatch(/<input[^>]*checked/);
    expect(html).toContain('aria-label="Border: unknown: red"');
  });

  it("asks for a 4.5 save when the empire has only its four flag colours", () => {
    const html = fields(EMPIRE);
    expect(html).toContain(MAP_COLORS_NEED_4_5);
    expect(html).toContain('aria-label="Border: none"');
    expect(html).not.toContain("Palette:");
  });

  it("names the mod the palette comes from, and that the save needs it", () => {
    useGameDataStore.setState({ mapColorSource: "More Colours" });

    const html = fields(CHOSEN);
    expect(html).toContain("Palette: More Colours");
    expect(html).toContain("The save needs this mod to show these colours.");
  });
});
