import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { usePaintModStore } from "../../store/paintModStore";
import { NEVER_WARN, PAINT_CHECK, PAINT_UNTICKED } from "../../lib/paintCopy";
import { buttons, saveFile, shown } from "../../test/openRows";
import { OpenModeDialog } from "./OpenModeDialog";

beforeEach(() => {
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
});

describe("opening a save as a scenario", () => {
  const UNTICKED = PAINT_UNTICKED.split(":")[0];
  const dialog = () => {
    useFileSessionStore.setState({ pendingOpen: saveFile().path, pendingAsScenario: true });
    return renderToStaticMarkup(<OpenModeDialog />);
  };

  it("asks the Paint a Galaxy question, with the warning while it is unticked", () => {
    usePaintModStore.setState({ paintChoice: false });
    expect(shown(dialog())).toContain(PAINT_CHECK);
    expect(shown(dialog())).toContain(UNTICKED);
    expect(buttons(dialog())).toEqual(["Cancel", "Continue"]);

    usePaintModStore.setState({ paintChoice: true });
    expect(shown(dialog())).not.toContain(UNTICKED);
  });

  it("leaves the question without a way to stop asking", () => {
    expect(shown(dialog())).not.toContain(NEVER_WARN);
  });
});

describe("opening a picked save", () => {
  it("shows nothing while no save is waiting", () => {
    expect(renderToStaticMarkup(<OpenModeDialog />)).toBe("");
  });

  it("offers it as a save or as a scenario, with the same Paint a Galaxy question", () => {
    useFileSessionStore.setState({ pendingOpen: saveFile().path });
    const html = renderToStaticMarkup(<OpenModeDialog />);
    expect(shown(html)).toContain("Open 2206.11.16.sav");
    expect(shown(html)).toContain("Edit as save");
    expect(shown(html)).toContain("Take its galaxy into a new static galaxy scenario.");
    expect(shown(html)).toContain(PAINT_CHECK);
    expect(buttons(html).slice(-1)).toEqual(["Cancel"]);
  });
});
