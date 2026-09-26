import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { menuItem } from "../../test/elements";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useEditorStore } from "../../store/editorStore";
import { OPEN_RESULT, SCENARIO_RESULT } from "../../store/fixture";
import { useLayoutStore } from "../../store/layoutStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useSceneStore } from "../../store/sceneStore";
import { armSession, resetStores } from "../../store/storeFixture";
import { openWith } from "../../test/session";
import { ViewMenuItems } from "./ViewMenu";

let dismiss: ReturnType<typeof vi.fn<() => void>>;

const items = () => renderToStaticMarkup(<ViewMenuItems dismiss={dismiss} />);

const item = (label: string) => menuItem(<ViewMenuItems dismiss={dismiss} />, label);

function html(label: string): string {
  return renderToStaticMarkup(item(label));
}

beforeEach(() => {
  dismiss = vi.fn<() => void>();
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useLayoutStore.setState({ collapsed: false });
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
});

describe("the View menu", () => {
  it("shows each command's key beside it", () => {
    expect(html("Fit all")).toContain("<kbd>Home</kbd>");
    expect(html("Fit selection")).toContain("<kbd>Shift+F</kbd>");
    expect(html("Hide dock")).toContain("<kbd>Tab</kbd>");
  });

  it("frames the selection only while there is one", () => {
    expect(html("Fit selection")).toContain("disabled=");

    const fitSelection = vi.fn();
    useEditorStore.setState({ selection: [1], fitSelection });
    expect(html("Fit selection")).not.toContain("disabled=");

    item("Fit selection").props.onClick();
    expect(fitSelection).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("names the dock's next state", () => {
    expect(items()).toContain("Hide dock");
    useLayoutStore.setState({ collapsed: true });
    expect(items()).toContain("Show dock");
    expect(items()).not.toContain("Hide dock");
  });

  it("opens the one selected system's view on a save or a scenario, and goes back to the galaxy from it", async () => {
    resetStores();
    armSession();
    await openWith(OPEN_RESULT);
    expect(html("Open system view")).toContain("<kbd>M</kbd>");
    expect(html("Open system view")).toContain("disabled=");

    await useEditorStore.getState().select(0);
    expect(html("Open system view")).not.toContain("disabled=");
    item("Open system view").props.onClick();
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: 0 });
    expect(dismiss).toHaveBeenCalledTimes(1);

    expect(items()).not.toContain("Open system view");
    expect(html("Back to galaxy")).toContain("<kbd>Esc</kbd>");
    item("Back to galaxy").props.onClick();
    expect(useSceneStore.getState().scene).toEqual({ kind: "galaxy" });

    await openWith(SCENARIO_RESULT);
    await useEditorStore.getState().select(0);
    expect(html("Open system view")).not.toContain("disabled=");
    item("Open system view").props.onClick();
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: 0 });
  });

  it("carries the layers reset, the Layers menu's one command that is not a toggle", () => {
    const resetLayers = vi.fn();
    useMapChromeStore.setState({ resetLayers });

    item("Reset layers to defaults").props.onClick();
    expect(resetLayers).toHaveBeenCalledTimes(1);
  });
});
