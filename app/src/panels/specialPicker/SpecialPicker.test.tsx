import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import type { ClusterRoll } from "../../generated/ClusterRoll";
import type { PickSummary } from "../../generated/PickSummary";
import {
  clusterMember,
  clusterPick,
  pickSummary as summary,
  starClassView,
} from "../../test/builders";
import type { SpecialLayout } from "../../generated/SpecialLayout";
import type { SpecialPick } from "../../generated/SpecialPick";
import { bindStores } from "../../store/bindStores";
import { editResult, OPEN_RESULT, SCENARIO_RESULT } from "../../store/fixture";
import { useGameDataStore } from "../../store/gameDataStore";
import { rolledSystems } from "../../lib/specialPicks";
import { specialLinksNow } from "../../store/specialLinks";
import { useSpecialPickerStore } from "../../store/specialPickerStore";
import { armSession, resetStores } from "../../store/storeFixture";
import { drawnBrowseKeys, drawnButton, drawnBy, drawnCheckbox, lastDrawn } from "../../test/drawn";
import { shown } from "../../test/elements";
import { mockedIpc } from "../../test/ipc";
import { stubPrefs } from "../../test/prefs";
import { openWith } from "../../test/session";
import { flush } from "../../test/flush";
import { until } from "../../test/wait";
import { SpecialPicker } from "./SpecialPicker";

bindStores();

const stored = new Map<string, string>();

const layout = (
  key: string,
  label: string,
  extra: Partial<SpecialLayout> = {},
  card: Partial<PickSummary> = {},
): SpecialPick => ({
  layout: {
    key,
    label,
    unique: false,
    capped: false,
    in_galaxy: 0,
    dlc: null,
    group: null,
    ...extra,
  },
  summary: summary({
    ...(extra.capped ? { max_instances: 1, in_galaxy: extra.in_galaxy } : {}),
    ...card,
  }),
});

const SEDDOM = layout(
  "breachsealer_system",
  "Seddom",
  { unique: true },
  {
    comes_with: [{ kind: "anomaly", key: "BREACHSEALER_CAT", name: "Breachsealer" }],
    comes_without: ["ambient_objects"],
  },
);
const SOL = layout(
  "sol_system",
  "Sol",
  { unique: true, capped: true, in_galaxy: 1 },
  { comes_without: ["pre_ftl_civilisation"], story_kept_by_existing: true },
);
const ARBOREAL = layout("wooden", "Arboreal World", { dlc: { name: "Cosmic Storms", met: false } });
const METAL = layout("metal", "Metal Planet", { dlc: { name: "Cosmic Storms", met: true } });
const RING = layout("ring", "Ring Cluster", { group: "Zeta Mod" });
const STORY = layout("story", "Story System", { group: "Alpha Mod" });
const PICKS = [RING, SOL, ARBOREAL, STORY, SEDDOM, METAL];
const RATLINGS = clusterPick(
  { dlc: { name: "Distant Stars", met: true } },
  {
    star_classes: [
      { key: "sc_pulsar", name: "Pulsar" },
      { key: "sc_m", name: "Class M Star" },
    ],
  },
);
const LEADER = clusterPick(
  {
    key: "legendary_leader",
    label: "Legendary Leader",
    phrase: "the Legendary Leader's sites",
    layouts: ["paragon_1", "paragon_2", "paragon_3", "paragon_4"],
    lanes: 3,
    in_galaxy: 1,
  },
  {
    max_instances: 1,
    in_galaxy: 1,
    story_kept_by_existing: true,
    comes_with: [{ kind: "dig_site", key: "LEGEND_SITE", name: "A Legend's Trail" }],
  },
);
const RATLINGS_KEY = "cluster:junk_ratlings";
const LEADER_KEY = "cluster:legendary_leader";
const ROLL: ClusterRoll = {
  members: [
    clusterMember("Ratling Home", { x: -50, y: -20, star_class: "sc_pulsar" }),
    clusterMember("Ruinous Core", { layout: "ratling_1_2", x: -10, y: 10 }),
    clusterMember("Silent Colony", { layout: "ratling_1_3", x: -90, y: 15 }),
  ],
  lanes: [
    [0, 1],
    [0, 2],
  ],
};
const TOO_CLOSE = "Too close to Ostrava: 4 away, the game needs 10";
const REFUSED: ClusterRoll = {
  ...ROLL,
  members: ROLL.members.map((m, i) => (i === 2 ? { ...m, refused: TOO_CLOSE } : m)),
};

