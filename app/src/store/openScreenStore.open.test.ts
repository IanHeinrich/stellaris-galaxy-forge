import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { ScenarioListings } from "../generated/ScenarioListings";
import { TERRAN, VOID, campaignSave, modScenario, paintModView } from "../test/builders";
import { OPEN_RESULT, SCENARIO_RESULT } from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { mockedIpc } from "../test/ipc";
import { useFileSessionStore } from "./fileSessionStore";
import { useLayoutStore } from "./layoutStore";
import { usePaintModStore } from "./paintModStore";
import { openSections, type Section } from "../lib/openRows";
import { useOpenScreenStore } from "./openScreenStore";
import { resetStores } from "./storeFixture";
import { useRecentsStore, type RecentDoc } from "./recentsStore";
import { until } from "../test/wait";

const screen = () => useOpenScreenStore.getState();

/** What `list_scenarios` resolves to: the files, and what the mod descriptors could not say. */
function listed(scenarios: ScenarioListing[], diagnostics: string[] = []): ScenarioListings {
  return { scenarios, diagnostics };
}

const RECENT: RecentDoc = {
  kind: "save",
  path: "C:/saves/terran/2206.11.16.sav",
  title: "Terran Federation",
  subtitle: "Terran Federation · 2206.11.16 · v4.4.6",
  openedAt: 5,
};

/** The sections as the screen shows them for the current state. */
function sections(): Section[] {
  return openSections(screen(), useRecentsStore.getState().recents);
}

function section(id: string): Section {
  return sections().find((s) => s.id === id)!;
}

function rowKeys(id: string): string[] {
  return (
    sections()
      .find((s) => s.id === id)
      ?.rows.map((r) => r.key) ?? []
  );
}

beforeEach(() => {
  resetStores();
  mockedIpc.listCampaigns.mockResolvedValue([VOID, TERRAN]);
  mockedIpc.listCampaignSaves.mockResolvedValue([campaignSave()]);
  mockedIpc.listScenarios.mockResolvedValue(listed([modScenario()]));
  mockedIpc.missingPaths.mockResolvedValue([]);
  mockedIpc.closeSave.mockResolvedValue();
  mockedIpc.warmDetails.mockResolvedValue([]);
  mockedIpc.getSpecialSystems.mockResolvedValue({ systems: [], counts: [], with_game_data: false });
});

describe("open", () => {
  beforeEach(() => {
    useRecentsStore.setState({ recents: [RECENT] });
  });

  it("marks a recent document whose file is gone, and forgets it on request", async () => {
    mockedIpc.openSave.mockRejectedValue({
      kind: "not_found",
      message: "The system cannot find the file specified. (os error 2)",
    });

    await screen().open(RECENT.path, "save");

    expect(screen().rowError?.path).toBe(RECENT.path);
    expect(screen().busy).toBeNull();
    const row = section("recent").rows[0];
    expect(row).toMatchObject({ kind: "recent", missing: true });

    screen().forget(RECENT.path);
    expect(screen().missing).toEqual([]);
    expect(rowKeys("recent")).toEqual([]);
  });

  it("leaves a readable file that failed for another reason listed as it was", async () => {
    mockedIpc.openSave.mockRejectedValue({ kind: "format", message: "meta is not a save header" });

    await screen().open(RECENT.path, "save");

    expect(screen().rowError?.message).toBe("meta is not a save header");
    expect(screen().missing).toEqual([]);
  });

  it("takes a save into a scenario with the standing Paint a Galaxy choice", async () => {
    mockedIpc.openAsScenario.mockResolvedValue(OPEN_RESULT);

    usePaintModStore.setState({ paintChoice: true });
    await screen().open("C:/saves/a.sav", "scenario");
    expect(mockedIpc.openAsScenario).toHaveBeenLastCalledWith("C:/saves/a.sav", "paint_a_galaxy");

    usePaintModStore.setState({ paintChoice: false });
    await screen().open("C:/saves/b.sav", "scenario");
    expect(mockedIpc.openAsScenario).toHaveBeenLastCalledWith("C:/saves/b.sav", "plain");
  });

  it("closes the dialog once the document is open", async () => {
    mockedIpc.openSave.mockResolvedValue(OPEN_RESULT);
    useLayoutStore.setState({ openDialog: true });

    await screen().open(OPEN_RESULT.path, "save");

    expect(useFileSessionStore.getState().status).toBe("ready");
    expect(useLayoutStore.getState().openDialog).toBe(false);
  });

  it("leaves the dialog standing when another document is still opening", async () => {
    let finish!: (result: typeof OPEN_RESULT) => void;
    mockedIpc.openSave.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    useLayoutStore.setState({ openDialog: true });
    const first = useFileSessionStore.getState().openSave("C:/saves/terran/other.sav");

    await screen().open(OPEN_RESULT.path, "save");

    expect(useLayoutStore.getState().openDialog).toBe(true);
    expect(screen().rowError?.path).toBe(OPEN_RESULT.path);
    expect(mockedIpc.openSave).toHaveBeenCalledTimes(1);

    finish(OPEN_RESULT);
    await first;
    expect(useFileSessionStore.getState().path).toBe(OPEN_RESULT.path);
  });
});

