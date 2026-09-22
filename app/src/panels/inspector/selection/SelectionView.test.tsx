import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { bindStores } from "../../../store/bindStores";
import { useEditorStore } from "../../../store/editorStore";
import { open, resetStores } from "../inspectorFixture";
import { SelectionView } from "./SelectionView";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("several systems selected", () => {
  /** Sol, Alpha Centauri and Barnard: a chain, so two lanes run between them and none is isolated. */
  const CHAIN = [0, 1, 2];

  async function selectChain(kind: "save" | "scenario"): Promise<string> {
    await open(kind);
    await useEditorStore.getState().setSelection(CHAIN, "replace");
    return renderToStaticMarkup(<SelectionView />);
  }

  it("lists the bulk actions with their counts, and each chip removes its system", async () => {
    const html = await selectChain("scenario");
    expect(html).toContain("3 systems selected");
    expect(html).toContain("2 lanes between them · 0 owners · 0 isolated");
    expect(html).toContain("Connect to each other (1)");
    expect(html).toContain("Cut hyperlanes between (2)");
    expect(html).toContain("Isolate (3)");
    expect(html).toContain("Set initializer… (3 systems)");
    expect(html).toContain("Systems · 3");
    expect(html).toMatch(/title="Remove [^"]+ from the selection"/);
    expect(html).not.toContain("Filter the selection");
    expect(html).not.toContain("Jump to");
  });

  it("offers no initializer on a save, whose systems cannot take one", async () => {
    const html = await selectChain("save");
    expect(html).toContain("Isolate (3)");
    expect(html).toContain("Reset lane lengths");
    expect(html).not.toContain("Set initializer");
  });
});