const picker = () => useSpecialPickerStore.getState();
const rolledWith = () => mockedIpc.rollSpecialCluster.mock.calls.map(([seed]) => seed);

/** The existing systems a layout placed at (x, y) is joined to, as the planner lays them now. */
const linksAt = (x: number, y: number) =>
  specialLinksNow({ places: [{ x, y, star_class: null, refused: null }], lanes: [] }).map(
    ([, system]) => system,
  );

/** Opens the picker at the world point `at`, beside `anchor`, once its rows are read. */
async function openPicker(at: { x: number; y: number }, anchor: { x: number; y: number }) {
  picker().openAt(at, anchor);
  await until(() => expect(picker().entries).not.toBeNull());
}
const render = () => drawnBy(() => renderToStaticMarkup(<SpecialPicker />));
const rowKeys = (html: string) => [...html.matchAll(/id="sp-row-([^"]+)"/g)].map((m) => m[1]);
const groupLabels = (html: string) =>
  [...html.matchAll(/<span class="browse-group-label">([^<]+)<\/span>/g)].map((m) => m[1]);

/**
 * Presses `key` in the search field as the picker stands now; the static renderer attaches no
 * ref, so the field's own ref is null, as the target is.
 */
function press(key: string) {
  render();
  drawnBrowseKeys()({
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    target: null,
    preventDefault: vi.fn(),
  });
}

beforeEach(async () => {
  resetStores();
  stubPrefs(stored);
  armSession();
  await openWith(OPEN_RESULT);
  useGameDataStore.setState({ status: "ready" });
  mockedIpc.getSpecialLayouts.mockResolvedValue(PICKS);
  mockedIpc.getSpecialClusters.mockResolvedValue([RATLINGS, LEADER]);
  mockedIpc.addSpecialSystem.mockResolvedValue(editResult({ delta: { systems: [] } }));
  mockedIpc.addSpecialCluster.mockResolvedValue(editResult({ delta: { systems: [] } }));
  mockedIpc.rollSpecialCluster.mockResolvedValue(ROLL);
});

