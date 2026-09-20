import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import * as ipc from "../../api/ipc";
import type { OpenResult } from "../../generated/OpenResult";
import { PAINT_ORIGIN, PAINT_READY, paintEmbedUrl } from "../../lib/paint";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { SCENARIO_RESULT } from "../../store/fixture";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useLayoutStore } from "../../store/layoutStore";
import { PaintGalaxyPanel } from "./PaintGalaxyPanel";
import { receivePaintMessage } from "./paintMessage";

const mocked = {
  openScenarioText: vi.mocked(ipc.openScenarioText),
  closeSave: vi.mocked(ipc.closeSave),
  warmDetails: vi.mocked(ipc.warmDetails),
  getSpecialSystems: vi.mocked(ipc.getSpecialSystems),
  getScenarioOwners: vi.mocked(ipc.getScenarioOwners),
};

const galaxy = { source: "paint-a-galaxy", type: "galaxy", version: 1, name: "Spiral", txt: "x" };
const ready = { source: "paint-a-galaxy", type: "ready", version: 1 };

const site = { postMessage: vi.fn() };
const frame = { contentWindow: site } as unknown as HTMLIFrameElement;

/** What the window hears: by default the site itself, from its own origin. */
const message = (data: unknown, origin = PAINT_ORIGIN, source: unknown = site) =>
  ({ data, origin, source }) as unknown as MessageEvent;

const session = () => useFileSessionStore.getState();
const layout = () => useLayoutStore.getState();

/** The open the store runs on a message has a tick of its own to land. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
  useLayoutStore.setState({ ...useLayoutStore.getInitialState(), paintPanel: true });
  mocked.openScenarioText.mockResolvedValue({ ...SCENARIO_RESULT, path: null });
  mocked.closeSave.mockResolvedValue();
  mocked.warmDetails.mockResolvedValue();
  mocked.getSpecialSystems.mockResolvedValue({ systems: [], counts: [], with_game_data: false });
  mocked.getScenarioOwners.mockResolvedValue(null);
});

describe("the panel", () => {
  it("embeds the site in embedded mode, in the focus trap, and says what Send does", () => {
    const html = renderToStaticMarkup(<PaintGalaxyPanel />);
    expect(html).toContain("Paint a Galaxy by Oatmeal Problem");
    expect(html).toContain("Open in browser");
    expect(html).toContain("Send to Stellaris Galaxy Forge");
    expect(html).toContain(`src="${paintEmbedUrl().replace(/&/g, "&amp;")}"`);
    expect(html).toContain('title="Paint a Galaxy"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(html).toContain('allow="clipboard-write"');
    expect(html).not.toContain("sandbox");
  });
});

describe("a message from the site", () => {
  it("opens the galaxy it sends as an unsaved scenario, then closes the panel", async () => {
    let land!: (result: OpenResult) => void;
    mocked.openScenarioText.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    receivePaintMessage(message(galaxy), frame);
    await settled();
    expect(mocked.openScenarioText).toHaveBeenCalledWith("x");
    expect(session().status).toBe("loading");
    expect(session().loadingName).toBe("Spiral");
    expect(layout().paintPanel).toBe(true);

    land({ ...SCENARIO_RESULT, path: null });
    await settled();
    expect(session().status).toBe("ready");
    expect(session().kind).toBe("scenario");
    expect(session().path).toBeNull();
    expect(session().title).toBe(SCENARIO_RESULT.title);
    expect(layout().paintPanel).toBe(false);
  });

  it("keeps the panel when the open is refused", async () => {
    useFileSessionStore.setState({ saving: true });
    receivePaintMessage(message(galaxy), frame);
    await settled();
    expect(mocked.openScenarioText).not.toHaveBeenCalled();
    expect(session().kind).toBeNull();
    expect(layout().paintPanel).toBe(true);
  });

  it("answers ready with this app's own ready, to the site's origin only", async () => {
    receivePaintMessage(message(ready), frame);
    await settled();
    expect(site.postMessage).toHaveBeenCalledWith(PAINT_READY, PAINT_ORIGIN);
    expect(mocked.openScenarioText).not.toHaveBeenCalled();
    expect(layout().paintPanel).toBe(true);
  });

  it("ignores any other origin, any other window, and any other message", async () => {
    receivePaintMessage(message(galaxy, "https://example.com"), frame);
    receivePaintMessage(message(galaxy, PAINT_ORIGIN, { postMessage: vi.fn() }), frame);
    receivePaintMessage(message(galaxy), null);
    receivePaintMessage(message({ ...galaxy, type: "export" }), frame);
    receivePaintMessage(message(ready, "https://example.com"), frame);
    await settled();
    expect(mocked.openScenarioText).not.toHaveBeenCalled();
    expect(site.postMessage).not.toHaveBeenCalled();
    expect(session().status).toBe("empty");
    expect(layout().paintPanel).toBe(true);
  });
});
