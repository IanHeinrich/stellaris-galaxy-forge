import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { DocumentChanged } from "../generated/DocumentChanged";
import type { OpenResult } from "../generated/OpenResult";
import { useEditorStore } from "./editorStore";
import { diskChangeShown } from "./fileSessionStore.refresh";
import { OPEN_RESULT, SCENARIO_RESULT, saveResult } from "./fixture";
import { useGalaxyStore } from "./galaxyStore";
import { edit, resetSession, session } from "./sessionFixture";
import { useToolStore } from "./toolStore";
import { mockedIpc } from "../test/ipc";
import { flush } from "../test/flush";
import { until } from "../test/wait";

let heard: ((changed: DocumentChanged) => void) | null = null;

beforeEach(() => {
  resetSession();
  heard = null;
  mockedIpc.onDocumentChanged.mockImplementation(async (handler) => {
    heard = handler;
    return () => undefined;
  });
});

function changed(over: Partial<DocumentChanged> = {}): DocumentChanged {
  return { path: SCENARIO_RESULT.path, change: "changed", dirty: false, ...over };
}

/** The scenario as the file now reads: system 3 taken out. */
const REREAD: OpenResult & { path: string } = {
  ...SCENARIO_RESULT,
  galaxy: {
    ...SCENARIO_RESULT.galaxy,
    systems: SCENARIO_RESULT.galaxy.systems.filter((s) => s.id !== 3),
  },
};

async function openScenario(): Promise<void> {
  mockedIpc.openDocument.mockResolvedValueOnce(SCENARIO_RESULT);
  await session().openSave(SCENARIO_RESULT.path);
}

describe("a scenario with no unsaved changes", () => {
  beforeEach(openScenario);

  it("reads the file again by itself, keeps what is still selected and says so", async () => {
    useEditorStore.setState({ selection: [2, 3] });
    mockedIpc.reloadDocument.mockResolvedValueOnce(REREAD);

    heard!(changed());
    await vi.waitFor(() => expect(session().notice).not.toBeNull());

    expect(mockedIpc.reloadDocument).toHaveBeenCalledWith(false);
    expect(session().status).toBe("ready");
    expect(session().notice).toBe("Reloaded my_galaxy.txt after it changed on disk.");
    expect(useGalaxyStore.getState().systems.has(3)).toBe(false);
    expect(useEditorStore.getState().selection).toEqual([2]);
    expect(diskChangeShown(session())).toBeNull();
  });

  it("reads the one selected system again, so its page shows it", async () => {
    await useEditorStore.getState().select(2);
    await until(() => expect(useEditorStore.getState().inspected?.system.id).toBe(2));
    mockedIpc.reloadDocument.mockResolvedValueOnce(REREAD);

    await session().noteDiskChange(changed());

    await until(() => expect(useEditorStore.getState().inspected?.system.id).toBe(2));
    expect(useEditorStore.getState().selection).toEqual([2]);
  });

  it("keeps the view: the camera, the tilt and the empires the map hides", async () => {
    expect(useGalaxyStore.getState().framed).toBe(true);
    useToolStore.getState().setTilt(30);
    useGalaxyStore.getState().toggleCountryHidden(7);
    mockedIpc.reloadDocument.mockResolvedValueOnce(REREAD);

    await session().noteDiskChange(changed());

    const galaxy = useGalaxyStore.getState();
    expect(galaxy.systems.has(3)).toBe(false);
    expect(galaxy.framed).toBe(false);
    expect(galaxy.hiddenCountries).toEqual(new Set([7]));
    expect(useToolStore.getState().tilt).toBe(30);

    mockedIpc.openDocument.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().reload();
    expect(useGalaxyStore.getState().framed).toBe(true);
    expect(useToolStore.getState().tilt).toBe(0);
  });

  it("asks instead when an edit made meanwhile stops the reload", async () => {
    mockedIpc.reloadDocument.mockRejectedValueOnce({
      kind: "op",
      message: "the document has unsaved changes",
    });

    await session().noteDiskChange(changed());

    expect(diskChangeShown(session())).toBe("banner");
    expect(session().error).toBeNull();
  });

  it("says when the file was moved or deleted, and reads nothing", async () => {
    await session().noteDiskChange(changed({ change: "gone" }));

    expect(mockedIpc.reloadDocument).not.toHaveBeenCalled();
    expect(session().notice).toBe("my_galaxy.txt was moved or deleted. Save writes it again.");
  });

  it("ignores a change to another file", async () => {
    await session().noteDiskChange(changed({ path: "C:/mods/elsewhere.txt" }));

    expect(mockedIpc.reloadDocument).not.toHaveBeenCalled();
    expect(diskChangeShown(session())).toBeNull();
  });

  it("checks the file when asked, as on window focus", async () => {
    mockedIpc.checkDocumentOnDisk.mockResolvedValueOnce(null);
    await session().checkDisk();
    expect(mockedIpc.reloadDocument).not.toHaveBeenCalled();

    mockedIpc.checkDocumentOnDisk.mockResolvedValueOnce(changed());
    mockedIpc.reloadDocument.mockResolvedValueOnce(REREAD);
    await session().checkDisk();
    expect(mockedIpc.reloadDocument).toHaveBeenCalledWith(false);
  });
});

