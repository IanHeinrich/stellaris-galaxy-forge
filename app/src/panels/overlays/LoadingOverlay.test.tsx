import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import * as ipc from "../../api/ipc";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { LoadingOverlay } from "./LoadingOverlay";

const overlay = () => renderToStaticMarkup(<LoadingOverlay />);

beforeEach(() => {
  vi.clearAllMocks();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
});

describe("the loading overlay", () => {
  it("names the file and the phase it is in, with the fraction the backend reported", () => {
    useFileSessionStore.setState({
      status: "loading",
      loadingName: "2206.11.16.sav",
      progress: { phase: "project", fraction: 0.42 },
    });

    const html = overlay();
    expect(html).toContain("Opening 2206.11.16.sav");
    expect(html).toContain("Building the galaxy · 42%");
    expect(html).toContain("width:42%");
    expect(html).not.toContain("indeterminate");
  });

  it("sweeps an indeterminate bar until the first progress lands", () => {
    useFileSessionStore.setState({ status: "loading", loadingName: "Andromeda" });

    const html = overlay();
    expect(html).toContain("Opening Andromeda");
    expect(html).toContain("indeterminate");
    expect(html).not.toContain("%");
  });

  it("stays out of the way of an open document and of no document at all", () => {
    expect(overlay()).toBe("");

    useFileSessionStore.setState({ status: "ready", path: "C:/saves/terran.sav" });
    expect(overlay()).toBe("");
  });

  it("names the save a scenario is taken from, though the session holds no path for it", async () => {
    let give: (() => void) | undefined;
    vi.mocked(ipc.openAsScenario).mockReturnValueOnce(
      new Promise<never>((_, reject) => {
        give = () => reject({ kind: "format", message: "gave up" });
      }),
    );

    const open = useFileSessionStore.getState().openScenarioFrom("C:/saves/terran/2206.11.16.sav");
    expect(useFileSessionStore.getState().status).toBe("loading");
    expect(overlay()).toContain("Opening 2206.11.16.sav");

    give!();
    await open;
    expect(overlay()).toBe("");
  });

  it("leaves nothing behind when the open fails", async () => {
    vi.mocked(ipc.openSave).mockRejectedValueOnce({ kind: "format", message: "not a zip" });
    await useFileSessionStore.getState().openSave("C:/saves/bad.sav");

    expect(useFileSessionStore.getState().status).toBe("error");
    expect(overlay()).toBe("");
  });
});
