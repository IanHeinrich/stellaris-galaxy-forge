import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { editResult, planetPage, starClassView } from "../../../store/fixture";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { open, resetStores } from "../inspectorFixture";
import { drawnBy, drawnField } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { TextField } from "../../EditField";
import {
  WORLD,
  EMPIRE,
  EMPIRE_NODE,
  landPage,
  render,
  NEKKAR_COLONY,
  armColonyData,
} from "./bodyPageFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a colony's page", () => {
  it("offers its name, size and class to edit, then shows the owner, designation, date and pops", async () => {
    await open("save");
    useGalaxyStore.setState({ countries: new Map([[EMPIRE, EMPIRE_NODE]]) });
    await landPage(NEKKAR_COLONY);
    armColonyData();

    const html = render(WORLD);
    expect(html).toContain('<span class="edit-label">Class</span>');
    expect(html).toContain("Tropical World");
    expect(html).not.toMatch(/<span class="k">Class<\/span>/);
    expect(html).not.toMatch(/<span class="k">Size<\/span>/);
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Size"[^>]*value="16"/);
    expect(html).toContain("Within a month the game demolishes districts over a lowered cap.");
    expect(html.match(/class="edit-field [^"]*"/g)).toEqual([
      'class="edit-field edit-text"',
      'class="edit-field edit-text"',
      'class="edit-field edit-toggle"',
      'class="edit-field edit-text combo-box disabled"',
      'class="edit-field dp-open"',
      'class="edit-field dp-open"',
      'class="edit-field dp-open"',
      'class="edit-field dp-open"',
      'class="edit-field dp-open"',
      'class="edit-field edit-key-sample"',
    ]);
    expect(html).toMatch(/<input type="text" aria-label="Name"/);
    expect(html).toContain("+ Add modifier…");
    expect(html).toContain("+ Add dig site…");
    expect(html).toContain("Add deposit");
    expect(html).toContain("+ Add anomaly…");
    expect(html.match(/pl-dep-remove/g)).toHaveLength(3);

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnBy(() => render(WORLD));
    const nameField = drawnField(TextField, "Name") as { onCommit(v: string): void };
    nameField.onCommit(" Nova Terra ");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "RenameBody",
        body: WORLD,
        name: { Literal: "Nova Terra" },
      }),
    );
    expect(html).toContain("Colony");
    expect(html).toContain('title="Open the empire&#x27;s page"');
    expect(html).toContain("Ti Zru Conservers");
    expect(html).toContain("Fallen Empire Colony");
    expect(html).toContain("2200.01.01");
    expect(html).toContain("1,600 · Ti-Zru 800 · Synthetic 800");
    expect(html).toContain('title="Open the colony&#x27;s page"');
    expect(html).toContain("#29");
    for (const left of ["Stability", "Housing", "Amenities", "Habitab"]) {
      expect(html).not.toContain(left);
    }
    expect(html).not.toContain("radius 60");
    expect(html).not.toContain("Controller");
    expect(html.indexOf("Deposits")).toBeLessThan(html.indexOf("Colonised"));
    expect(html.indexOf("Colonised")).toBeLessThan(html.indexOf("About"));
  });
});

describe("a colony's removal and a planet's deletion", () => {
  const COLONY = planetPage({
    id: WORLD,
    class: "pc_tropical",
    owner: EMPIRE,
    controller: EMPIRE,
    colony: {
      id: 29,
      colonised: "2200.01.01",
      final_designation: null,
      designation: null,
      pops: 1600,
      species: [],
      districts: [],
      zones: [],
      buildings: [],
    },
  });

  it("offers Remove colony in the colony's section and Delete planet below the moons, apart", async () => {
    await open("save");
    await landPage(COLONY);

    const html = render(WORLD);
    expect(html).toContain(">Remove colony</button>");
    expect(html).toContain(">Delete planet</button>");
    expect(html.indexOf("Remove colony")).toBeLessThan(html.indexOf("About"));
    expect(html.indexOf("About")).toBeLessThan(html.indexOf("Delete planet"));
    expect(mockedIpc.checkOp).toHaveBeenCalledWith({ type: "RemoveColony", body: WORLD });
    expect(mockedIpc.checkOp).toHaveBeenCalledWith({ type: "DeleteBody", body: WORLD });
  });

  it("shows why the core refuses, and disables the action", async () => {
    await open("save");
    await landPage(COLONY);
    const refusal =
      "the colony on planet 100 cannot be removed: a megastructure stands on or around it, which has not been tried in game";
    mockedIpc.checkOp.mockImplementation(async (op) =>
      op.type === "RemoveColony" ? refusal : null,
    );
    render(WORLD);
    await vi.waitFor(() => expect(render(WORLD)).toContain(refusal));

    const html = render(WORLD);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Remove colony<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Delete planet<\/button>/);
  });

  it("offers neither on a save's star", async () => {
    await open("save");
    await landPage({ ...planetPage({ id: WORLD }), class: "pc_g_star" });
    useGameDataStore.setState({
      starClasses: new Map([starClassView("sc_g", "pc_g_star")].map((v) => [v.key, v])),
    });
    const html = render(WORLD);
    expect(html).not.toContain("Delete planet");
    expect(html).not.toContain("Remove colony");
  });
});
