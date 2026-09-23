import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));
vi.mock("../useTextureUrl", () => ({ useTextureUrl: vi.fn(() => undefined) }));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useLayoutStore } from "../../store/layoutStore";
import { PAINT_CHECK } from "../../lib/paintCopy";
import { useOpenScreenStore } from "../../store/openScreenStore";
import { useRecentsStore, type RecentDoc } from "../../store/recentsStore";
import { buttons, saveFile, scenarioListing, shown } from "../../test/openRows";
import { OpenSave } from "./OpenSave";

beforeEach(() => {
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useGameDataStore.setState({ ...useGameDataStore.getInitialState(), status: "ready" });
  useLayoutStore.setState({ ...useLayoutStore.getInitialState() });
  useRecentsStore.setState({ recents: [] });
  useOpenScreenStore.setState({ ...useOpenScreenStore.getInitialState() });
});

describe("the open screen's footer", () => {
  it("carries New scenario and Browse as buttons, and names no keys", () => {
    const html = renderToStaticMarkup(<OpenSave modal={false} />);
    const foot = html.slice(html.indexOf("open-dialog-foot"));
    expect(buttons(foot)).toEqual(["New scenario…", "Browse…", "Open"]);
    expect(shown(html).match(/Browse…/g)).toHaveLength(1);
    expect(shown(foot)).not.toMatch(/Enter|Ctrl|↵|⇧/);
    expect(shown(html)).not.toContain(PAINT_CHECK);
  });

  it("offers Open as scenario only while a save is selected", () => {
    const recent: RecentDoc = {
      kind: "save",
      path: saveFile().path,
      title: "Terran Federation",
      subtitle: "",
      openedAt: 5,
    };
    useRecentsStore.setState({ recents: [recent] });
    expect(renderToStaticMarkup(<OpenSave modal={false} />)).toContain("Open as scenario");

    useOpenScreenStore.setState({ tab: "scenarios", scenarios: [scenarioListing()] });
    expect(renderToStaticMarkup(<OpenSave modal={false} />)).not.toContain("Open as scenario");
  });
});
