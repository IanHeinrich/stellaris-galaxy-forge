import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { bindStores } from "../../store/bindStores";
import { useEditorStore } from "../../store/editorStore";
import { mocked, open, resetStores } from "./inspectorFixture";
import { NEBULA_RADIUS_INPUT_ID } from "../nebula";
import { NebulaView } from "./NebulaView";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

/** The nebula view's read-only centre, as the `x` and `y` rows render it. */
function centre(html: string): Record<string, string> {
  const rows = html.matchAll(/<span class="k">([xy])<\/span><span class="mono">([^<]*)<\/span>/g);
  return Object.fromEntries([...rows].map((m) => [m[1], m[2]]));
}

describe("a selected nebula", () => {
  it("shows its centre, an editable radius, a chip per member and the way to delete it", async () => {
    await open("save");
    useEditorStore.getState().selectNebula(0);

    const html = renderToStaticMarkup(<NebulaView index={0} />);
    expect(html).toContain("Cloud");
    expect(centre(html)).toEqual({ x: "-40.00", y: "40.00" });
    expect(html).toContain(`id="${NEBULA_RADIUS_INPUT_ID}"`);
    expect(html).toContain('aria-label="Radius"');
    expect(html).toContain('value="20"');
    expect(html).toContain("1 system<");
    expect(html).toContain('title="Jump to #5"');
    expect(html).toContain("Deneb");
    expect(html).toContain("Delete nebula");
  });

  it("shows the name the file writes and renames the cloud on commit", async () => {
    await open("save");
    useEditorStore.getState().selectNebula(0);

    const html = renderToStaticMarkup(<NebulaView index={0} />);
    expect(html).toContain('aria-label="Nebula name"');
    // A cloud named by a localisation key shows the key: that is what a rename overwrites.
    expect(html).toContain('value="NAME_Cloud"');

    await useEditorStore.getState().setNebulaName(0, "Sea of Ghosts");

    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "SetNebulaName",
      index: 0,
      name: "Sea of Ghosts",
    });
  });

  it("waits for a nebula the galaxy no longer has", async () => {
    await open("save");

    expect(renderToStaticMarkup(<NebulaView index={7} />)).toContain("Loading nebula #7");
  });

  it("names what leaves the cloud before removing it, and sends nothing when declined", async () => {
    await open("save");
    mocked.confirm.mockResolvedValueOnce(false);

    await useEditorStore.getState().removeNebula(0);

    expect(mocked.confirm).toHaveBeenCalledWith(
      "Delete Cloud? 1 system will leave it.",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mocked.applyOp).not.toHaveBeenCalled();

    mocked.confirm.mockResolvedValueOnce(true);
    await useEditorStore.getState().removeNebula(0);

    expect(mocked.applyOp).toHaveBeenCalledWith({ type: "RemoveNebula", index: 0 });
  });
});
