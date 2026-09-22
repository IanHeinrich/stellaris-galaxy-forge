import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { elements } from "../../test/elements";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useEditorStore } from "../../store/editorStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { ViewMenuItems } from "./ViewMenu";

let dismiss: ReturnType<typeof vi.fn<() => void>>;

const items = () => renderToStaticMarkup(<ViewMenuItems dismiss={dismiss} />);

/** The menu's button reading `label`, whose `onClick` a test calls in place of a click. */
function item(label: string): ReactElement<{ onClick(): void }> {
  const found = elements(<ViewMenuItems dismiss={dismiss} />).find(
    (el): el is ReactElement<{ onClick(): void }> =>
      el.type === "button" && renderToStaticMarkup(el).includes(`<span>${label}</span>`),
  );
  expect(found).toBeDefined();
  return found!;
}

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
    expect(html("Fit selection")).toContain("<kbd>⇧ F</kbd>");
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

  it("carries the layers reset, the Layers menu's one command that is not a toggle", () => {
    const resetLayers = vi.fn();
    useMapChromeStore.setState({ resetLayers });

    item("Reset layers to defaults").props.onClick();
    expect(resetLayers).toHaveBeenCalledTimes(1);
  });
});
