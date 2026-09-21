import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import * as ipc from "../../api/ipc";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { SCENARIO_RESULT } from "../../store/fixture";
import { useGalaxyStore } from "../../store/galaxyStore";
import { usePaintModStore } from "../../store/paintModStore";
import { elements } from "../../test/elements";
import { PaintBadge } from "./PaintBadge";

const badge = () => renderToStaticMarkup(<PaintBadge />);

const DIR = "C:/mods/pag/map/setup_scenarios";

/** What the shell said about the mod: not installed, or installed with the playset's say. */
function withMod(paintMod: { scenarios_dir: string | null; enabled: boolean } | null): void {
  usePaintModStore.setState({ known: true, paintMod });
}

/** A painted scenario, open. */
function openPainted(): void {
  useFileSessionStore.setState({
    status: "ready",
    kind: "scenario",
    path: SCENARIO_RESULT.path,
    painted: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  usePaintModStore.setState({ ...usePaintModStore.getInitialState() });
  useGalaxyStore.getState().clear();
});

describe("the Paint a Galaxy badge", () => {
  it("is absent for a plain document", () => {
    withMod({ scenarios_dir: DIR, enabled: true });
    useFileSessionStore.setState({ status: "ready", kind: "scenario", path: SCENARIO_RESULT.path });
    expect(badge()).toBe("");

    useFileSessionStore.setState({ kind: "save", painted: true });
    expect(badge()).toBe("");
  });

  it("names the profile plainly when the playset has the mod", () => {
    openPainted();
    withMod({ scenarios_dir: DIR, enabled: true });

    const html = badge();
    expect(html).toContain(">Paint a Galaxy</span>");
    expect(html).toContain('class="badge paint-badge"');
    expect(html).toContain('title="This scenario is set up for the Paint a Galaxy mod"');
    expect(html).not.toContain("⚠");
  });

  it("warns when the mod is installed but the playset lacks it", () => {
    openPainted();
    withMod({ scenarios_dir: DIR, enabled: false });

    const html = badge();
    expect(html).toContain("⚠ Paint a Galaxy mod not enabled");
    expect(html).toContain('<span class="badge warn paint-badge"');
    expect(html).toContain(
      'title="The Paint a Galaxy mod is installed but not enabled. Turn it on in your playset in the launcher."',
    );
  });

  it("is a button to the Workshop page when the mod is not installed", () => {
    openPainted();
    withMod(null);

    const html = badge();
    expect(html).toContain("⚠ Paint a Galaxy mod not installed");
    expect(html).toContain('<button type="button" class="badge warn paint-badge"');
    expect(html).toContain(
      "The Paint a Galaxy mod is not installed. Subscribe to it on the Steam Workshop",
    );

    const button = elements(<PaintBadge />).find((el) => el.type === "button")!;
    (button.props as { onClick: () => void }).onClick();
    expect(ipc.openUrl).toHaveBeenCalledWith(
      "https://steamcommunity.com/sharedfiles/filedetails/?id=3532904115",
    );
  });

  it("does not warn before the shell has answered, since unknown is not missing", () => {
    openPainted();

    const html = badge();
    expect(html).toContain(">Paint a Galaxy</span>");
    expect(html).not.toContain("⚠");
  });

  it("is on for a plain scenario saved inside the mod's scenarios folder", () => {
    withMod({ scenarios_dir: DIR, enabled: true });
    useFileSessionStore.setState({ status: "ready", kind: "scenario", path: `${DIR}/mine.txt` });
    expect(badge()).toContain(">Paint a Galaxy</span>");
  });

  it("names the size the header lists the scenario under, in a second tooltip line", () => {
    openPainted();
    withMod({ scenarios_dir: DIR, enabled: true });
    useGalaxyStore.setState({ header: [{ key: "name", value: '"Elysium"', line: 1 }] });

    expect(badge()).toContain(
      'title="This scenario is set up for the Paint a Galaxy mod\nListed in-game as Elysium"',
    );
  });

  it("carries no second line while the header names no size yet", () => {
    openPainted();
    withMod({ scenarios_dir: DIR, enabled: true });

    expect(badge()).toContain('title="This scenario is set up for the Paint a Galaxy mod"');
  });
});
