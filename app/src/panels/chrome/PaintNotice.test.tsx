import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../../test/prefs";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { readyAs } from "../../test/session";
import { OPEN_RESULT, SCENARIO_RESULT } from "../../store/fixture";
import { usePaintModStore } from "../../store/paintModStore";
import { paintModView } from "../../test/builders";
import { buttonIn } from "../../test/elements";
import { PaintNotice } from "./PaintNotice";

const notice = () => renderToStaticMarkup(<PaintNotice />);

const DIR = "C:/mods/pag/map/setup_scenarios";

/** The notice's button reading `label`. */
const button = (label: string) => buttonIn(<PaintNotice />, label)!;

beforeEach(() => {
  vi.clearAllMocks();
  stubPrefs();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  usePaintModStore.setState({ ...usePaintModStore.getInitialState() });
});

describe("the notice for a scenario outside the mod", () => {
  it("is absent with nothing open, for a save, and for a scenario already on the layer", () => {
    usePaintModStore.setState({ known: true, paintMod: paintModView({ scenarios_dir: DIR }) });
    expect(notice()).toBe("");

    readyAs(OPEN_RESULT);
    expect(notice()).toBe("");

    readyAs(SCENARIO_RESULT);
    useFileSessionStore.setState({ painted: true });
    expect(notice()).toBe("");

    useFileSessionStore.setState({ painted: false, path: `${DIR}/mine.txt` });
    expect(notice()).toBe("");
  });

  it("says the map needs the mod, with the mod's state and the way in", () => {
    readyAs(SCENARIO_RESULT);
    usePaintModStore.setState({ known: true, paintMod: paintModView() });

    const html = notice();
    expect(html).toContain(
      "Custom galaxies hit game-breaking bugs without the Paint a Galaxy mod. Save this map into " +
        "the mod unless it belongs to a mod of your own.",
    );
    expect(html).toContain('class="paint-mod-status"');
    expect(html).toContain("Save into the Paint a Galaxy mod…");
    expect(html).toContain("Not for me");
    expect(button("Save into the Paint a Galaxy mod…").props.disabled).toBe(false);

    const saveIntoPaintMod = vi.fn();
    useFileSessionStore.setState({ saveIntoPaintMod });
    button("Save into the Paint a Galaxy mod…").props.onClick();
    expect(saveIntoPaintMod).toHaveBeenCalledTimes(1);
  });

  it("shows the steps and keeps the save dead while the mod is not installed", () => {
    readyAs(SCENARIO_RESULT);
    usePaintModStore.setState({ known: true, paintMod: null });

    expect(notice()).toContain("paint-mod-status");
    expect(button("Save into the Paint a Galaxy mod…").props.disabled).toBe(true);

    usePaintModStore.setState({ known: true, paintMod: paintModView({ enabled: false }) });
    expect(notice()).toContain("paint-mod-status");
    expect(button("Save into the Paint a Galaxy mod…").props.disabled).toBe(false);
  });

  it("goes for good on Not for me", () => {
    readyAs(SCENARIO_RESULT);
    usePaintModStore.setState({ known: true, paintMod: paintModView() });
    expect(notice()).not.toBe("");

    button("Not for me").props.onClick();
    expect(notice()).toBe("");
  });
});
