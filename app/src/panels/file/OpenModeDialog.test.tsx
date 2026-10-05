import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { NEVER_WARN, PAINT_CHECK } from "../../lib/paintCopy";
import { buttons, shown } from "../../test/elements";
import { saveFile } from "../../test/builders";
import { OpenModeDialog } from "./OpenModeDialog";

beforeEach(() => {
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
});

describe("opening a save as a scenario", () => {
  const dialog = () => {
    useFileSessionStore.setState({ pendingOpen: saveFile().path, pendingAsScenario: true });
    return renderToStaticMarkup(<OpenModeDialog />);
  };

  it("asks the Paint a Galaxy question", () => {
    expect(shown(dialog())).toContain(PAINT_CHECK);
    expect(buttons(dialog())).toEqual(["Cancel", "Continue"]);
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
