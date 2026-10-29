import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useGameDataStore } from "../../store/gameDataStore";
import { gameDataSummary } from "../../test/builders";
import { buttons, shown } from "../../test/elements";
import { Setup } from "./Setup";

const markup = () => renderToStaticMarkup(<Setup />);
const card = () => shown(markup());

beforeEach(() => {
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
});

describe("Setup user folder row", () => {
  it("says the folder is found on Continue before game data loads", () => {
    const html = card();
    expect(html).toContain("User folder");
    expect(html).toContain("found automatically when you continue");
    expect(buttons(markup())).toContain("Change folder…");
    expect(html).not.toContain("Use the default folder");
  });

  it("warns when the folder holds no mods and asks for it", () => {
    useGameDataStore.setState({
      status: "ready",
      summary: gameDataSummary({
        user_dir: { path: "D:/Paradox/Stellaris", source: "launcher_settings" },
        diagnostics: [{ kind: "no_playset", message: "no playset in D:/Paradox/Stellaris" }],
      }),
    });
    const html = card();
    expect(html).toContain("D:/Paradox/Stellaris");
    expect(html).toContain("from the game's launcher settings");
    expect(html).toContain("no mods found");
    expect(buttons(markup())).toContain("Locate user folder…");
  });

  it("offers the default once a folder was chosen", () => {
    useGameDataStore.setState({ userDir: "E:/Stellaris user" });
    const html = card();
    expect(html).toContain("E:/Stellaris user");
    expect(html).toContain("chosen");
    expect(buttons(markup())).toContain("Use the default folder");
  });

  it("offers no folder actions while game data loads", () => {
    useGameDataStore.setState({ status: "loading", userDir: "E:/Stellaris user" });
    const labels = buttons(markup());
    expect(labels).not.toContain("Change folder…");
    expect(labels).not.toContain("Use the default folder");
  });
});
