import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { elements } from "../../test/elements";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { OPEN_RESULT, SCENARIO_RESULT } from "../../store/fixture";
import { FileMenuItems } from "./FileMenu";

/** What the menu is told once a command is taken; a toggle leaves it open. */
let dismiss: ReturnType<typeof vi.fn<() => void>>;

const items = () => renderToStaticMarkup(<FileMenuItems dismiss={dismiss} />);

/** The menu's button reading `label`, whose `onClick` a test calls in place of a click. */
function item(label: string): ReactElement<{ onClick(): void }> {
  const found = elements(<FileMenuItems dismiss={dismiss} />).find(
    (el): el is ReactElement<{ onClick(): void }> =>
      el.type === "button" && renderToStaticMarkup(el).includes(label),
  );
  expect(found).toBeDefined();
  return found!;
}

/** The markup of the one button reading `label`. */
function html(label: string): string {
  return renderToStaticMarkup(item(label));
}

function open(result: typeof OPEN_RESULT): void {
  useFileSessionStore.setState({ status: "ready", kind: result.kind });
}

beforeEach(() => {
  dismiss = vi.fn<() => void>();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
});

describe("the scenario export", () => {
  it("offers one export, for an open save only; the profile is the dialog's to ask", () => {
    expect(items()).toContain("Export as scenario…");
    expect(items()).not.toContain("Paint a Galaxy…");
    expect(html("Export as scenario…")).toContain("disabled=");

    open(OPEN_RESULT);
    expect(html("Export as scenario…")).not.toContain("disabled=");

    open(SCENARIO_RESULT);
    expect(html("Export as scenario…")).toContain("disabled=");
  });

  it("starts the export, which asks for the profile itself", () => {
    const exportScenario = vi.fn();
    open(OPEN_RESULT);
    useFileSessionStore.setState({ exportScenario });

    item("Export as scenario…").props.onClick();
    expect(exportScenario).toHaveBeenCalledTimes(1);
    expect(exportScenario).toHaveBeenLastCalledWith();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps opening a save as a scenario plain", () => {
    const pickAndOpen = vi.fn();
    useFileSessionStore.setState({ pickAndOpen });

    item("Open save as scenario…").props.onClick();
    expect(pickAndOpen).toHaveBeenCalledWith("scenario");
  });
});

describe("the Paint a Galaxy spawn points check item", () => {
  it("is dead until a scenario is open, and says what it changes", () => {
    const title =
      'title="Changes how new spawn points are written; existing bytes are never touched."';
    expect(html("Paint a Galaxy spawn points")).toContain("disabled=");
    expect(html("Paint a Galaxy spawn points")).toContain(title);

    open(OPEN_RESULT);
    expect(html("Paint a Galaxy spawn points")).toContain("disabled=");

    open(SCENARIO_RESULT);
    expect(html("Paint a Galaxy spawn points")).not.toContain("disabled=");
    expect(html("Paint a Galaxy spawn points")).toContain(title);
  });

  it("reads the profile and toggles it", () => {
    open(SCENARIO_RESULT);
    expect(html("Paint a Galaxy spawn points")).toContain('aria-pressed="false"');

    item("Paint a Galaxy spawn points").props.onClick();
    expect(useFileSessionStore.getState().paintProfile).toBe(true);
    expect(html("Paint a Galaxy spawn points")).toContain('aria-pressed="true"');

    item("Paint a Galaxy spawn points").props.onClick();
    expect(useFileSessionStore.getState().paintProfile).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });
});
