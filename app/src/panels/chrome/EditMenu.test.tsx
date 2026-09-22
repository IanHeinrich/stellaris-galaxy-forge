import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { elements } from "../../test/elements";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useEditorStore } from "../../store/editorStore";
import { EditMenuItems } from "./EditMenu";

let dismiss: ReturnType<typeof vi.fn<() => void>>;

/** The menu's button reading `label`, whose `onClick` a test calls in place of a click. */
function item(label: string): ReactElement<{ onClick(): void }> {
  const found = elements(<EditMenuItems dismiss={dismiss} />).find(
    (el): el is ReactElement<{ onClick(): void }> =>
      el.type === "button" && renderToStaticMarkup(el).includes(`<span>${label}</span>`),
  );
  expect(found).toBeDefined();
  return found!;
}

function html(label: string): string {
  return renderToStaticMarkup(item(label));
}

const entry = (seq: number) => ({
  seq,
  description: `Change ${seq}`,
  inverse: { type: "MoveSystem" as const, id: 0, x: 0, y: 0 },
});

beforeEach(() => {
  dismiss = vi.fn<() => void>();
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
});

describe("the Edit menu", () => {
  it("shows each command's key beside it", () => {
    expect(html("Undo")).toContain("<kbd>Ctrl Z</kbd>");
    expect(html("Redo")).toContain("<kbd>Ctrl Y</kbd>");
    expect(html("Select all")).toContain("<kbd>Ctrl A</kbd>");
    expect(html("Delete")).toContain("<kbd>Del</kbd>");
  });

  it("offers undo and redo only while the history has a step, named in the tooltip", () => {
    expect(html("Undo")).toContain("disabled=");
    expect(html("Redo")).toContain("disabled=");

    useEditorStore.setState({ history: { undo: [entry(1), entry(2)], redo: [entry(3)] } });
    expect(html("Undo")).not.toContain("disabled=");
    expect(html("Undo")).toContain('title="Undo Change 2"');
    expect(html("Redo")).toContain('title="Redo Change 3"');
  });

  it("undoes and closes the menu", () => {
    const undo = vi.fn(async () => undefined);
    useEditorStore.setState({ history: { undo: [entry(1)], redo: [] }, undo });

    item("Undo").props.onClick();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("deletes only a selected lane or nebula, as the Delete key does", () => {
    expect(html("Delete")).toContain("disabled=");

    const deleteSelection = vi.fn(async () => undefined);
    useEditorStore.setState({ selectedLane: { a: 1, b: 2 }, deleteSelection });
    expect(html("Delete")).not.toContain("disabled=");

    item("Delete").props.onClick();
    expect(deleteSelection).toHaveBeenCalledTimes(1);
  });
});
