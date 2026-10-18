import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { DEFAULT_SYSTEM_HEIGHT } from "../../../generated/constants";
import { SAVE_CAPABILITIES } from "../../../lib/capabilities";
import { STARS_NEED_GAME_DATA } from "../../../lib/details/starClass";
import { DETAILS_DEBOUNCE_MS } from "../../../store/batching";
import { bindStores } from "../../../store/bindStores";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { SYSTEMS } from "../../../store/fixture";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { planetSummary, systemDetails } from "../../../test/builders";
import { editRow, open, patchSystem, resetStores } from "../inspectorFixture";
import { armStarClasses } from "../../../store/storeFixture";
import { SelectionView } from "./SelectionView";
import { mockedIpc } from "../../../test/ipc";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

/** The page's section titles, each after `# `, and its block titles, in the order the page shows them. */
function outline(html: string): string[] {
  return [
    ...html.matchAll(/class="ins-sec-title">(.*?)<\/span>|class="edit-block-title">(.*?)<\/div>/g),
  ].map((m) => (m[1] !== undefined ? `# ${m[1]}` : m[2]));
}

/** The attributes of the button whose whole text is `label`, or null for none. */
function button(html: string, label: string): string | null {
  const at = html.indexOf(`>${label}</button>`);
  if (at === -1) return null;
  return html.slice(html.lastIndexOf("<button", at), at);
}

const render = () => renderToStaticMarkup(<SelectionView />);

describe("several systems selected", () => {
  /** Sol, Alpha Centauri and Barnard: a chain, so two lanes run between them and none is isolated. */
  const CHAIN = [0, 1, 2];

  async function selectChain(kind: "save" | "scenario"): Promise<string> {
    await open(kind);
    await useEditorStore.getState().setSelection(CHAIN, "replace");
    return render();
  }

  it("groups a save's tools into Hyperlanes, Position and Set for all, then the systems", async () => {
    const html = await selectChain("save");
    expect(outline(html)).toEqual([
      "# Hyperlanes",
      "Add lanes",
      "Remove lanes",
      "Lengths",
      "# Position",
      "Rotate",
      "Height",
      "Shape",
      "# Set for all 3",
      "Stars",
      "# Systems · 3",
    ]);
    expect(html).toContain("Reset lane lengths (0)");
    expect(html).toContain(">Arrange in a shape…</button>");
    expect(html).not.toContain("Initializer");
    expect(html).not.toContain("Delete");
  });

  it("groups a scenario's tools the same way, with Scripts, and the delete button last", async () => {
    const html = await selectChain("scenario");
    expect(html).toContain("3 systems selected");
    expect(html).toContain("2 lanes between them · 0 owners · 0 isolated");
    expect(outline(html)).toEqual([
      "# Hyperlanes",
      "Add lanes",
      "Remove lanes",
      "# Position",
      "Rotate",
      "Shape",
      "# Set for all 3",
      "Scripts",
      "# Systems · 3",
    ]);
    expect(html).toContain('aria-label="Initializer: Choose…"');
    expect(html).toContain("Make these marauder clan 1");
    expect(html).toMatch(
      /<div class="ins-delete"><button type="button">Delete 3 systems<\/button><\/div>$/,
    );
    expect(html).not.toContain("Reset lane lengths");
    expect(html).not.toContain("Also in the right-click menu");
    expect(html).toMatch(/title="Remove [^"]+ from the selection"/);
    expect(html).not.toContain("Filter the selection");
  });

  it("counts the lanes each action changes", async () => {
    const html = await selectChain("scenario");
    expect(html).toContain('aria-pressed="true">Every pair</button>');
    expect(button(html, "Add 1 lane")).not.toContain("disabled");
    expect(html).toContain("Cut lanes between them (2)");
    expect(html).toContain("Isolate them (3)");
    expect(html).not.toContain("Density");
  });

  it("offers Every pair up to five systems, else Nearby with its density and the game's grouping", async () => {
    await open("scenario");
    await useEditorStore.getState().selectAll();
    const html = render();
    expect(button(html, "Every pair")).toContain('disabled=""');
    expect(button(html, "Every pair")).toContain(
      'title="Every pair is for up to 5 systems; use Nearby."',
    );
    expect(html).toContain('aria-pressed="true">Nearby</button>');
    expect(html).toContain('<span class="edit-label">Density</span>');
    expect(html).toContain('aria-label="Lane density"');
    expect(html).toMatch(/<input type="checkbox" checked=""\/>Like the game<\/label>/);
    expect(html).toMatch(/>Add \d+ lanes<\/button>/);
  });

  it("offers the wormhole pair for exactly two systems", async () => {
    await open("save");
    await useEditorStore.getState().setSelection([0, 2], "replace");
    const html = render();
    expect(outline(html)).toContain("Wormholes");
    expect(html).toContain(">Link as wormhole pair</button>");
  });

  it("counts one lane and one owner in the singular", async () => {
    await selectChain("scenario");
    patchSystem(0, { owner: 7 });
    await useEditorStore.getState().setSelection([0, 1], "replace");
    expect(render()).toContain("1 lane between them · 1 owner ·");
  });

  it("leaves Set for all out where the document sets neither stars nor initializers", async () => {
    await open("save");
    useFileSessionStore.setState({ capabilities: { ...SAVE_CAPABILITIES, bodies: false } });
    await useEditorStore.getState().setSelection(CHAIN, "replace");
    expect(outline(render())).not.toContain("# Set for all 3");
  });
});

