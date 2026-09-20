import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { gameDataSummary } from "../../store/fixture";
import { useGameDataStore } from "../../store/gameDataStore";
import { PaintBadge } from "./PaintBadge";

const badge = () => renderToStaticMarkup(<PaintBadge />);

/** The loaded game data, with the mods the launcher's playset holds. */
function withMods(mods: { id: string; name: string }[]): void {
  useGameDataStore.setState({
    status: "ready",
    summary: gameDataSummary({ mods: mods.map((m) => ({ ...m, dir: null, status: "loaded" })) }),
  });
}

beforeEach(() => {
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
});

describe("the Paint a Galaxy badge", () => {
  it("is absent for a plain document", () => {
    withMods([]);
    expect(badge()).toBe("");
  });

  it("names the profile when the playset has the mod", () => {
    useFileSessionStore.setState({ paintProfile: true });
    withMods([{ id: "ugc_3532904115", name: "Paint a Galaxy" }]);

    const html = badge();
    expect(html).toContain(">Paint a Galaxy</span>");
    expect(html).toContain('class="badge paint-badge"');
    expect(html).toContain('title="Spawn points are written for the Paint a Galaxy mod"');
    expect(html).not.toContain("not enabled");
  });

  it("warns when the loaded game data says the playset lacks the mod", () => {
    useFileSessionStore.setState({ paintProfile: true });
    withMods([{ id: "ugc_1", name: "UI Overhaul" }]);

    const html = badge();
    expect(html).toContain("⚠ Paint a Galaxy mod not enabled");
    expect(html).toContain('class="badge warn paint-badge"');
    expect(html).toContain("Steam Workshop 3532904115");
    expect(html).toContain("not among the mods enabled in your Stellaris launcher playset");
    expect(html).toContain("Its spawn points are read only with that mod enabled.");
  });

  it("does not warn while no game data is loaded, since unknown is not missing", () => {
    useFileSessionStore.setState({ paintProfile: true });

    const html = badge();
    expect(html).toContain(">Paint a Galaxy</span>");
    expect(html).not.toContain("not enabled");
  });
});
