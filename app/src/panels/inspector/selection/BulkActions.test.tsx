import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { bindStores } from "../../../store/bindStores";
import { useEditorStore } from "../../../store/editorStore";
import { SYSTEMS } from "../../../store/fixture";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { open, resetStores } from "../inspectorFixture";
import { BulkActions } from "./BulkActions";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
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
      hint: "The home needs a hyperlane to both bases",
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