describe("the Special picker", () => {
  it("draws nothing until Special… opens it", () => {
    expect(render()).toBe("");
  });

  it("opens beside the right-clicked point with no scrim", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 400, y: 300 });
    picker().highlight(METAL.layout.key);
    const html = render();
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-label="Add a special system"/);
    expect(html).not.toContain("browse-scrim");
    expect(html).toContain("New system at -50.00, -20.00");
  });

  it("groups the clusters and layouts, pinned and recent first, each group in label order", async () => {
    useSpecialPickerStore.setState({ pinned: ["metal"], recent: [RATLINGS_KEY, "ring", "gone"] });
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    const html = render();

    expect(groupLabels(html)).toEqual([
      "All",
      "Pinned",
      "Recent",
      "Clusters",
      "Unique systems",
      "Other special systems",
      "Alpha Mod",
      "Zeta Mod",
    ]);
    expect(shown(html)).toContain("All 8");
    expect(rowKeys(html)).toEqual([
      RATLINGS_KEY,
      LEADER_KEY,
      "breachsealer_system",
      "sol_system",
      "wooden",
      "metal",
      "story",
      "ring",
    ]);

    picker().setGroup("pinned");
    expect(rowKeys(render())).toEqual(["metal"]);
    picker().setGroup("other");
    expect(rowKeys(render())).toEqual(["wooden", "metal"]);
    picker().setGroup("recent");
    expect(rowKeys(render())).toEqual([RATLINGS_KEY, "ring"]);
  });

  it("filters the rows by name", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().setQuery("  WOR ");
    expect(rowKeys(render())).toEqual(["wooden"]);
    picker().setQuery("nothing like it");
    expect(render()).toContain("Nothing matches that search.");
  });

  it("shows and places nothing while the search leaves no row", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(METAL.layout.key);
    picker().setQuery("nothing like it");
    const html = render();
    expect(html).toContain("Nothing highlighted.");
    expect(html).not.toContain("New system at");
    expect(drawnButton("Place").disabled).toBe(true);

    press("Enter");
    expect(await picker().place()).toBe(false);
    expect(mockedIpc.addSpecialSystem).not.toHaveBeenCalled();
  });

  it("marks a layout already in the galaxy, a DLC the save has and one it lacks", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    const html = render();
    expect(html.match(/aria-label="Already in this galaxy"/g)).toHaveLength(2);
    expect(html).toContain('<span class="sp-count">3 systems</span>');
    expect(html).toContain('<span class="sp-count">4 systems</span>');
    expect(html).toContain('<span class="sp-dlc" title="Distant Stars">DLC</span>');
    expect(html).toContain('<span class="sp-dlc" title="Cosmic Storms">DLC</span>');
    expect(html).toContain("Needs Cosmic Storms, which this save doesn&#x27;t have");
  });

  it("shows the option only for a layout that comes with something", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(SEDDOM.layout.key);
    let html = render();
    expect(html).toContain("Add its anomalies, dig sites and megastructures");
    expect(shown(html)).toContain("Comes with Breachsealer");
    expect(shown(html)).toContain("Comes without debris, wrecks and storms");

    picker().highlight(METAL.layout.key);
    html = render();
    expect(html).not.toContain("Add its anomalies");
  });

  it("draws a layout of several stars, stars only, with its class's stars in their places", async () => {
    const pair = starClassView("sc_pair", "pc_b_star", "pc_neutron_star");
    useGameDataStore.setState({ starClasses: new Map([[pair.key, pair]]) });
    const twin: SpecialPick = {
      ...layout("twin", "Twin Stars", {}, { star_classes: [{ key: "sc_pair", name: "Pair" }] }),
      diagram: {
        stars: [
          { x: -10, y: 0, orbit: 10 },
          { x: 10, y: 0, orbit: 10 },
        ],
      },
    };
    mockedIpc.getSpecialLayouts.mockResolvedValue([...PICKS, twin]);
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight("twin");
    expect(render().match(/class="star-diagram-star"/g)).toHaveLength(2);
    picker().highlight(METAL.layout.key);
    expect(render()).not.toContain("star-diagram");
  });

  it("says when the galaxy's own copy keeps the event chain, and what is not added", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(SOL.layout.key);
    const html = render();
    expect(html).toContain(
      "Sol is already in this galaxy, so its event chain stays with that one.",
    );
    expect(shown(html)).toContain("Comes without a pre-FTL civilisation");
  });

  it("places the highlighted layout at the point and closes, noting it as recent", async () => {
    picker().setJoin(true);
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(METAL.layout.key);
    render();
    drawnButton("Place").onClick();

    await until(() => expect(picker().open).toBe(false));
    const [seed, x, y, key, extras, links] = mockedIpc.addSpecialSystem.mock.calls[0];
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect([x, y, key, extras]).toEqual([-50, -20, "metal", true]);
    expect(links).toEqual(linksAt(-50, -20));
    expect(links.length).toBeGreaterThan(0);
    expect(picker().recent).toEqual(["metal"]);
  });

  it("joins to nearby systems only when told to, and remembers it", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(METAL.layout.key);
    expect(render()).toContain("Join to nearby systems");
    expect(picker().join).toBe(false);
    picker().setJoin(true);
    expect(stored.get("sgf.special.join")).toBe("true");
    picker().setJoin(false);
    expect(stored.get("sgf.special.join")).toBe("false");

    render();
    drawnButton("Place").onClick();
    await until(() => expect(mockedIpc.addSpecialSystem).toHaveBeenCalledTimes(1));
    expect(mockedIpc.addSpecialSystem.mock.calls[0][5]).toEqual([]);
  });

  it("places on Enter and on a double click", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(METAL.layout.key);
    press("Enter");
    await until(() => expect(mockedIpc.addSpecialSystem).toHaveBeenCalledTimes(1));

    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    render();
    (
      lastDrawn(({ props }) => props.id === "sp-row-metal", "the row") as { onDoubleClick(): void }
    ).onDoubleClick();
    await until(() => expect(mockedIpc.addSpecialSystem).toHaveBeenCalledTimes(2));
  });

  it("sends the option to the add, lists the plantings as left out without it, and remembers it", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(SEDDOM.layout.key);
    render();
    (drawnCheckbox() as unknown as { onChange(e: unknown): void }).onChange({
      currentTarget: { checked: false },
    });
    expect(picker().extras).toBe(false);
    expect(stored.get("sgf.special.extras")).toBe("false");

    const html = render();
    expect(shown(html)).not.toContain("Comes with Breachsealer");
    expect(shown(html)).toContain("Comes without Breachsealer, debris, wrecks and storms");

    drawnButton("Place").onClick();
    await until(() => expect(mockedIpc.addSpecialSystem).toHaveBeenCalledTimes(1));
    expect(mockedIpc.addSpecialSystem.mock.calls[0].slice(1, 5)).toEqual([
      -50,
      -20,
      "breachsealer_system",
      false,
    ]);
  });

  it("shows why a refused point can't take a system, and won't place there", async () => {
    await openPicker({ x: 3, y: 0 }, { x: 0, y: 0 });
    picker().highlight(METAL.layout.key);
    const html = render();
    expect(html).toMatch(/Too close to [^<]+: 3 away, the game needs 10/);
    expect(drawnButton("Place").disabled).toBe(true);

    press("Enter");
    expect(mockedIpc.addSpecialSystem).not.toHaveBeenCalled();
  });
});