describe("the bulk star class", () => {
  const CHAIN = [0, 1, 2];
  const STARS: Record<number, string[]> = {
    0: ["pc_g_star"],
    1: ["pc_a_star", "pc_pulsar"],
    2: ["pc_m_star"],
  };

  const CLASSES = {
    sc_g: ["pc_g_star"],
    sc_m: ["pc_m_star"],
    sc_pulsar: ["pc_pulsar"],
    sc_binary_1: ["pc_a_star", "pc_pulsar"],
  };

  async function landChain(): Promise<void> {
    mockedIpc.getSystemDetails.mockResolvedValue(
      CHAIN.map((id) =>
        systemDetails({
          id,
          with_game_data: true,
          planets: STARS[id].map((cls, i) => planetSummary({ id: id * 10 + i, class: cls })),
        }),
      ),
    );
    useDetailsStore.getState().request(CHAIN);
    await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);
  }

  it("offers a star class picker for a save selection without reading its details", async () => {
    armStarClasses(CLASSES, { sc_pulsar: "Pulsar" });
    await open("save");
    await useEditorStore.getState().setSelection(CHAIN, "replace");
    mockedIpc.getSystemDetails.mockClear();

    const html = render();
    await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);
    expect(editRow(html, "Star class")).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-label="Star class: Choose…"');
    expect(mockedIpc.getSystemDetails).not.toHaveBeenCalled();
  });

  it("is not offered on a scenario", async () => {
    armStarClasses(CLASSES, { sc_pulsar: "Pulsar" });
    await open("scenario");
    await useEditorStore.getState().setSelection(CHAIN, "replace");
    await landChain();
    const html = render();
    expect(html).not.toContain("Star class");
    expect(html).not.toContain('aria-haspopup="listbox"');
  });

  it("says a star edit needs game data while none is loaded", async () => {
    await open("save");
    useGameDataStore.setState({ status: "idle" });
    await useEditorStore.getState().setSelection(CHAIN, "replace");

    expect(render()).toContain(`title="${STARS_NEED_GAME_DATA}"`);
  });
});

describe("the rotate block", () => {
  async function selectThree(): Promise<void> {
    await open("scenario");
    await useEditorStore.getState().setSelection([0, 1, 2], "replace");
  }

  it("offers an angle with its Rotate button, the quick turns and the nebulae choice, ticked", async () => {
    await selectThree();
    const html = render();
    const degrees = editRow(html, "Degrees");
    expect(degrees).toContain('aria-label="Degrees"');
    expect(degrees).toContain('value="45"');
    expect(degrees).toContain(">Rotate</button>");
    const quick = editRow(html, "Quick");
    expect(quick.indexOf("90° left")).toBeLessThan(quick.indexOf("90° right"));
    expect(quick).toContain("180°");
    expect(html).toMatch(/<input type="checkbox" checked=""\/>Nebulae too<\/label>/);
    expect(html).toContain("Or drag the handle on the map. Shift snaps to 15°.");
    expect(html).not.toContain('<span class="edit-label">Pivot</span>');
  });

  it("shows the nebulae choice as the store holds it", async () => {
    await selectThree();
    useEditorStore.getState().setRotateNebulae(false);
    expect(render()).toMatch(/<input type="checkbox"\/>Nebulae too/);
  });

  it("offers to centre the pivot only once it has been moved", async () => {
    await selectThree();
    useEditorStore.getState().setRotatePivot({ x: 10, y: 20 });
    const pivot = editRow(render(), "Pivot");
    expect(pivot).toContain("moved");
    expect(pivot).toContain(">Centre</button>");
  });
});

