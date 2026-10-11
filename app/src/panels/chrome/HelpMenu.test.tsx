import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import * as ipc from "../../api/ipc";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useScriptEditorStore } from "../../store/scriptEditorStore";
import { buttons, menuItem } from "../../test/elements";
import { until } from "../../test/wait";
import { HelpMenuItems } from "./HelpMenu";

let dismiss: ReturnType<typeof vi.fn<() => void>>;

const item = (label: string) => menuItem(<HelpMenuItems dismiss={dismiss} />, label);

beforeEach(() => {
  vi.clearAllMocks();
  dismiss = vi.fn<() => void>();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
});

describe("the Help menu", () => {
  it("lists the guide first, above the update commands", () => {
    const labels = buttons(renderToStaticMarkup(<HelpMenuItems dismiss={dismiss} />));

    expect(labels.slice(0, 2)).toEqual(["User guide", "Check for updates…"]);
    expect(labels).toContain("Releases page");
  });

  it("opens the guide in the browser and closes the menu", async () => {
    vi.mocked(ipc.openUrl).mockResolvedValueOnce();

    item("User guide").props.onClick();

    expect(dismiss).toHaveBeenCalledTimes(1);
    await until(() => expect(ipc.openUrl).toHaveBeenCalledWith(ipc.GUIDE_URL));
  });

  it("reports a guide link the shell refuses on the session", async () => {
    vi.mocked(ipc.openUrl).mockRejectedValueOnce({ kind: "internal", message: "no browser" });

    item("User guide").props.onClick();

    await until(() => expect(useFileSessionStore.getState().error).toBe("no browser"));
  });
});

describe("the Help menu's script editor setting", () => {
  beforeEach(() => {
    useScriptEditorStore.setState({ ...useScriptEditorStore.getInitialState() });
  });

  it("says the app asks until an editor is remembered, and has nothing to forget", () => {
    const markup = renderToStaticMarkup(<HelpMenuItems dismiss={dismiss} />);
    expect(markup).toContain("Asks which editor to use");
    expect(item("Forget editor").props.disabled).toBe(true);
  });

  it("names the remembered editor, forgets it, and opens the chooser to change it", async () => {
    vi.mocked(ipc.editorChoices).mockResolvedValueOnce({ editors: [], steam_replaces: false });
    useScriptEditorStore.setState({
      choice: { pick: { kind: "found", id: "vscode" }, name: "VS Code", remember: true },
    });
    expect(renderToStaticMarkup(<HelpMenuItems dismiss={dismiss} />)).toContain("Open in VS Code");

    item("Forget editor").props.onClick();
    expect(useScriptEditorStore.getState().choice).toBeNull();

    item("Change editor…").props.onClick();
    expect(dismiss).toHaveBeenCalledTimes(2);
    await until(() => expect(useScriptEditorStore.getState().chooser).toEqual({ target: null }));
  });
});
