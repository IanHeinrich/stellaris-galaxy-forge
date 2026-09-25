import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { menuItem } from "../../test/elements";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { readyAs } from "../../test/session";
import { OPEN_RESULT, SCENARIO_RESULT } from "../../store/fixture";
import { usePaintModStore } from "../../store/paintModStore";
import { paintModView } from "../../test/builders";
import { FileMenuItems } from "./FileMenu";

/** What the menu is told once a command is taken; a toggle leaves it open. */
let dismiss: ReturnType<typeof vi.fn<() => void>>;

const items = () => renderToStaticMarkup(<FileMenuItems dismiss={dismiss} />);

const item = (label: string) => menuItem(<FileMenuItems dismiss={dismiss} />, label);

/** The markup of the one button reading `label`. */
function html(label: string): string {
  return renderToStaticMarkup(item(label));
}

beforeEach(() => {
  dismiss = vi.fn<() => void>();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  usePaintModStore.setState({ ...usePaintModStore.getInitialState() });
});

describe("the scenario export", () => {
  it("offers one export, for an open save only; the profile is the dialog's to ask", () => {
    expect(items()).toContain("Export as scenario…");
    expect(items()).not.toContain("Paint a Galaxy…");
    expect(html("Export as scenario…")).toContain("disabled=");

    readyAs(OPEN_RESULT);
    expect(html("Export as scenario…")).not.toContain("disabled=");

    readyAs(SCENARIO_RESULT);
    expect(html("Export as scenario…")).toContain("disabled=");
  });

  it("starts the export, which asks for the profile itself", () => {
    const exportScenario = vi.fn();
    readyAs(OPEN_RESULT);
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

describe("saving into the Paint a Galaxy mod", () => {
  const DIR = "C:/mods/pag/map/setup_scenarios";
  const LABEL = "Save into the Paint a Galaxy mod…";

  it("is dead until a scenario is open and the mod's folder is known", () => {
    expect(items()).not.toContain("Paint a Galaxy spawn points");
    expect(html(LABEL)).toContain("disabled=");
    expect(html(LABEL)).not.toContain("title=");

    readyAs(SCENARIO_RESULT);
    expect(html(LABEL)).toContain("disabled=");

    usePaintModStore.setState({ known: true, paintMod: paintModView({ enabled: false }) });
    expect(html(LABEL)).not.toContain("disabled=");

    readyAs(OPEN_RESULT);
    expect(html(LABEL)).toContain("disabled=");
  });

  it("says to subscribe first when the mod is not installed", () => {
    readyAs(SCENARIO_RESULT);
    usePaintModStore.setState({ known: true, paintMod: null });
    expect(html(LABEL)).toContain("disabled=");
    expect(html(LABEL)).toContain(
      'title="Subscribe to the Paint a Galaxy mod on the Steam Workshop first"',
    );
  });

  it("has nothing to do for a file already inside the mod's folder", () => {
    readyAs(SCENARIO_RESULT);
    usePaintModStore.setState({ known: true, paintMod: paintModView({ scenarios_dir: DIR }) });
    useFileSessionStore.setState({ path: `${DIR}/mine.txt` });
    expect(html(LABEL)).toContain("disabled=");

    useFileSessionStore.setState({ path: null });
    expect(html(LABEL)).not.toContain("disabled=");
  });

  it("saves into the mod and closes the menu", () => {
    const saveIntoPaintMod = vi.fn();
    readyAs(SCENARIO_RESULT);
    usePaintModStore.setState({ known: true, paintMod: paintModView() });
    useFileSessionStore.setState({ saveIntoPaintMod });

    item(LABEL).props.onClick();
    expect(saveIntoPaintMod).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
