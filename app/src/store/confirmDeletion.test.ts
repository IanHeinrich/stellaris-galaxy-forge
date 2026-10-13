import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import {
  colonyPage,
  megastructureSummary,
  name,
  planetPage,
  planetSummary,
  systemDetails,
} from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { openFixtureSave, sessionError } from "./editorFixture";
import { editResult, entityNode, entityView, scalar } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore, type Entry } from "./inspectorStore";
import { deleteMegastructure } from "./megastructureRemoval";
import { deletePlanet, removeColony } from "./planetRemoval";
import { deleteRingWorld } from "./ringWorldRemoval";

const FAILED = { kind: "entity", message: "nothing there" };

/** One deletion the store offers, with the reads that arm it and the pages it closes. */
interface Deletion {
  subject: string;
  /** Answers the reads, so the deletion is offered. */
  arm(): void;
  /** Makes the first read fail. */
  unreadable(): void;
  run(): Promise<boolean>;
  /** The command the apply goes through. */
  applied: () => Mock;
  /** What the command is called with. */
  args: unknown[];
  /** What the open pages are, from the root to the page that goes. */
  stack: Entry[];
  /** The pages left once the deletion is applied. */
  left: string[];
  title: string;
  asks: string;
  couldNotRead: string;
}

const SOL = { ref: { kind: "system", id: 1 }, label: "Sol" } as const;
const planetStack: Entry[] = [
  SOL,
  { ref: { kind: "body", system: 1, id: 1207 }, label: "Terra" },
  { ref: { kind: "colony", id: 18 }, label: "Colony #18" },
];

const armColony = () =>
  mockedIpc.getPlanetPage.mockResolvedValue(planetPage({ colony: colonyPage(), owner: 0 }));
const failPage = () => mockedIpc.getPlanetPage.mockRejectedValue(FAILED);

const DELETIONS: Deletion[] = [
  {
    subject: "a planet",
    arm: armColony,
    unreadable: failPage,
    run: () => deletePlanet(1207, "Terra", false),
    applied: () => mockedIpc.applyOp,
    args: [{ type: "DeleteBody", body: 1207 }],
    stack: planetStack,
    left: ["Sol"],
    title: "Terra",
    asks: "Delete Terra? Its colony goes with it",
    couldNotRead: "Couldn't read Terra, so nothing was deleted: nothing there",
  },
  {
    subject: "a colony",
    arm: armColony,
    unreadable: failPage,
    run: () => removeColony(1207, "Terra"),
    applied: () => mockedIpc.applyOp,
    args: [{ type: "RemoveColony", body: 1207 }],
    stack: planetStack,
    left: ["Sol", "Terra"],
    title: "Terra",
    asks: "Remove the colony on Terra?",
    couldNotRead: "Couldn't read Terra, so nothing was removed: nothing there",
  },
  {
    subject: "a megastructure",
    arm() {
      const nodes = [
        entityNode("type", scalar("think_tank_3", "quoted")),
        entityNode("planet", scalar("4294967295", "int")),
      ];
      mockedIpc.getEntity.mockImplementation(async (addr) =>
        entityView("megastructure", { addr, nodes, span: [1200, 1480] }),
      );
    },
    unreadable: () => mockedIpc.getEntity.mockRejectedValue(FAILED),
    run: () => deleteMegastructure(359, "Science Nexus", 0),
    applied: () => mockedIpc.deleteMegastructure,
    args: [359],
    stack: [
      { ref: { kind: "system", id: 338 }, label: "Ostiuq" },
      { ref: { kind: "megastructure", id: 359 }, label: "Science Nexus" },
      { ref: { kind: "colony", id: 18 }, label: "Colony #18" },
    ],
    left: ["Ostiuq"],
    title: "Science Nexus",
    asks: "Delete Science Nexus in Sol? It is removed from the save.",
    couldNotRead: "Couldn't read Science Nexus, so nothing was deleted: nothing there",
  },
  {
    subject: "a ring world",
    arm() {
      mockedIpc.getSystemDetails.mockResolvedValue([
        systemDetails({
          id: 0,
          planets: [
            planetSummary({ id: 2444, class: "pc_g_star" }),
            planetSummary({ id: 2447, class: "pc_ringworld_tech", colonised: true }),
          ],
          megastructures: [megastructureSummary({ id: 10, kind: "ring_world_ruined" })],
        }),
      ]);
      mockedIpc.getPlanetPage.mockImplementation(async (id: number) =>
        planetPage({
          id,
          name: name("Section"),
          name_key: "Section",
          colony: colonyPage({ id: 47 }),
          owner: 42,
        }),
      );
    },
    unreadable: () => mockedIpc.getSystemDetails.mockRejectedValue(FAILED),
    run: () => deleteRingWorld(0),
    applied: () => mockedIpc.deleteRingWorld,
    args: [0],
    stack: [
      { ref: { kind: "system", id: 0 }, label: "Sol" },
      { ref: { kind: "body", system: 0, id: 2447 }, label: "Section" },
      { ref: { kind: "colony", id: 47 }, label: "Colony #47" },
    ],
    left: ["Sol"],
    title: "Sol",
    asks: "Delete the ring world in Sol?",
    couldNotRead: "Couldn't read the ring world in Sol, so nothing was deleted: nothing there",
  },
];

const labels = () => useInspectorStore.getState().stack.map((e) => e.label);

beforeEach(async () => {
  await openFixtureSave();
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
  mockedIpc.confirm.mockResolvedValue(true);
  mockedIpc.applyOp.mockResolvedValue(editResult());
  mockedIpc.deleteMegastructure.mockResolvedValue(editResult());
  mockedIpc.deleteRingWorld.mockResolvedValue(editResult());
});

describe.each(DELETIONS)("deleting $subject", (deletion) => {
  const open = () => useInspectorStore.setState({ stack: deletion.stack });

  it("asks, applies, and closes the pages on what went", async () => {
    deletion.arm();
    open();

    expect(await deletion.run()).toBe(true);

    expect(mockedIpc.confirm).toHaveBeenCalledWith(
      expect.stringContaining(deletion.asks),
      expect.objectContaining({ title: deletion.title, kind: "warning" }),
    );
    expect(deletion.applied()).toHaveBeenCalledTimes(1);
    expect(deletion.applied()).toHaveBeenCalledWith(...deletion.args);
    expect(labels()).toEqual(deletion.left);
  });

  it("writes nothing when the user declines", async () => {
    deletion.arm();
    mockedIpc.confirm.mockResolvedValueOnce(false);
    open();

    expect(await deletion.run()).toBe(false);

    expect(deletion.applied()).not.toHaveBeenCalled();
    expect(labels()).toEqual(deletion.stack.map((e) => e.label));
  });

  it("says what it could not read, and asks nothing", async () => {
    deletion.unreadable();
    open();

    expect(await deletion.run()).toBe(false);

    expect(sessionError()).toBe(deletion.couldNotRead);
    expect(mockedIpc.confirm).not.toHaveBeenCalled();
    expect(deletion.applied()).not.toHaveBeenCalled();
  });

  it("keeps the pages open when the core refuses", async () => {
    deletion.arm();
    deletion.applied().mockRejectedValueOnce({ kind: "op", message: "a refusal" });
    open();

    expect(await deletion.run()).toBe(false);

    expect(sessionError()).toBe("a refusal");
    expect(labels()).toEqual(deletion.stack.map((e) => e.label));
  });
});