describe("a cluster in the Special picker", () => {
  it("rolls its systems round the point and shows them, with Shuffle beside Place", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(RATLINGS_KEY);
    await until(() => expect(picker().roll).toEqual({ kind: "rolled", roll: ROLL }));

    expect(mockedIpc.rollSpecialCluster.mock.calls[0]).toEqual([
      picker().seed,
      -50,
      -20,
      "junk_ratlings",
    ]);
    const html = render();
    expect(shown(html)).toContain("Stars Pulsar and Class M Star");
    expect(shown(html)).toContain("Systems Ratling Home, Ruinous Core, Silent Colony");
    expect(html).toContain("3 new systems around -50.00, -20.00");
    expect(html).toContain("ratling_1_1 + ratling_1_2 + ratling_1_3");
    expect(html).not.toContain("Add its anomalies");
    expect(drawnButton("Place").disabled).toBe(false);

    const first = picker().seed;
    drawnButton("Shuffle").onClick();
    await until(() => expect(mockedIpc.rollSpecialCluster).toHaveBeenCalledTimes(2));
    expect(rolledWith()[1]).toBe(picker().seed);
    expect(picker().seed).not.toBe(first);

    picker().highlight(METAL.layout.key);
    expect(picker().roll).toBeNull();
    expect(render()).not.toContain("Shuffle");
  });

  it("places the systems as rolled, and notes the cluster as recent", async () => {
    picker().setJoin(true);
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(RATLINGS_KEY);
    await until(() => expect(picker().roll?.kind).toBe("rolled"));
    press("Enter");

    await until(() => expect(picker().open).toBe(false));
    const links = specialLinksNow(rolledSystems(ROLL));
    expect(links.length).toBeGreaterThan(0);
    expect(mockedIpc.addSpecialCluster.mock.calls).toEqual([
      [rolledWith()[0], -50, -20, "junk_ratlings", true, links],
    ]);
    expect(mockedIpc.addSpecialSystem).not.toHaveBeenCalled();
    expect(picker().recent).toEqual([RATLINGS_KEY]);
  });

  it("names a system that can't go where it was rolled, and won't place until a shuffle fits", async () => {
    mockedIpc.rollSpecialCluster.mockResolvedValueOnce(REFUSED);
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(RATLINGS_KEY);
    await until(() => expect(picker().roll).toEqual({ kind: "rolled", roll: REFUSED }));

    const html = render();
    expect(shown(html)).toContain(`Silent Colony: ${TOO_CLOSE}`);
    const place = drawnButton("Place") as { disabled?: boolean; title?: string };
    expect(place.disabled).toBe(true);
    expect(place.title).toBe(`Silent Colony: ${TOO_CLOSE}`);
    expect(await picker().place()).toBe(false);

    picker().shuffle();
    await until(() => expect(picker().roll).toEqual({ kind: "rolled", roll: ROLL }));
    render();
    expect(drawnButton("Place").disabled).toBe(false);
    expect(mockedIpc.addSpecialCluster).not.toHaveBeenCalled();
  });

  it("won't place before its systems are rolled", async () => {
    mockedIpc.rollSpecialCluster.mockReturnValueOnce(new Promise(() => {}));
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(RATLINGS_KEY);
    render();
    expect(drawnButton("Place").disabled).toBe(true);
    expect(await picker().place()).toBe(false);
  });

  it("keeps the newest roll when an older one answers late", async () => {
    let answer!: (roll: ClusterRoll) => void;
    mockedIpc.rollSpecialCluster.mockReturnValueOnce(new Promise((done) => (answer = done)));
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(RATLINGS_KEY);
    picker().shuffle();
    await until(() => expect(picker().roll).toEqual({ kind: "rolled", roll: ROLL }));

    answer(REFUSED);
    await flush();
    expect(picker().roll).toEqual({ kind: "rolled", roll: ROLL });
  });

  it("says when the galaxy's own copies keep the event chain, and offers the option for what it plants", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(LEADER_KEY);
    await until(() => expect(picker().roll?.kind).toBe("rolled"));
    const html = render();
    expect(html).toContain(
      "The Legendary Leader&#x27;s sites are already in this galaxy, so their event chain stays with those.",
    );
    expect(html).toContain("Add its anomalies, dig sites and megastructures");
    expect(html).toContain("4 new systems around -50.00, -20.00");
  });
});