describe("the marauder clan button", () => {
  /** The button's markup: its label, the hint under it, and whether it is disabled. */
  function clanButton(html: string) {
    const m = html.match(
      /<button([^>]*)>((?:Add|Make these) marauder clan[^<]*)<span class="muted">([^<]*)<\/span><\/button>/,
    );
    if (m === null) return null;
    return { label: m[2], hint: m[3], disabled: m[1].includes("disabled="), title: m[1] };
  }

  async function selectOn(kind: "save" | "scenario", ids: number[]): Promise<string> {
    await open(kind);
    await useEditorStore.getState().setSelection(ids, "replace");
    return render();
  }

  it("makes three selected scenario systems the next free clan, the one linked to both others as home", async () => {
    const html = await selectOn("scenario", [0, 1, 2]);
    expect(clanButton(html)).toMatchObject({
      label: "Make these marauder clan 1",
      hint: "Replaces the three initializers, star class included",
      disabled: false,
    });
    expect(clanButton(html)!.title).toContain(
      'title="Replaces the three initializers, star class included"',
    );
  });

  it("refuses three systems none of which is linked to the other two, and says why", async () => {
    const html = await selectOn("scenario", [0, 2, 3]);
    expect(clanButton(html)).toMatchObject({
      label: "Make these marauder clan 1",
      hint: "The home needs a hyperlane to both outposts",
      disabled: true,
    });
  });

  it("refuses once all three clans are placed, and says so", async () => {
    await open("scenario");
    useGalaxyStore.getState().applyDelta({
      systems: [3, 4, 5].map((id, i) => ({
        ...SYSTEMS[id],
        initializer: `marauder_${i + 1}_1`,
        marauder: { home: i + 1 },
      })),
    });
    await useEditorStore.getState().setSelection([0, 1, 2], "replace");
    expect(clanButton(render())).toMatchObject({
      label: "Add marauder clan",
      hint: "All three clans are placed",
      disabled: true,
    });
  });

  it("is absent with any other number selected, and on a save", async () => {
    expect(clanButton(await selectOn("scenario", [0, 1]))).toBeNull();
    expect(clanButton(await selectOn("scenario", [0, 1, 2, 3]))).toBeNull();
    expect(clanButton(await selectOn("save", [0, 1, 2]))).toBeNull();
  });
});

describe("the height block", () => {
  /** A save with systems 0, 1 and 2 selected: flat with no height, 50 above the plane, 20 below. */
  async function selectHeights(heights = true): Promise<string> {
    await open("save");
    useFileSessionStore.setState({
      capabilities: { ...SAVE_CAPABILITIES, system_heights: heights },
    });
    useGalaxyStore.getState().applyDelta({
      systems: [
        SYSTEMS[0],
        { ...SYSTEMS[1], height: DEFAULT_SYSTEM_HEIGHT + 50 },
        { ...SYSTEMS[2], height: DEFAULT_SYSTEM_HEIGHT - 20 },
      ],
    });
    await useEditorStore.getState().setSelection([0, 1, 2], "replace");
    return render();
  }

  const dots = (html: string) =>
    [...html.matchAll(/<circle class="height-dot"[^>]*fill="([^"]*)"/g)].map((m) => m[1]);

  it("places one dot per selected system, tinted apart by its height, and counts the ones to flatten", async () => {
    const html = await selectHeights();
    expect(dots(html)).toHaveLength(3);
    expect(new Set(dots(html)).size).toBe(3);
    expect(html).toContain('role="group" aria-label="Height"');
    expect(html).toContain('aria-pressed="true">Set to</button>');
    expect(html).toContain(">Raise by</button>");
    expect(html).toContain(">Lower by</button>");
    expect(html).toContain(
      '>Apply</button><button type="button" title="Back to the game&#x27;s default height">Flatten (2)</button>',
    );
  });

  it("is absent where the document takes no heights", async () => {
    const html = await selectHeights(false);
    expect(html).not.toContain("height-dot");
    expect(outline(html)).not.toContain("Height");
  });
});
