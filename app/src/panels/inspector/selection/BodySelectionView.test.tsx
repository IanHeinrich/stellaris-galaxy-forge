import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import type { PlanetMoveTargets } from "../../../generated/PlanetMoveTargets";
import { bindStores } from "../../../store/bindStores";
import { useDetailsStore } from "../../../store/detailsStore";
import { countryNode, systemDetails } from "../../../store/fixture";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { GALAXY_ENTRY, useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { usePlanetMoveStore } from "../../../store/planetMoveStore";
import { useSceneStore } from "../../../store/sceneStore";
import { drawnBy, drawnButton } from "../../../test/drawn";
import { escaped, shown } from "../../../test/elements";
import { mockedIpc } from "../../../test/ipc";
import { open, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { BodySelectionView } from "./BodySelectionView";
import { summaryStep } from "./bodySelectionPage";

bindStores();

const SYZYGY = 7;
const [KORTOL, GIANT, GIANT_A, GIANT_B, URAY, URAY_A] = [20, 21, 22, 23, 24, 25];
const ENTRY: Entry = { ref: { kind: "bodies", system: SYSTEM }, label: "3 selected" };

const moves = () => usePlanetMoveStore.getState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const page = () => drawnBy(() => renderToStaticMarkup(<BodySelectionView entry={ENTRY} />));

function targets(planets: number[], over: Partial<PlanetMoveTargets> = {}): PlanetMoveTargets {
  return { planets, refused: [], systems: [{ system: 0, warnings: [] }], ...over };
}

beforeEach(async () => {
  resetStores();
  await open("save");
  useSceneStore.getState().enterSystem(SYSTEM);
  const planets = [
    planet(KORTOL, "Kortol's Station", { colonised: true, owner: SYZYGY }),
    planet(GIANT, "Meissa IV", { class: "pc_gas_giant" }),
    planet(GIANT_A, "Meissa IVa", { moon: true, parent: GIANT }),
    planet(GIANT_B, "Meissa IVb", { moon: true, parent: GIANT }),
    planet(URAY, "Uray III"),
    planet(URAY_A, "Uray IIIa", { moon: true, parent: URAY }),
  ];
  useDetailsStore.setState({
    details: new Map([[SYSTEM, systemDetails({ id: SYSTEM, planets })]]),
  });
  useGameDataStore.setState({ names: new Map([["pc_gas_giant", "Gas Giant"]]) });
  useGalaxyStore.setState({
    countries: new Map([
      [
        SYZYGY,
        countryNode({
          id: SYZYGY,
          name_key: "Syzygy",
          name: { key: "Syzygy", literal: true, variables: [] },
        }),
      ],
    ]),
  });
  mockedIpc.planetMoveTargets.mockImplementation(async (ids) => targets(ids));
  moves().selectBody(SYSTEM, KORTOL);
  moves().toggleBody(SYSTEM, GIANT);
  moves().toggleBody(SYSTEM, URAY_A);
});

describe("the selected bodies' summary", () => {
  it("says what moves, what comes along and which planet a lone moon leaves", () => {
    const text = shown(page());
    expect(text).toContain("3 planets 3 planets · 2 moons come along · Uray IIIa leaves Uray III");
    expect(text).toContain("Planets · 3");
    expect(text).toContain("Kortol's Station › · Syzygy colony ×");
    expect(text).toContain("Meissa IV › · Gas Giant · 2 moons ×");
    expect(text).toContain("Uray IIIa › · moon of Uray III ×");
    expect(text).toContain("Also in the right-click menu on the map.");
  });

  it("drops a body from the selection with its ×", () => {
    page();
    drawnButton("Remove Meissa IV from the selection").onClick();
    expect(moves().selection?.ids).toEqual([KORTOL, URAY_A]);
  });

  it("opens the last body's page when its × leaves one", () => {
    moves().toggleBody(SYSTEM, URAY_A);
    page();
    drawnButton("Remove Meissa IV from the selection").onClick();
    expect(moves().selection?.ids).toEqual([KORTOL]);
    const { stack } = useInspectorStore.getState();
    expect(stack[stack.length - 1]).toEqual({
      ref: { kind: "planet", id: KORTOL },
      label: "Kortol's Station",
    });
  });

  it("cuts the bodies, then cancels the move", async () => {
    await settle();
    page();
    drawnButton("Cut 3 planets").onClick();
    expect(moves().cut).toMatchObject({ planets: [KORTOL, GIANT, URAY_A], from: SYSTEM });

    const html = page();
    expect(html).toContain(">Cancel move</button>");
    expect(html).toContain("Cut. Right-click a system to paste them there.");
    drawnButton("Cancel move").onClick();
    expect(moves().cut).toBeNull();
  });

  it("disables Cut with the core's refusal", async () => {
    const reason =
      "Kortol's Station is occupied by Hissman Consciousness: occupied planets can't move";
    mockedIpc.planetMoveTargets.mockResolvedValue(
      targets([KORTOL, GIANT, URAY_A], {
        refused: [{ planet: KORTOL, reason }],
        systems: [],
      }),
    );
    moves().toggleBody(SYSTEM, URAY_A);
    moves().toggleBody(SYSTEM, URAY_A);
    await settle();
    expect(page()).toContain(`disabled="" title="${escaped(reason)}">Cut 3 planets</button>`);
  });
});

describe("the summary's place on the inspector's stack", () => {
  const root: Entry = { ref: { kind: "system", id: SYSTEM }, label: "Alpha Centauri" };
  const summary: Entry = { ref: { kind: "bodies", system: SYSTEM }, label: "2 selected" };
  const two = { system: SYSTEM, ids: [KORTOL, GIANT] };

  it("opens above the shown system's page with two or more bodies selected", () => {
    expect(summaryStep(two, SYSTEM, [root], { selection: null, stack: [root] })).toEqual({
      kind: "open",
      entry: summary,
    });
    expect(summaryStep(two, SYSTEM, [root, summary], { selection: two, stack: [root] })).toBeNull();
    expect(summaryStep(two, null, [root], { selection: null, stack: [root] })).toBeNull();
    expect(summaryStep(two, SYSTEM, [GALAXY_ENTRY], { selection: null, stack: [] })).toBeNull();
  });

  it("follows the count, and goes once fewer than two are selected", () => {
    const three = { system: SYSTEM, ids: [KORTOL, GIANT, URAY] };
    expect(
      summaryStep(three, SYSTEM, [root, summary], { selection: two, stack: [root, summary] }),
    ).toEqual({ kind: "open", entry: { ...summary, label: "3 selected" } });
    const one = { system: SYSTEM, ids: [KORTOL] };
    expect(summaryStep(one, SYSTEM, [root, summary], { selection: two, stack: [root] })).toEqual({
      kind: "pop",
    });
  });

  it("clears the selection when its crumbs leave it, and keeps a planet page opened from it", () => {
    const before = { selection: two, stack: [root, summary] };
    expect(summaryStep(two, SYSTEM, [root], before)).toEqual({ kind: "clear" });
    const earth: Entry = { ref: { kind: "planet", id: KORTOL }, label: "Kortol's Station" };
    expect(summaryStep(two, SYSTEM, [root, summary, earth], before)).toBeNull();
    expect(useInspectorStore.getState().stack).toHaveLength(1);
  });
});
