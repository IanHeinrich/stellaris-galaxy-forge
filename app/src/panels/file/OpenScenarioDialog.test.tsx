import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { usePaintModStore } from "../../store/paintModStore";
import {
  NEVER_WARN,
  NEVER_WARN_WHY,
  OPEN_NOT_FOR_PAINT,
  OPEN_PAINT_MOD_OFF,
  PAINT_CHECK,
  PAINT_MOD_NOT_ENABLED,
  PAINT_UNTICKED,
} from "../../lib/paintCopy";
import { paintModView } from "../../test/builders";
import { buttons, shown } from "../../test/elements";
import { scenarioListing } from "../../test/openRows";
import { OpenScenarioDialog } from "./OpenScenarioDialog";

const noop = () => undefined;

describe("opening a scenario file", () => {
  const UNTICKED = PAINT_UNTICKED.split(":")[0];
  const dialog = () => renderToStaticMarkup(<OpenScenarioDialog />);
  const ask = (kind: "not_for_paint" | "paint_mod_off") =>
    useFileSessionStore.setState({
      scenarioPrompt: { path: scenarioListing().path, kind, forPaint: false, resolve: noop },
    });

  beforeEach(() => {
    useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
    usePaintModStore.setState({ known: true, paintMod: paintModView({ enabled: false }) });
  });

  it("shows nothing while no scenario is waiting", () => {
    expect(dialog()).toBe("");
  });

  it("asks about a scenario that isn't for Paint a Galaxy, with the warning and a way to stop asking", () => {
    ask("not_for_paint");
    usePaintModStore.setState({ paintChoice: false });
    expect(shown(dialog())).toContain(OPEN_NOT_FOR_PAINT);
    expect(shown(dialog())).toContain(PAINT_CHECK);
    expect(shown(dialog())).toContain(UNTICKED);
    expect(shown(dialog())).toContain(NEVER_WARN);
    expect(shown(dialog())).toContain(NEVER_WARN_WHY.split(".")[0]);
    expect(buttons(dialog())).toEqual(["Cancel", "Continue"]);
  });

  it("warns that the mod a Paint a Galaxy scenario needs is off, and offers no way to stop warning", () => {
    ask("paint_mod_off");
    expect(shown(dialog())).toContain(OPEN_PAINT_MOD_OFF);
    expect(shown(dialog())).toContain(PAINT_MOD_NOT_ENABLED);
    expect(shown(dialog())).not.toContain(NEVER_WARN);
    expect(shown(dialog())).not.toContain(PAINT_CHECK);
  });
});
