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
import { OPEN_RESULT, SCENARIO_CAPABILITIES } from "../../store/fixture";
import { useMapChromeStore } from "../../store/mapChromeStore";
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
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
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

  it("offers Paint and Erase, with their keys, on a scenario only", () => {
    useFileSessionStore.setState({ capabilities: OPEN_RESULT.capabilities });
    expect(rail()).not.toContain("Paint systems");
    expect(rail()).not.toContain("Erase systems");

    useFileSessionStore.setState({ capabilities: SCENARIO_CAPABILITIES });
    useToolStore.setState({ tool: "erase" });
    expect(button("Paint systems")).toContain('title="Paint systems (B)"');
    expect(button("Paint systems")).toContain('aria-pressed="false"');
    expect(button("Erase systems")).toContain('title="Erase systems (E)"');
    expect(button("Erase systems")).toContain('aria-pressed="true"');
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

describe("the brush options", () => {
  const options = () => renderToStaticMarkup(<ToolOptions />);

  it("give the paint brush its size, density, lanes and lane density", () => {
    useToolStore.setState({ tool: "paint", size: 60, spacing: 20, laneMode: "new" });
    const html = options();
    expect(html).toContain('aria-label="Brush options"');
    expect(html).toContain('aria-label="Brush size" value="60"');
    // Dense is small spacing, so the density slider runs against it.
    expect(html).toMatch(/aria-label="Density" value="70"/);
    expect(html).toContain('<option value="new" selected="">Among new</option>');
    expect(html).toMatch(/<input type="range"[^>]*aria-label="Lane density"/);
    expect(html).not.toMatch(/disabled=""[^>]*aria-label="Lane density"/);

    useToolStore.setState({ laneMode: "off" });
    expect(options()).toMatch(/disabled=""[^>]*aria-label="Lane density"/);
  });

  it("give the erase brush its size, target and the specials toggle, which lanes mode disables", () => {
    useToolStore.setState({ tool: "erase" });
    const html = options();
    expect(html).toContain('aria-label="Brush size"');
    expect(html).toContain("Lanes only");
    expect(html).toContain("Also erase special systems");
    expect(html).not.toContain('type="checkbox" disabled=""');

    useToolStore.setState({ eraseTarget: "lanes" });
    expect(options()).toContain('type="checkbox" disabled=""');
  });
});
