import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));
vi.mock("./GameDataPanel", () => ({ GameDataPanel: () => "[game data]" }));

import { bindStores } from "../../store/bindStores";
import { useDetailsStore } from "../../store/detailsStore";
import { OPEN_RESULT, name, planetSummary, systemDetails } from "../../store/fixture";
import { usePlanetMoveStore } from "../../store/planetMoveStore";
import { useSceneStore } from "../../store/sceneStore";
import { armSession, resetStores } from "../../store/storeFixture";
import { shown } from "../../test/elements";
import { mockedIpc } from "../../test/ipc";
import { openWith } from "../../test/session";
import { CutBar } from "./CutBar";
import { StatusBar } from "./StatusBar";

bindStores();

const [SOL, EARTH, LUNA] = [0, 12, 14];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const moves = () => usePlanetMoveStore.getState();

beforeEach(async () => {
  resetStores();
  armSession();
  await openWith(OPEN_RESULT);
  const planets = [
    planetSummary({ id: EARTH, name: name("Earth"), name_key: "Earth" }),
    planetSummary({ id: LUNA, name: name("Luna"), name_key: "Luna", moon: true, parent: EARTH }),
  ];
  useDetailsStore.setState({ details: new Map([[SOL, systemDetails({ id: SOL, planets })]]) });
  mockedIpc.planetMoveTargets.mockImplementation(async (planets) => ({
    planets,
    refused: [],
    systems: [{ system: 1, warnings: [] }],
  }));
});

async function cut(...ids: number[]): Promise<void> {
  useSceneStore.getState().selectBody(SOL, ids[0]);
  for (const id of ids.slice(1)) useSceneStore.getState().toggleBody(SOL, id);
  await settle();
  moves().cutSelection();
}

describe("the cut bar", () => {
  it("says what is moving, from where, and how to paste or cancel", async () => {
    expect(renderToStaticMarkup(<CutBar />)).toBe("");
    mockedIpc.planetMoveTargets.mockResolvedValue({ planets: [EARTH], refused: [], systems: [] });
    await cut(EARTH, LUNA);
    expect(shown(renderToStaticMarkup(<CutBar />))).toBe(
      "Moving Earth from Sol · right-click a system to paste · Esc cancels",
    );
  });

  it("says a lone moon arrives as a planet", async () => {
    await cut(LUNA);
    expect(shown(renderToStaticMarkup(<CutBar />))).toContain("Moving Luna from Sol as a planet");
  });

  it("puts the paste hint and the count in the status bar in either view", async () => {
    await cut(EARTH);
    const hint = '<span class="muted">Right-click a system to paste</span>';
    const count = '<span class="muted">1 planet cut</span>';
    expect(renderToStaticMarkup(<StatusBar />)).toContain(hint + count);
    useSceneStore.getState().enterSystem(SOL);
    expect(renderToStaticMarkup(<StatusBar />)).toContain(hint + count);
    moves().cancelCut();
    expect(renderToStaticMarkup(<StatusBar />)).not.toContain(hint);
  });

  it("says how many bodies are selected in the system view, and how to add or clear them", async () => {
    useSceneStore.getState().enterSystem(SOL);
    useSceneStore.getState().selectBody(SOL, EARTH);
    expect(renderToStaticMarkup(<StatusBar />)).not.toContain("selected ·");
    useSceneStore.getState().toggleBody(SOL, LUNA);
    expect(renderToStaticMarkup(<StatusBar />)).toContain(
      "2 planets selected · Ctrl or Shift-click to add planets · Esc clears",
    );
  });
});
