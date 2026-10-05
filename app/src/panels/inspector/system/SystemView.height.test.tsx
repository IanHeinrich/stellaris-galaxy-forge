import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detailOf } from "../../../store/fixture";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { DEFAULT_SYSTEM_HEIGHT } from "../../../generated/constants";
import { SAVE_CAPABILITIES } from "../../../lib/capabilities";
import { bindStores } from "../../../store/bindStores";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useHeightPreviewStore } from "../../../store/heightPreviewStore";
import { open, overview, resetStores, SYSTEM } from "../inspectorFixture";
import { mockedIpc } from "../../../test/ipc";
import { heightToSlider } from "../../../lib/height";
import { HEIGHT_HINT } from "./SystemHeight";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("the height row", () => {
  /** The overview of `SYSTEM` at `height`, none for no key, in a save that may take heights. */
  async function overviewAt(height?: number, heights = true): Promise<string> {
    mockedIpc.getSystem.mockImplementation(async (id) => {
      const detail = detailOf(id);
      return height === undefined ? detail : { ...detail, system: { ...detail.system, height } };
    });
    await open("save");
    useFileSessionStore.setState({
      capabilities: { ...SAVE_CAPABILITIES, system_heights: heights },
    });
    return overview();
  }

  const flatButton = (html: string) => html.match(/<button[^>]*>Flat<\/button>/)?.[0] ?? null;

  it("shows the height above the plane under the position, with what 0 means", async () => {
    const html = await overviewAt(DEFAULT_SYSTEM_HEIGHT + 50);
    expect(html).toMatch(
      /<input type="range" min="-1" max="1" step="any" aria-label="Height slider"/,
    );
    expect(html).toContain(`value="${heightToSlider(50)}"`);
    expect(html).toContain('aria-label="Height" value="50.00"');
    expect(flatButton(html)).not.toContain("disabled");
    expect(html).toContain(HEIGHT_HINT.replace("'", "&#x27;"));
  });

  it("reads a system with no height as flat, its Flat button disabled", async () => {
    const html = await overviewAt();
    expect(html).toContain('aria-label="Height slider" aria-valuetext="0" value="0"');
    expect(flatButton(html)).toContain("disabled");
  });

  it("shows a previewed height while the slider is held, to one decimal", async () => {
    await overviewAt(DEFAULT_SYSTEM_HEIGHT + 50);
    useHeightPreviewStore.getState().show(SYSTEM, 12.3);
    const html = overview();
    expect(html).toContain(`aria-valuetext="12.3" value="${heightToSlider(12.3)}"`);
    expect(html).toContain('aria-label="Height" value="12.3"');
    useHeightPreviewStore.getState().clear();
  });

  it("shows the stored height while the height brush previews the system", async () => {
    await overviewAt(DEFAULT_SYSTEM_HEIGHT + 50);
    useHeightPreviewStore.getState().showBrush(new Map([[SYSTEM, 99]]));
    const html = overview();
    expect(html).toContain(`aria-valuetext="50" value="${heightToSlider(50)}"`);
    expect(html).toContain('aria-label="Height" value="50.00"');
    useHeightPreviewStore.getState().showBrush(new Map());
  });

  it("is hidden where the document takes no heights", async () => {
    const html = await overviewAt(DEFAULT_SYSTEM_HEIGHT + 50, false);
    expect(html).toContain('role="group" aria-label="Position"');
    expect(html).not.toContain("Height slider");
    expect(flatButton(html)).toBeNull();
    expect(html).not.toContain("galaxy plane");
  });
});
