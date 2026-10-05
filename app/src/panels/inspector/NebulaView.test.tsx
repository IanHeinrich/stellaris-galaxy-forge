import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { bindStores } from "../../store/bindStores";
import { useEditorStore } from "../../store/editorStore";
import { open, resetStores } from "./inspectorFixture";
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
  it("shows its name as the file writes it, its centre, radius, members and the way to delete it", async () => {
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
    expect(html).toContain('aria-label="Nebula name"');
    // A cloud named by a localisation key shows the key: that is what a rename overwrites.
    expect(html).toContain('value="NAME_Cloud"');
  });

  it("waits for a nebula the galaxy no longer has", async () => {
    await open("save");

    expect(renderToStaticMarkup(<NebulaView index={7} />)).toContain("Loading nebula #7");
  });
});