describe("the Special picker in a scenario", () => {
  beforeEach(async () => {
    await openWith(SCENARIO_RESULT);
  });

  it("leaves what each script plants to the game, and shows a DLC as a tag only", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(SEDDOM.layout.key);
    let html = render();
    expect(html).not.toContain("Add its anomalies");
    expect(shown(html)).not.toContain("Comes with");
    expect(shown(html)).not.toContain("Comes without");
    expect(html).not.toContain("Needs Cosmic Storms");
    expect(html.match(/<span class="sp-dlc" title="Cosmic Storms">DLC<\/span>/g)).toHaveLength(2);

    picker().highlight(ARBOREAL.layout.key);
    html = render();
    expect(html).not.toContain("so its events won&#x27;t run");
  });

  it("names a cluster's systems by their layouts, which the game names itself", async () => {
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(RATLINGS_KEY);
    await until(() => expect(picker().roll?.kind).toBe("rolled"));
    expect(shown(render())).toContain("Systems ratling_1_1, ratling_1_2, ratling_1_3");
  });

  it("leaves out the Clusters group when the scenario offers none", async () => {
    mockedIpc.getSpecialClusters.mockResolvedValue([]);
    await openPicker({ x: -50, y: -20 }, { x: 0, y: 0 });
    expect(groupLabels(render())).not.toContain("Clusters");
  });

  it("places a layout at any spot", async () => {
    await openPicker({ x: 3, y: 0 }, { x: 0, y: 0 });
    picker().highlight(METAL.layout.key);
    render();
    expect(drawnButton("Place").disabled).toBe(false);
    drawnButton("Place").onClick();
    await until(() => expect(mockedIpc.addSpecialSystem).toHaveBeenCalledTimes(1));
    expect(mockedIpc.addSpecialSystem.mock.calls[0].slice(1, 4)).toEqual([3, 0, "metal"]);
  });
});
