import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioOwners } from "../../generated/ScenarioOwners";
import {
  countryNode,
  name,
  OPEN_RESULT,
  SCENARIO_OWNERS,
  SCENARIO_RESULT,
  TERRITORY,
} from "../../store/fixture";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// The row emblems come from the map's texture cache, which no test renderer can fill.
vi.mock("../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../test/drawn"));

import { bindStores } from "../../store/bindStores";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useLayoutStore } from "../../store/layoutStore";
import { armSession, resetStores } from "../../store/storeFixture";
import { drawnBy, drawnButton } from "../../test/drawn";
import { openWith } from "../../test/session";
import { Empires } from "./Empires";
import { mockedIpc } from "../../test/ipc";

bindStores();

beforeEach(() => {
  resetStores();
  armSession();
  useGameDataStore.setState({ status: "ready" });
  mockedIpc.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
});

/** Opens the scenario and stamps its territories the way `refreshScenarioOwners` does. */
async function openScenarioWithOwners(owners: ScenarioOwners = SCENARIO_OWNERS): Promise<void> {
  await useFileSessionStore.getState().openScenarioFrom(SCENARIO_RESULT.path);
  useGameDataStore.setState({ scenarioOwners: owners });
  useGalaxyStore.getState().setScriptedOwners(
    new Map(owners.owners.map((o) => [o.system, o.territory])),
    owners.territories.map((t) => t.country),
  );
}

/** The fixture's two-system territory as a fallen empire's home and the outpost it spawns. */
const FALLEN_OWNERS: ScenarioOwners = {
  ...SCENARIO_OWNERS,
  territories: [
    {
      token: "root:fallen_machine:1",
      identity: "fallen_empire",
      origin: null,
      defined_at: null,
      country: {
        ...TERRITORY,
        name: name("Fallen Machine Empire"),
        name_key: "Fallen Machine Empire",
        country_type: "fallen_empire",
        colors: [],
      },
      tier: "generation",
      assumed: false,
      claimed_by: [],
    },
  ],
};

const empires = () => renderToStaticMarkup(<Empires />);

describe("a scenario's territory rows", () => {
  it("badges the day-one territory, marks where each comes from, and counts and explains them", async () => {
    await openScenarioWithOwners();

    const html = empires();
    expect(html, "generation row").toContain("Fixture Empire");
    expect(html, "day-one row").toContain("Fixture Day One Empire");
    // Two rows, and only the day-one one carries a badge of each kind.
    expect(
      html.match(/class="chip src" title="An event gives these systems to the empire/g),
      "day-one badge",
    ).toHaveLength(1);
    expect(
      html.match(/class="chip warn" title="Galaxy Forge can&#x27;t check this claim/g),
      "assumed badge",
    ).toHaveLength(1);
    expect(html, "day-one chip").toContain(">day 1<");
    expect(html, "assumed chip").toContain(">assumed<");

    expect(
      html.match(/class="chip init" title="Their initializers give these systems/g),
      "initializers source",
    ).toHaveLength(1);
    expect(
      html.match(/class="chip src" title="An event gives these systems to this empire/g),
      "scripts source",
    ).toHaveLength(1);
    expect(html, "initializers chip").toContain(">initializers<");
    expect(html, "scripts chip").toContain(">scripts<");

    expect(html, "counts").toContain("1 claimed on day one · 1 assumed");
    expect(html, "legend").toContain("Territories are the systems the scripts hand out");
    expect(html, "legend's assumed").toContain("marked assumed");
  });

  it("lists a fallen empire's home and spawned systems under Fallen empires", async () => {
    await openScenarioWithOwners(FALLEN_OWNERS);

    const html = empires();
    expect(html).toContain("Fallen empires");
    expect(html).toContain("Fallen Machine Empire");
    expect(html).toContain("2 systems");
    expect(html).not.toContain(">Empires<");
    expect(html, "legend").toContain("A fallen empire holds its home system");
  });
});

/** One empire of the save's own, which the shared galaxy fixture has none of. */
const EMPIRE = countryNode();

describe("a save's empire rows", () => {
  it("carries no territory badge, since a save has no scripted tiers", async () => {
    await openWith(OPEN_RESULT, { galaxy: { countries: [EMPIRE] } });

    const html = empires();
    expect(html).toContain("Test Empire");
    expect(html).not.toContain('class="chip src"');
    expect(html).not.toContain('class="chip warn"');
    expect(html).not.toContain('class="chip init"');
    expect(html).not.toContain(">day 1<");
    expect(html).not.toContain(">assumed<");
  });

  it("offers a pencil on each empire that opens its page in the inspector", async () => {
    await openWith(OPEN_RESULT, { galaxy: { countries: [EMPIRE] } });
    useLayoutStore.setState({ tab: "empires", previousTab: "empires" });
    useInspectorStore.setState({
      stack: [
        { ref: { kind: "system", id: 1 }, label: "Sol" },
        { ref: { kind: "body", system: 1, id: 100 }, label: "Earth" },
      ],
      tab: "data",
    });

    const html = drawnBy(empires);
    expect(html).toContain('aria-label="Open Test Empire&#x27;s page"');
    expect(html).not.toContain("Map colours");

    drawnButton("Open Test Empire's page").onClick();
    const { stack, tab } = useInspectorStore.getState();
    expect(stack.map((e) => e.label)).toEqual(["Sol", "Test Empire"]);
    expect(stack[1].ref).toEqual({ kind: "country", id: 7 });
    expect(tab).toBe("overview");
    expect(useLayoutStore.getState()).toMatchObject({ tab: "inspector", previousTab: "empires" });
  });

  it("offers no pencil on a scenario's territories", async () => {
    await openScenarioWithOwners();

    expect(empires()).not.toContain("&#x27;s page");
  });
});
