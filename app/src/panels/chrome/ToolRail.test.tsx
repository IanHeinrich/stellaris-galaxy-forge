import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { historyEntry as entry } from "../../test/builders";
import { buttonIn, elements } from "../../test/elements";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { SCENARIO_CAPABILITIES } from "../../lib/capabilities";
import { OPEN_RESULT } from "../../store/fixture";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useToolStore } from "../../store/toolStore";
import { ToolOptions } from "./ToolOptions";
import { ToolRail } from "./ToolRail";

const rail = () => renderToStaticMarkup(<ToolRail />);

/** The markup of the rail's one button labelled `label`. */
const button = (label: string) => renderToStaticMarkup(buttonIn(<ToolRail />, label)!);

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

  it("offers Connect and Cut, with their keys, on a save as on a scenario", () => {
    useFileSessionStore.setState({ capabilities: OPEN_RESULT.capabilities });
    useToolStore.setState({ tool: "cut" });
    expect(button("Connect lanes")).toContain('title="Connect lanes (C)"');
    expect(button("Connect lanes")).toContain('aria-pressed="false"');
    expect(button("Cut lanes")).toContain('title="Cut lanes (X)"');
    expect(button("Cut lanes")).toContain('aria-pressed="true"');

    useFileSessionStore.setState({ capabilities: SCENARIO_CAPABILITIES });
    expect(rail()).toContain("Connect lanes");
    expect(rail()).toContain("Cut lanes");
  });

  it("carries the symmetry button after the tools, showing the setting while it is on", () => {
    useFileSessionStore.setState({ capabilities: SCENARIO_CAPABILITIES });
    const off = button("Symmetry");
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('title="Symmetry off (Shift+M turns on 4-fold rotation)"');
    expect(off).not.toContain("symmetry-badge");
    expect(rail()).toMatch(/aria-label="Symmetry">.*aria-label="History"/);

    useToolStore.setState({ symmetry: { kind: "mirror", axis: "y" } });
    const mirror = button("Symmetry");
    expect(mirror).toContain('aria-pressed="true"');
    expect(mirror).toContain('title="Symmetry: Mirror left–right (Shift+M turns it off)"');
    expect(mirror).toContain('<span class="symmetry-badge">↔</span>');
    useToolStore.setState({ symmetry: { kind: "rotate", n: 6 } });
    expect(button("Symmetry")).toContain('<span class="symmetry-badge">6</span>');
  });

  it("hides the symmetry control on a save, since symmetry only applies to a scenario", () => {
    useFileSessionStore.setState({ capabilities: SCENARIO_CAPABILITIES });
    expect(rail()).toContain('aria-label="Symmetry"');
    useFileSessionStore.setState({ capabilities: OPEN_RESULT.capabilities });
    expect(rail()).not.toContain('aria-label="Symmetry"');
  });

  it("opens the symmetry flyout from its button, marking the setting in force", () => {
    expect(button("Symmetry")).toContain('aria-haspopup="menu" aria-expanded="false"');
    expect(rail()).not.toContain('role="menu"');

    buttonIn(<ToolRail />, "Symmetry")!.props.onClick();
    expect(useToolStore.getState().symmetryMenu).toBe(true);
    useToolStore.setState({ symmetry: { kind: "rotate", n: 4 } });
    const html = rail();
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="menu" aria-label="Symmetry"');
    expect(html).toMatch(/>Off<.*Mirror.*>↔<.*>↕<.*Rotate.*>2<.*>3<.*>4<.*>6<.*>8</);
    expect(button("4-fold rotation")).toContain('aria-checked="true"');
    expect(button("Off")).toContain('aria-checked="false"');
  });

  it("sets the symmetry a flyout choice names and closes, and Escape closes it too", () => {
    useToolStore.setState({ symmetryMenu: true });
    const find = (label: string) =>
      elements(<ToolRail />).find(
        (el): el is ReactElement<{ onClick: (e: unknown) => void }> =>
          (el.props as { "aria-label"?: string })["aria-label"] === label,
      )!;
    find("Mirror top–bottom").props.onClick({ currentTarget: { closest: () => null } });
    expect(useToolStore.getState()).toMatchObject({
      symmetry: { kind: "mirror", axis: "x" },
      symmetryMenu: false,
    });

    useToolStore.setState({ symmetryMenu: true });
    const menu = elements(<ToolRail />).find(
      (el): el is ReactElement<{ onKeyDown: (e: unknown) => void }> =>
        (el.props as { role?: string }).role === "menu",
    )!;
    menu.props.onKeyDown({
      key: "Escape",
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
      currentTarget: { closest: () => null },
    });
    expect(useToolStore.getState().symmetryMenu).toBe(false);
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

  it("leave the symmetry to the rail", () => {
    for (const tool of ["paint", "erase", "connect", "cut"] as const) {
      useToolStore.setState({ tool });
      expect(options()).not.toContain("Symmetry");
    }
  });

  it("give the paint brush its size, density, lanes and lane density", () => {
    useToolStore.setState({ tool: "paint", size: 60, spacing: 20, laneMode: "new" });
    const html = options();
    expect(html).toContain('aria-label="Brush options"');
    expect(html).toContain('aria-label="Brush size" value="60"');
    // Dense is small spacing, so the density slider runs against it, log-mapped for fine control.
    expect(html).toMatch(/aria-label="Density" value="592"/);
    expect(html).toContain(
      'aria-label="Spacing between painted systems in world units" title="Distance between painted systems, in world units" value="20"',
    );
    expect(html).toContain('<option value="new" selected="">Among new</option>');
    expect(html).toMatch(/<input type="range"[^>]*aria-label="Lane density"/);
    expect(html).not.toMatch(/disabled=""[^>]*aria-label="Lane density"/);

    useToolStore.setState({ laneMode: "off" });
    expect(options()).toMatch(/disabled=""[^>]*aria-label="Lane density"/);
  });

  it("hatch the density a large brush cannot reach, and say so when the chosen density is cut back", () => {
    useToolStore.setState({ tool: "paint", size: 40, spacing: 25 });
    expect(options()).not.toContain("density-blocked");

    useToolStore.setState({ size: 400, spacing: 60 });
    const within = options();
    expect(within).toContain('class="density-blocked"');
    expect(within).not.toContain("limited by brush size");

    useToolStore.setState({ spacing: 10 });
    const cut = options();
    expect(cut).toContain("limited by brush size");
    expect(cut).toContain('title="Distance between painted systems, in world units" value="38.3"');
  });

  it("give the connect brush its size and lane density, and the cut brush its size", () => {
    useToolStore.setState({ tool: "connect", size: 60 });
    const connect = options();
    expect(connect).toContain('aria-label="Brush size" value="60"');
    expect(connect).toMatch(/<input type="range"[^>]*aria-label="Lane density"/);
    expect(connect).not.toMatch(/disabled=""[^>]*aria-label="Lane density"/);

    useToolStore.setState({ tool: "cut" });
    const cut = options();
    expect(cut).toContain('aria-label="Brush size" value="60"');
    expect(cut).not.toContain("Lane density");
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
