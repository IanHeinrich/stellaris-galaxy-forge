import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("zustand", () => import("../test/zustandSnapshot"));

import { DEFAULT_SYSTEM_HEIGHT } from "../generated/constants";
import { SAVE_CAPABILITIES } from "../lib/capabilities";
import { bindStores } from "../store/bindStores";
import { useEditorStore } from "../store/editorStore";
import { useFileSessionStore } from "../store/fileSessionStore";
import { OPEN_RESULT, SCENARIO_RESULT, SYSTEMS } from "../store/fixture";
import { useGalaxyStore } from "../store/galaxyStore";
import { armSession, resetStores } from "../store/storeFixture";
import { openWith } from "../test/session";
import { BulkActions } from "./BulkActions";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
  armSession();
});

const open = (kind: "save" | "scenario") =>
  openWith(kind === "save" ? OPEN_RESULT : SCENARIO_RESULT);

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
    return renderToStaticMarkup(<BulkActions />);
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
    expect(clanButton(renderToStaticMarkup(<BulkActions />))).toMatchObject({
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

describe("the height group", () => {
  /** A save with systems 0, 1 and 2 selected: flat with no height, 50 above the plane, 20 below. */
  async function selectHeights(heights = true): Promise<void> {
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
  }

  const dots = (html: string) =>
    [...html.matchAll(/<circle class="height-dot"[^>]*fill="([^"]*)"/g)].map((m) => m[1]);

  it("places one dot per selected system, tinted apart by its height, and counts the ones to flatten", async () => {
    await selectHeights();
    const html = renderToStaticMarkup(<BulkActions />);
    expect(dots(html)).toHaveLength(3);
    expect(new Set(dots(html)).size).toBe(3);
    expect(html).toContain('role="group" aria-label="Height"');
    expect(html).toContain('aria-pressed="true">Set to</button>');
    expect(html).toContain(">Raise by</button>");
    expect(html).toContain(">Lower by</button>");
    expect(html).toContain('<button type="button">Flatten (2)</button>');
    expect(html).toContain("Back to the game&#x27;s default height");
  });

  it("is absent where the document takes no heights, and from the right-click menu", async () => {
    await selectHeights(false);
    expect(renderToStaticMarkup(<BulkActions />)).not.toContain("height-dot");

    await selectHeights();
    expect(renderToStaticMarkup(<BulkActions itemRole="menuitem" />)).not.toContain("height-dot");
  });
});