describe("a scenario with unsaved changes", () => {
  beforeEach(async () => {
    await openScenario();
    await edit();
  });

  it("asks, and Keep my changes leaves the edits and their undo history", async () => {
    await session().noteDiskChange(changed({ dirty: true }));
    expect(mockedIpc.reloadDocument).not.toHaveBeenCalled();
    expect(diskChangeShown(session())).toBe("banner");

    await session().answerDiskChange("keep");
    expect(diskChangeShown(session())).toBe("badge");
    expect(session().dirty).toBe(true);
    expect(useEditorStore.getState().history.undo).toHaveLength(1);

    await session().noteDiskChange(changed({ dirty: true }));
    expect(diskChangeShown(session())).toBe("badge");
  });

  it("takes down the line about an earlier reload when it asks", async () => {
    session().setNotice("Reloaded my_galaxy.txt after it changed on disk.");

    await session().noteDiskChange(changed({ dirty: true }));

    expect(diskChangeShown(session())).toBe("banner");
    expect(session().notice).toBeNull();
  });

  it("Reload drops the edits and their undo history", async () => {
    await session().noteDiskChange(changed({ dirty: true }));
    mockedIpc.reloadDocument.mockResolvedValueOnce(REREAD);

    await session().answerDiskChange("reload");

    expect(mockedIpc.reloadDocument).toHaveBeenCalledWith(true);
    expect(session().dirty).toBe(false);
    expect(useEditorStore.getState().history.undo).toHaveLength(0);
    expect(diskChangeShown(session())).toBeNull();
  });

  it("saving after Keep my changes takes the badge away, and the next change asks again", async () => {
    await session().noteDiskChange(changed({ dirty: true }));
    await session().answerDiskChange("keep");
    mockedIpc.save.mockResolvedValueOnce(saveResult({ path: SCENARIO_RESULT.path }));
    mockedIpc.confirm.mockResolvedValue(true);

    await session().save();
    expect(diskChangeShown(session())).toBeNull();

    await edit();
    await flush();
    await session().noteDiskChange(changed({ dirty: true }));
    expect(diskChangeShown(session())).toBe("banner");
  });
});

describe("a save", () => {
  it("asks even with no unsaved changes", async () => {
    await session().openSave(OPEN_RESULT.path);

    await session().noteDiskChange(changed({ path: OPEN_RESULT.path }));

    expect(mockedIpc.reloadDocument).not.toHaveBeenCalled();
    expect(diskChangeShown(session())).toBe("banner");
  });
});
