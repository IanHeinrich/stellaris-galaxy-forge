import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import {
  entityAddr,
  refFor,
  refKey,
  tabsFor,
  useInspectorStore,
  type Entry,
} from "./inspectorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { useLayoutStore } from "./layoutStore";

const inspector = () => useInspectorStore.getState();

const SOL: Entry = { ref: { kind: "system", id: 452 }, label: "Sol" };
const ALPHARD: Entry = { ref: { kind: "system", id: 12 }, label: "Alphard" };
const EARTH: Entry = { ref: { kind: "planet", id: 1207 }, label: "Earth" };
const LUNA: Entry = { ref: { kind: "planet", id: 1208 }, label: "Luna" };
const COLONY: Entry = { ref: { kind: "colony", id: 1207 }, label: "Earth colony" };
const SHIPS: Entry = {
  ref: { kind: "nodelist", parent: { kind: "fleet", id: 88 }, path: ["ships"], of: "ship" },
  label: "Ships",
};

const stored = new Map<string, string>();

beforeEach(() => {
  stubPrefs(stored);
  useInspectorStore.setState(useInspectorStore.getInitialState());
  useLayoutStore.setState({ tab: "inspector", collapsed: false });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const labels = () => inspector().stack.map((e) => e.label);

describe("the entity stack", () => {
  it("restarts on a new selection and leaves a drill-down alone when the same one arrives again", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    expect(labels()).toEqual(["Sol", "Earth"]);

    inspector().setRoot({ ...SOL });
    expect(labels()).toEqual(["Sol", "Earth"]);

    inspector().setRoot(ALPHARD);
    expect(labels()).toEqual(["Alphard"]);
  });

  it("pushes a child of a child onto the same stack rather than nesting, and goes back", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    inspector().open(LUNA);
    expect(labels()).toEqual(["Sol", "Earth", "Luna"]);

    inspector().back();
    expect(labels()).toEqual(["Sol", "Earth"]);
    inspector().popTo(0);
    expect(labels()).toEqual(["Sol"]);
    inspector().back();
    expect(labels()).toEqual(["Sol"]);
  });

  it("ignores opening what is already on top", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    inspector().open({ ...EARTH, label: "Earth" });
    expect(labels()).toEqual(["Sol", "Earth"]);
  });

  it("follows a renamed root without losing the stack", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    inspector().setRoot({ ...SOL, label: "Sol renamed" });
    expect(labels()).toEqual(["Sol renamed", "Earth"]);
  });
});

describe("the Galaxy crumb", () => {
  it("brings a page opened over the galaxy back to the galaxy", () => {
    const empire: Entry = { ref: { kind: "country", id: 7 }, label: "Hissma Consciousness" };
    inspector().openPage(empire);
    expect(inspector().stack.map((e) => e.label)).toEqual(["Galaxy", "Hissma Consciousness"]);
    expect(inspector().home()).toBe(true);
    expect(inspector().stack.map((e) => e.label)).toEqual(["Galaxy"]);
  });

  it("leaves a selected system's stack to the selection to clear", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    expect(inspector().home()).toBe(false);
    expect(inspector().stack).toEqual([SOL, EARTH]);
  });
});

describe("back", () => {
  const empire: Entry = { ref: { kind: "country", id: 7 }, label: "Hissma Consciousness" };

  it("returns a page opened from another tab of the dock to that tab", () => {
    useLayoutStore.setState({ tab: "empires", previousTab: "empires" });
    inspector().openPage(empire);
    expect(useLayoutStore.getState().tab).toBe("inspector");

    inspector().back();

    expect(useLayoutStore.getState().tab).toBe("empires");
    expect(labels()).toEqual(["Galaxy"]);
  });

  it("stays in the inspector for a page opened from inside it", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);

    inspector().back();

    expect(useLayoutStore.getState().tab).toBe("inspector");
    expect(labels()).toEqual(["Sol"]);
  });

  it("names where it goes", () => {
    useLayoutStore.setState({ tab: "empires", previousTab: "empires" });
    inspector().openPage(empire);
    expect(inspector().backTo()).toBe("empires");
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    expect(inspector().backTo()).toBe("inspector");
  });
});

