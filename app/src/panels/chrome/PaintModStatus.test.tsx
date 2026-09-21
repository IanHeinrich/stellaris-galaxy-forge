import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import * as ipc from "../../api/ipc";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { usePaintModStore } from "../../store/paintModStore";
import { elements } from "../../test/elements";
import { PaintModStatus } from "./PaintModStatus";

const status = () => renderToStaticMarkup(<PaintModStatus />);

const DIR = "C:/mods/pag/map/setup_scenarios";

beforeEach(() => {
  vi.clearAllMocks();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  usePaintModStore.setState({ ...usePaintModStore.getInitialState() });
});

describe("the mod's status line", () => {
  it("says nothing until the shell has answered", () => {
    expect(status()).toBe("");
  });

  it("says to subscribe and enable when the mod is not installed, with a link to the Workshop", () => {
    usePaintModStore.setState({ known: true, paintMod: null });

    const html = status();
    expect(html).toContain('class="paint-mod-status warn"');
    expect(html).toContain("Subscribe to the ");
    expect(html).toContain(">Paint a Galaxy mod on the Steam Workshop ↗</button>");
    expect(html).toContain("then enable it in your playset.");

    const link = elements(<PaintModStatus />).find((el) => el.type === "button")!;
    (link.props as { onClick: () => void }).onClick();
    expect(ipc.openUrl).toHaveBeenCalledWith(
      "https://steamcommunity.com/sharedfiles/filedetails/?id=3532904115",
    );
  });

  it("asks for the playset alone when the mod is installed but not enabled", () => {
    usePaintModStore.setState({ known: true, paintMod: { scenarios_dir: DIR, enabled: false } });

    const html = status();
    expect(html).toContain('class="paint-mod-status warn"');
    expect(html).toContain(
      "The Paint a Galaxy mod is installed but not enabled. Turn it on in your playset in the launcher.",
    );
    expect(html).not.toContain("<button");
  });

  it("says the mod is enabled, without warning styling", () => {
    usePaintModStore.setState({ known: true, paintMod: { scenarios_dir: DIR, enabled: true } });

    const html = status();
    expect(html).toContain('class="paint-mod-status"');
    expect(html).toContain("Paint a Galaxy mod enabled ✓");
    expect(html).not.toContain("warn");
  });

  it("reports a Workshop link the shell refuses on the session", async () => {
    usePaintModStore.setState({ known: true, paintMod: null });
    vi.mocked(ipc.openUrl).mockRejectedValueOnce({ kind: "internal", message: "no browser" });

    const link = elements(<PaintModStatus />).find((el) => el.type === "button")!;
    (link.props as { onClick: () => void }).onClick();
    await vi.waitFor(() => expect(useFileSessionStore.getState().error).toBe("no browser"));
  });
});
