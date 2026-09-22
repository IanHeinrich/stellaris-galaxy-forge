import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { elements } from "../../test/elements";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));
vi.mock("./GameDataPanel", () => ({ GameDataPanel: () => "[game data]" }));

import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { OPEN_RESULT, exportReport, saveResult } from "../../store/fixture";
import { StatusBar } from "./StatusBar";

const bar = () => renderToStaticMarkup(<StatusBar />);

/** The bar's button reading `label`, whose `onClick` a test calls in place of a click. */
function button(label: string): ReactElement<{ onClick(): void }> | undefined {
  return elements(<StatusBar />).find(
    (el): el is ReactElement<{ onClick(): void }> =>
      el.type === "button" && renderToStaticMarkup(el).includes(label),
  );
}

beforeEach(() => {
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState(), status: "ready" });
  useGalaxyStore.getState().clear();
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
});

describe("the saved state", () => {
  it("says the clock time the save landed and keeps the backup path in the tooltip", () => {
    useFileSessionStore.setState({
      dirty: false,
      savedAt: new Date(2026, 8, 19, 14, 2).getTime(),
      lastSave: {
        path: "C:/saves/terran.sav",
        cloud: false,
        backup_path: "C:/saves/terran.sav.bak",
        dirty: false,
      },
    });

    const html = bar();
    expect(html).toContain("Saved 14:02");
    expect(html).toContain('title="Backup: C:/saves/terran.sav.bak"');
    expect(html).not.toContain("backup terran");
  });

  it("says when the export landed, with its own backup and what it left out in the tooltip", () => {
    const dropped = exportReport({ dropped: { wormhole_pairs: 6, gateways: 0, lgates: 1 } });
    const plain = saveResult({ path: "C:/mods/x.txt", dirty: true });
    const backedUp = saveResult({ path: "C:/mods/x.txt", backup_path: "C:/mods/x.txt.bak" });
    useFileSessionStore.setState({
      dirty: true,
      exportedAt: new Date(2026, 8, 19, 12, 3).getTime(),
      lastExport: { save: plain, report: dropped },
    });
    let html = bar();
    expect(html).toContain("Exported 12:03");
    expect(html).not.toContain("Saved");
    expect(html).toContain('title="Not carried over: 6 wormhole pairs, 1 L-Gate"');

    useFileSessionStore.setState({ lastExport: { save: backedUp, report: dropped } });
    expect(bar()).toContain(
      'title="Backup: C:/mods/x.txt.bak\nNot carried over: 6 wormhole pairs, 1 L-Gate"',
    );

    useFileSessionStore.setState({ lastExport: { save: backedUp, report: exportReport() } });
    html = bar();
    expect(html).toContain("Exported 12:03");
    expect(html).toContain('title="Backup: C:/mods/x.txt.bak"');

    useFileSessionStore.setState({ lastExport: { save: plain, report: exportReport() } });
    html = bar();
    expect(html).toContain("Exported 12:03");
    expect(html).not.toContain("title=");

    useFileSessionStore.setState({
      lastExport: { save: plain, report: exportReport({ fallen_empire_zones: 5 }) },
    });
    html = bar();
    expect(html).toContain('title="Fallen empire zones: 5 automatic"');
  });

  it("keeps the save's backup and the export's apart", () => {
    useFileSessionStore.setState({
      dirty: false,
      savedAt: new Date(2026, 8, 19, 14, 2).getTime(),
      lastSave: saveResult({ path: "C:/saves/terran.sav", backup_path: "C:/saves/terran.sav.bak" }),
      exportedAt: new Date(2026, 8, 19, 14, 5).getTime(),
      lastExport: { save: saveResult({ path: "C:/mods/x.txt" }), report: exportReport() },
    });
    const html = bar();
    expect(html).toContain('title="Backup: C:/saves/terran.sav.bak">Saved 14:02');
    expect(html).toContain('<span class="muted">Exported 14:05');
  });
});

describe("the game data control", () => {
  it("closes the bar, with a document open or not", () => {
    expect(bar()).toMatch(/\[game data\]<\/footer>$/);

    useFileSessionStore.setState({ status: "empty" });
    expect(bar()).toMatch(/\[game data\]<\/footer>$/);
  });
});