describe("drilling across kinds", () => {
  it("walks a system to a planet to its colony without nesting, and Alt+Left comes back", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    inspector().open(COLONY);
    expect(labels()).toEqual(["Sol", "Earth", "Earth colony"]);
    expect(inspector().stack.map((e) => e.ref.kind)).toEqual(["system", "planet", "colony"]);

    inspector().back();
    expect(labels()).toEqual(["Sol", "Earth"]);
  });

  it("keys a node list by the entity it belongs to and the path inside it", () => {
    expect(refKey(SHIPS.ref)).toBe("nodelist:fleet:88/ships");
    expect(entityAddr(SHIPS.ref)).toEqual({ kind: "fleet", id: 88 });
    expect(entityAddr({ kind: "galaxy" })).toBeNull();
    expect(tabsFor(SHIPS.ref)).toEqual(["data"]);
  });

  it("keys a station by its own id, and opens one only where its system is known", () => {
    const ref = refFor({ kind: "starbase", id: 77 }, 452);
    expect(ref).toEqual({ kind: "starbase", system: 452, id: 77 });
    expect(refKey(ref!)).toBe("starbase:77");
    expect(refFor({ kind: "starbase", id: 77 }, null)).toBeNull();
    expect(refFor({ kind: "country", id: 12 }, null)).toEqual({ kind: "country", id: 12 });
  });

  it("pops one crumb on Esc and gives the key up once the stack is a single entity", () => {
    useLayoutStore.setState({ tab: "inspector", collapsed: false });
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    expect(inspector().escape()).toBe(true);
    expect(labels()).toEqual(["Sol"]);

    expect(inspector().escape()).toBe(false);
    expect(labels()).toEqual(["Sol"]);
  });

  it("leaves Esc alone while the dock shows something else, so it clears the selection", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);

    useLayoutStore.setState({ tab: "changes", collapsed: false });
    expect(inspector().escape()).toBe(false);
    useLayoutStore.setState({ tab: "inspector", collapsed: true });
    expect(inspector().escape()).toBe(false);
    expect(labels()).toEqual(["Sol", "Earth"]);

    useLayoutStore.setState({ collapsed: false });
    expect(inspector().escape()).toBe(true);
  });
});

describe("tabs", () => {
  it("keeps a tab the next entity offers and falls back to its first otherwise", () => {
    inspector().setRoot(SOL);
    inspector().setTab("lanes");
    inspector().setRoot(ALPHARD);
    expect(inspector().tab).toBe("lanes");

    inspector().open(EARTH);
    expect(inspector().tab).toBe("overview");
    expect(tabsFor(EARTH.ref)).not.toContain("lanes");

    inspector().setTab("data");
    inspector().back();
    expect(inspector().tab).toBe("data");

    expect(tabsFor({ kind: "galaxy" })).toEqual(["overview"]);
    expect(tabsFor({ kind: "selection" })).toEqual(["overview"]);
    expect(tabsFor({ kind: "lane", a: 1, b: 2 })).toEqual(["overview"]);
  });

  it("gives a scenario system its scripts in place of the Data table a save's system has", () => {
    expect(tabsFor(SOL.ref, true, { scripts: true, data: false })).toEqual([
      "overview",
      "scripts",
      "contents",
      "lanes",
      "source",
    ]);
    expect(tabsFor(SOL.ref, true, { scripts: false, data: true })).toEqual([
      "overview",
      "contents",
      "lanes",
      "data",
      "source",
    ]);
  });

  it("does not hand a tab back once the open document's own flags stop offering it", () => {
    useFileSessionStore.setState({ kind: "scenario" });
    useGameDataStore.setState({ status: "ready" });
    inspector().setRoot(SOL);
    inspector().setTab("scripts");
    expect(inspector().tab).toBe("scripts");

    useGameDataStore.setState({ status: "idle" });
    inspector().setRoot(ALPHARD);
    expect(inspector().tab).toBe("overview");
  });

  it("drops Contents from a kind whose entity turns out to list nothing", () => {
    expect(tabsFor(COLONY.ref)).toEqual(["overview", "contents", "data", "source"]);
    expect(tabsFor(COLONY.ref, false)).toEqual(["overview", "data", "source"]);
    expect(tabsFor(SOL.ref, false)).toContain("contents");
  });
});

describe("sections", () => {
  it("toggles from each section's own default and remembers what the user chose", () => {
    expect(inspector().collapsed("system.planets", false)).toBe(false);
    expect(inspector().collapsed("system.flags", true)).toBe(true);

    inspector().toggleSection("system.flags", true);
    expect(inspector().collapsed("system.flags", true)).toBe(false);
    inspector().toggleSection("system.planets", false);
    expect(inspector().collapsed("system.planets", false)).toBe(true);
    expect(stored.get("sgf.inspector.sections")).toBe(
      JSON.stringify({ "system.flags": false, "system.planets": true }),
    );
  });

  it("resets only the sections it is given, leaving the rest as the user left them", () => {
    inspector().toggleSection("system.planets", false);
    inspector().toggleSection("system.scripts", true);
    inspector().toggleSection("system.flags", true);

    inspector().resetSections(["system.planets", "system.scripts", "system.station"]);

    expect(inspector().collapsed("system.planets", false)).toBe(false);
    expect(inspector().collapsed("system.scripts", true)).toBe(true);
    expect(inspector().collapsed("system.flags", true)).toBe(false);
    expect(stored.get("sgf.inspector.sections")).toBe(JSON.stringify({ "system.flags": false }));
  });
});
