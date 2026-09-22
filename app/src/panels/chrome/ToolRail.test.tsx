import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { elements } from "../../test/elements";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import type { HistoryEntry } from "../../generated/HistoryEntry";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useToolStore } from "../../store/toolStore";
import { ToolOptions } from "./ToolOptions";
import { ToolRail } from "./ToolRail";

const rail = () => renderToStaticMarkup(<ToolRail />);

/** The markup of the rail's one button labelled `label`. */
function button(label: string): string {
  const found = elements(<ToolRail />).find(
    (el): el is ReactElement =>
      el.type === "button" && (el.props as { "aria-label"?: string })["aria-label"] === label,
  );
  expect(found).toBeDefined();
  return renderToStaticMarkup(found!);
}

function entry(seq: number, description: string): HistoryEntry {
  return { seq, description, inverse: { type: "RemoveLane", a: 1, b: 2 } };
}

beforeEach(() => {
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState(), status: "ready" });
  useToolStore.setState({ ...useToolStore.getInitialState() });
});

describe("the tool rail", () => {
  it("shows Select pressed, with its key in the tooltip", () => {
    expect(button("Select")).toContain('aria-pressed="true"');
    expect(button("Select")).toContain('title="Select (V)"');
  });

  it("keeps undo and redo at its foot, disabled with nothing to step", () => {
    expect(rail()).toContain('aria-label="History"');
    expect(button("Undo")).toContain("disabled");
    expect(button("Undo")).toContain('title="Undo (Ctrl+Z)"');
    expect(button("Redo")).toContain("disabled");
    expect(button("Redo")).toContain('title="Redo (Ctrl+Y)"');
  });

  it("names the edit undo and redo would step", () => {
    useEditorStore.setState({
      history: { undo: [entry(1, "Move Sol"), entry(2, "Add lane")], redo: [entry(3, "Cut lane")] },
    });
    expect(button("Undo")).not.toContain("disabled");
    expect(button("Undo")).toContain('title="Undo Add lane (Ctrl+Z)"');
    expect(button("Redo")).not.toContain("disabled");
    expect(button("Redo")).toContain('title="Redo Cut lane (Ctrl+Y)"');
  });
});

describe("the tool options", () => {
  it("draw nothing while Select is the tool", () => {
    expect(renderToStaticMarkup(<ToolOptions />)).toBe("");
  });
});