describe("the notice", () => {
  it("shows a plain status message, and yields to an error", () => {
    useFileSessionStore.setState({ notice: "Saved into the Paint a Galaxy mod." });
    expect(bar()).toContain('<span class="muted">Saved into the Paint a Galaxy mod.</span>');

    useFileSessionStore.setState({ error: "something went wrong" });
    const html = bar();
    expect(html).toContain('<span class="warn">something went wrong</span>');
    expect(html).not.toContain("Saved into the Paint a Galaxy mod.");
  });
});

describe("the gesture hint", () => {
  it("follows the pointer: idle, a star, a lane under it, and a lane being dragged out", () => {
    expect(bar()).toContain("middle-drag to pan");

    useMapChromeStore.setState({ gesture: "lane" });
    expect(bar()).toContain("click to inspect");

    useEditorStore.setState({ hover: 1 });
    expect(bar()).toContain("drag to move · drag ring to connect");

    useMapChromeStore.setState({ gesture: "connecting" });
    expect(bar()).toContain("release on a system to connect");
  });

  it("names the selected nebula with its members and says what can be dragged", () => {
    useGalaxyStore.setState({
      nebulae: [{ ...OPEN_RESULT.galaxy.nebulae[0], systems: [1, 2, 3, 4, 5] }],
    });
    useEditorStore.getState().selectNebula(0);

    const html = bar();
    expect(html).toContain("Cloud selected · 5 systems");
    expect(html).toContain("drag the centre to move · drag the ring to resize · Delete to remove");
  });
});

describe("the auto-reload notice", () => {
  it("says nothing while the watcher is running", () => {
    useGameDataStore.setState({ autoReloadPaused: false, watching: 3 });
    expect(bar()).not.toContain("Auto-reload paused");
    expect(button("Resume")).toBeUndefined();
  });

  it("says why the watcher holds fewer roots than the game data has", () => {
    useGameDataStore.setState({
      autoReloadPaused: false,
      watching: 1,
      watchReason: "could not watch C:/mods/gone: the system cannot find the path specified",
    });

    const html = bar();
    expect(html).toContain("Auto-reload incomplete");
    expect(html).toContain(
      "could not watch C:/mods/gone: the system cannot find the path specified",
    );
    expect(button("Resume")).toBeUndefined();
  });

  it("says auto-reload is off when no root is watched at all", () => {
    useGameDataStore.setState({
      autoReloadPaused: false,
      watching: 0,
      watchReason: "the file watcher could not be started",
    });
    expect(bar()).toContain("Auto-reload off");
  });

  it("names the file that tripped the breaker, how often, and resumes on the button", () => {
    const resumeAutoReload = vi.fn(async () => undefined);
    useGameDataStore.setState({
      autoReloadPaused: true,
      hotFile: "C:/mods/1/common/country_types/00_country_types.txt",
      hotCount: 10,
      resumeAutoReload,
    });

    const html = bar();
    expect(html).toContain("Auto-reload paused");
    expect(html).toContain(
      "C:/mods/1/common/country_types/00_country_types.txt changed 10 times in a minute; reloads paused",
    );

    button("Resume")!.props.onClick();
    expect(resumeAutoReload).toHaveBeenCalledTimes(1);
  });
});

describe("the auto-reload notice", () => {
  it("carries no tooltip when the pause came with no file, as a page reload does", () => {
    useGameDataStore.setState({ autoReloadPaused: true, hotFile: null });
    const html = bar();
    expect(html).toContain("Auto-reload paused");
    expect(html).not.toContain("title=");
    expect(button("Resume")).toBeDefined();
  });
});

describe("the auto-reload notice without a document", () => {
  it("keeps the badge and its Resume button, the only way back from a pause", () => {
    useFileSessionStore.setState({ status: "empty" });
    useGameDataStore.setState({ autoReloadPaused: true, hotFile: "C:/mods/1/events/one.txt" });

    const html = bar();
    expect(html).toContain("No save open");
    expect(html).toContain("Auto-reload paused");
    expect(button("Resume")).toBeDefined();
  });
});