describe("opening a scenario file", () => {
  const PAINTED = modScenario({ path: "C:/mods/a/map/setup_scenarios/painted.txt", painted: true });
  const PLAIN = modScenario({ path: "C:/mods/a/map/setup_scenarios/plain.txt" });
  const prompt = () => useFileSessionStore.getState().scenarioPrompt;
  const session = () => useFileSessionStore.getState();

  beforeEach(async () => {
    usePaintModStore.setState({
      ...usePaintModStore.getInitialState(),
      known: true,
      paintMod: paintModView(),
      paintChoice: true,
      warnNotForPaint: true,
    });
    mockedIpc.listScenarios.mockResolvedValue(listed([PAINTED, PLAIN]));
    mockedIpc.openSave.mockResolvedValue(SCENARIO_RESULT);
    await screen().load(null);
  });

  it("opens a scenario for Paint a Galaxy at once while the mod is enabled", async () => {
    await screen().open(PAINTED.path, "save");
    expect(prompt()).toBeNull();
    expect(mockedIpc.openSave).toHaveBeenCalledWith(PAINTED.path);
    expect(session().status).toBe("ready");
  });

  it("asks first about a scenario that isn't for Paint a Galaxy, and opens it as answered", async () => {
    const cancelled = screen().open(PLAIN.path, "save");
    await until(() => expect(prompt()).toMatchObject({ path: PLAIN.path, kind: "not_for_paint" }));
    session().answerScenarioPrompt(null);
    await cancelled;
    expect(mockedIpc.openSave).not.toHaveBeenCalled();

    const opening = screen().open(PLAIN.path, "save");
    await until(() => expect(prompt()).not.toBeNull());
    session().answerScenarioPrompt("paint_a_galaxy");
    await opening;
    expect(mockedIpc.openSave).toHaveBeenCalledWith(PLAIN.path);
    expect(session().paintChosen).toBe(true);
  });

  it("always asks about a scenario for Paint a Galaxy while the mod is off or unknown", async () => {
    usePaintModStore.setState({
      paintMod: paintModView({ enabled: false }),
      warnNotForPaint: false,
    });
    const opening = screen().open(PAINTED.path, "save");
    await until(() =>
      expect(prompt()).toMatchObject({ path: PAINTED.path, kind: "paint_mod_off" }),
    );
    session().answerScenarioPrompt("plain");
    await opening;
    expect(mockedIpc.openSave).toHaveBeenCalledWith(PAINTED.path);

    usePaintModStore.setState({ known: false, paintMod: null });
    const asking = screen().open(PAINTED.path, "save");
    await until(() => expect(prompt()?.kind).toBe("paint_mod_off"));
    session().answerScenarioPrompt(null);
    await asking;
  });

  it("opens a plain scenario for Paint a Galaxy on request, asking only while the mod is off", async () => {
    await screen().open(PLAIN.path, "save", true);
    expect(prompt()).toBeNull();
    expect(session().paintChosen).toBe(true);

    usePaintModStore.setState({ paintMod: paintModView({ enabled: false }) });
    const opening = screen().open(PLAIN.path, "save", true);
    await until(() =>
      expect(prompt()).toMatchObject({ path: PLAIN.path, kind: "paint_mod_off", forPaint: true }),
    );
    session().answerScenarioPrompt("plain");
    await opening;
    expect(session().paintChosen).toBe(true);
  });

  it("opens any other scenario plain, without asking, once that warning is turned off", async () => {
    usePaintModStore.setState({ warnNotForPaint: false });
    await screen().open(PLAIN.path, "save");
    expect(prompt()).toBeNull();
    expect(mockedIpc.openSave).toHaveBeenCalledWith(PLAIN.path);
    expect(session().paintChosen).toBe(false);

    await screen().open("C:/elsewhere/unlisted.txt", "save");
    expect(prompt()).toBeNull();
    expect(mockedIpc.openSave).toHaveBeenLastCalledWith("C:/elsewhere/unlisted.txt");
  });

  it("asks the same of a scenario file picked with Browse", async () => {
    const asking = session().requestOpen(PLAIN.path, { listings: screen().scenarios });
    await until(() => expect(prompt()?.kind).toBe("not_for_paint"));
    session().answerScenarioPrompt(null);
    await asking;
    expect(mockedIpc.openSave).not.toHaveBeenCalled();

    await session().requestOpen(PAINTED.path, { listings: screen().scenarios });
    expect(mockedIpc.openSave).toHaveBeenCalledWith(PAINTED.path);
    expect(mockedIpc.scenarioPainted).not.toHaveBeenCalled();
  });

  it("reads a file Browse found outside every listed folder for whether it is for the mod", async () => {
    const painted = "C:/elsewhere/painted.txt";
    mockedIpc.scenarioPainted.mockResolvedValueOnce(true);
    await session().requestOpen(painted, { listings: screen().scenarios });
    expect(mockedIpc.scenarioPainted).toHaveBeenCalledWith(painted);
    expect(prompt()).toBeNull();
    expect(mockedIpc.openSave).toHaveBeenCalledWith(painted);

    const plain = "C:/elsewhere/plain.txt";
    mockedIpc.scenarioPainted.mockResolvedValueOnce(false);
    const asking = session().requestOpen(plain, { listings: screen().scenarios });
    await until(() => expect(prompt()?.kind).toBe("not_for_paint"));
    session().answerScenarioPrompt(null);
    await asking;
    expect(mockedIpc.openSave).not.toHaveBeenCalledWith(plain);
  });

  it("asks nothing more of a save once the user chose to edit it as a scenario", async () => {
    mockedIpc.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
    await session().requestOpen("C:/saves/a.sav", { listings: null });
    expect(session().pendingOpen).toBe("C:/saves/a.sav");
    await session().chooseOpenMode("scenario");
    expect(prompt()).toBeNull();
    expect(mockedIpc.openAsScenario).toHaveBeenCalledWith("C:/saves/a.sav", "paint_a_galaxy");
    expect(mockedIpc.scenarioPainted).not.toHaveBeenCalled();
  });
});
