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
import { TilePicker } from "../../TilePicker";
import {
  CountryView,
  FLAG_NEEDS_GAME_DATA,
  FLAG_UNREADABLE,
  INDEPENDENT_MAP_COLOUR,
  MAP_COLORS_NEED_4_5,
} from "./CountryView";
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
  { name: "intense_red", map: "#e02020", flag: "#c01010", ship: "#e02020" },
  { name: "light_pink", map: "#f0b0c0", flag: "#d090a0", ship: "#f0b0c0" },
];

/** The 4.5 empire with a flag the save gives in full. */
const FLAGGED: CountryNode = {
  ...CHOSEN,
  colors: ["intense_red", "light_pink", "intense_red", "light_pink"],
  flag_icon: { category: "pointy", file: "flag_pointy_2.dds" },
  flag_background: { category: "backgrounds", file: "flag_bg_plain.dds" },
};

const FLAG_PARTS = {
  emblems: [
    {
      name: "pointy",
      files: [
        { file: "flag_pointy_2.dds", source: null },
        { file: "flag_pointy_3.dds", source: null },
      ],
    },
    { name: "extra_shapes", files: [{ file: "star.dds", source: "More Flags" }] },
    { name: "blocky", files: [{ file: "flag_blocky_1.dds", source: null }] },
  ],
  backgrounds: [
    { file: "flag_bg_plain.dds", source: null },
    { file: "flag_bg_stripes.dds", source: null },
  ],
};

/** The flag a pick sends: the empire's own with `change` made. */
const flagWith = (change: object) => ({
  type: "SetEmpireFlag",
  country: FLAGGED.id,
  flag: {
    icon_category: "pointy",
    icon_file: "flag_pointy_2.dds",
    background: "flag_bg_plain.dds",
    primary: "intense_red",
    secondary: "light_pink",
    ...change,
  },
});

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
    flagParts: FLAG_PARTS,
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
    expect(html).toContain(INDEPENDENT_MAP_COLOUR);
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
    expect(html).not.toContain(INDEPENDENT_MAP_COLOUR);
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
    expect(html).toMatch(/<input[^>]*checked/);
    expect(html).toContain("Palette: Stellaris");
    expect(html).not.toContain(MAP_COLORS_NEED_4_5);
  });

  it("shows the flag colours as plain text when independent map colour is off", async () => {
    await openSaveWith({ ...CHOSEN, use_map_color: false, painted_border: "red" });

    const html = page("overview");
    expect(html).not.toMatch(/<input[^>]*checked/);
    expect(html).not.toContain('aria-label="Border:');
    expect(html).toContain("unknown: red");
    expect(html).toContain("flag primary");
    expect(html).toContain("The map uses the flag&#x27;s primary and secondary colours.");
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

    drawnField(ToggleField, INDEPENDENT_MAP_COLOUR).onChange(false);
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

describe("an empire's flag fields", () => {
  it("shows the emblem, background and colours above the map colours", async () => {
    await openSaveWith(FLAGGED);

    const html = drawnBy(() => page("overview"));
    expect(html).toContain('aria-label="Flag"');
    expect(html.indexOf('aria-label="Flag"')).toBeLessThan(
      html.indexOf('aria-label="Map colours"'),
    );
    expect(html).toContain('aria-label="Emblem: flag_pointy_2"');
    expect(html).toContain('aria-label="Background: flag_bg_plain"');
    expect(html).toContain('aria-label="Primary: intense_red"');
    expect(html).toContain('aria-label="Secondary: light_pink"');
    expect(html).toContain("background:#c01010");
    expect(html).toContain("background:#d090a0");
    expect(html).not.toContain("The save needs More Flags");

    const emblem = drawnField(TilePicker, "Emblem");
    expect(emblem.current.textures).toEqual(["flag:pointy/flag_pointy_2.dds"]);
    expect(emblem.groups.map((g) => [g.label, g.section, g.note])).toEqual([
      ["blocky 1", undefined, undefined],
      ["pointy 2", undefined, undefined],
      ["extra shapes 1", "From mods", "More Flags"],
    ]);
    const background = drawnField(TilePicker, "Background");
    expect(background.groups).toHaveLength(1);
    expect(background.groups[0].items[1].textures).toEqual([
      "empire_flag:flag_bg_stripes.dds::intense_red,light_pink,intense_red,light_pink",
    ]);
  });

  it("names the mod an emblem comes from", async () => {
    await openSaveWith({ ...FLAGGED, flag_icon: { category: "extra_shapes", file: "star.dds" } });

    expect(page("overview")).toContain("The save needs More Flags to show this flag.");
  });

  it("shows disabled fields until game data is loaded", async () => {
    await openSaveWith(FLAGGED);
    useGameDataStore.setState({ flagParts: { emblems: [], backgrounds: [] } });

    const html = page("overview");
    expect(html).toContain(FLAG_NEEDS_GAME_DATA);
    expect(html).toContain(`title="${FLAG_NEEDS_GAME_DATA}" disabled=""`);
  });

  it("shows disabled fields for an empire whose flag the save does not give", async () => {
    await openSaveWith(CHOSEN);

    expect(page("overview")).toContain(FLAG_UNREADABLE);
  });

  it("sends the empire's flag with only the picked part changed", async () => {
    await openSaveWith(FLAGGED);
    drawnBy(() => page("overview"));

    drawnField(TilePicker, "Emblem").onPick("pointy/flag_pointy_3.dds");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith(
        flagWith({ icon_file: "flag_pointy_3.dds" }),
      ),
    );

    drawnField(TilePicker, "Background").onPick("flag_bg_stripes.dds");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith(
        flagWith({ background: "flag_bg_stripes.dds" }),
      ),
    );

    drawnField(SwatchField, "Secondary").onPick("intense_red");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith(flagWith({ secondary: "intense_red" })),
    );
  });

  it("sends nothing for a pick that leaves the flag as it is", async () => {
    await openSaveWith(FLAGGED);
    drawnBy(() => page("overview"));
    mockedIpc.applyOp.mockClear();

    drawnField(TilePicker, "Emblem").onPick("pointy/flag_pointy_2.dds");
    drawnField(SwatchField, "Primary").onPick("intense_red");
    drawnField(SwatchField, "Primary").onPick("light_pink");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith(flagWith({ primary: "light_pink" })),
    );
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
  });
});
