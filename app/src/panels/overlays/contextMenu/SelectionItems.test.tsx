import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { bindStores } from "../../../store/bindStores";
import { useEditorStore } from "../../../store/editorStore";
import { OPEN_RESULT, SCENARIO_RESULT } from "../../../store/fixture";
import { armSession, resetStores } from "../../../store/storeFixture";
import { openWith } from "../../../test/session";
import { SelectionItems } from "./SelectionItems";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
  armSession();
});

/** The menu's items for `ids` selected, each as its text. */
async function items(kind: "save" | "scenario", ids: number[] | "all"): Promise<string[]> {
  await openWith(kind === "save" ? OPEN_RESULT : SCENARIO_RESULT);
  if (ids === "all") await useEditorStore.getState().selectAll();
  else await useEditorStore.getState().setSelection(ids, "replace");
  const html = renderToStaticMarkup(<SelectionItems dismiss={() => undefined} />);
  return [...html.matchAll(/<button type="button" role="menuitem"[^>]*>(.*?)<\/button>/g)].map(
    (m) => m[1].replace(/<[^>]*>/g, ""),
  );
}

describe("the system menu's items for a selection", () => {
  it("lists the lane items in their order, under their new names, with their counts", async () => {
    expect(await items("save", [0, 1, 2])).toEqual([
      "Link every pair (1)",
      expect.stringMatching(/^Link nearby \(\d+\)$/),
      "Cut lanes between them (2)",
      "Isolate them (3)",
      "Reset lane lengths (0)",
      "Arrange…",
    ]);
  });

  it("ends a scenario's list with the clan and the delete item", async () => {
    const listed = await items("scenario", [0, 1, 2]);
    expect(listed.slice(-3)).toEqual([
      "Make these marauder clan 1Replaces the three initializers, star class included",
      "Arrange…",
      "Delete systems (3)",
    ]);
    expect(listed).not.toContain("Reset lane lengths (0)");
  });

  it("turns Link every pair off past five systems, and says to link nearby instead", async () => {
    await openWith(SCENARIO_RESULT);
    await useEditorStore.getState().selectAll();
    const html = renderToStaticMarkup(<SelectionItems dismiss={() => undefined} />);
    expect(html).toMatch(
      /<button type="button" role="menuitem" disabled="" title="Every pair is for up to 5 systems; use Nearby.">Link every pair \(\d+\)<\/button>/,
    );
    expect(html).not.toContain("height-dot");
  });
});
