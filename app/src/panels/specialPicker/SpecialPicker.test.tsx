import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import type { PickSummary } from "../../generated/PickSummary";
import { pickSummary as summary } from "../../test/builders";
import type { SpecialLayout } from "../../generated/SpecialLayout";
import type { SpecialPick } from "../../generated/SpecialPick";
import { bindStores } from "../../store/bindStores";
import { editResult, OPEN_RESULT } from "../../store/fixture";
import { useGameDataStore } from "../../store/gameDataStore";
import { useGeneratorStore } from "../../store/generatorStore";
import { useSpecialPickerStore } from "../../store/specialPickerStore";
import { armSession, resetStores } from "../../store/storeFixture";
import { drawnBrowseKeys, drawnButton, drawnBy, drawnCheckbox, lastDrawn } from "../../test/drawn";
import { shown } from "../../test/elements";
import { mockedIpc } from "../../test/ipc";
import { stubPrefs } from "../../test/prefs";
import { openWith } from "../../test/session";
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

const picker = () => useSpecialPickerStore.getState();
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
  useGeneratorStore.setState({ picks: { random: summary(), star_classes: [], special: PICKS } });
  mockedIpc.addSpecialSystem.mockResolvedValue(editResult({ delta: { systems: [] } }));
});

describe("the Special picker", () => {
  it("draws nothing until Special… opens it", () => {
    expect(render()).toBe("");
  });

  it("opens beside the right-clicked point with no scrim", () => {
    picker().openAt({ x: -50, y: -20 }, { x: 400, y: 300 });
    const html = render();
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-label="Add a special system"/);
    expect(html).not.toContain("browse-scrim");
    expect(html).toContain("New system at -50.00, -20.00");
  });

  it("groups the layouts, pinned and recent first, each group in label order", () => {
    useSpecialPickerStore.setState({ pinned: ["metal"], recent: ["ring", "gone"] });
    picker().openAt({ x: -50, y: -20 }, { x: 0, y: 0 });
    const html = render();

    expect(groupLabels(html)).toEqual([
      "All",
      "Pinned",
      "Recent",
      "Unique systems",
      "Other special systems",
      "Alpha Mod",
      "Zeta Mod",
    ]);
    expect(shown(html)).toContain("All 6");
    expect(rowKeys(html)).toEqual([
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
  });

  it("filters the rows by name", () => {
    picker().openAt({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().setQuery("  WOR ");
    expect(rowKeys(render())).toEqual(["wooden"]);
    picker().setQuery("nothing like it");
    expect(render()).toContain("Nothing matches that search.");
  });

  it("marks a layout already in the galaxy, a DLC the save has and one it lacks", () => {
    picker().openAt({ x: -50, y: -20 }, { x: 0, y: 0 });
    const html = render();
    expect(html.match(/aria-label="Already in this galaxy"/g)).toHaveLength(1);
    expect(html).toContain('<span class="sp-dlc" title="Cosmic Storms">DLC</span>');
    expect(html).toContain("Needs Cosmic Storms, which this save doesn&#x27;t have");
  });

  it("shows the option only for a layout that comes with something", () => {
    picker().openAt({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(SEDDOM.layout.key);
    let html = render();
    expect(html).toContain("Add its anomalies, dig sites and megastructures");
    expect(shown(html)).toContain("Comes with Breachsealer");
    expect(shown(html)).toContain("Comes without debris, wrecks and storms");

    picker().highlight(METAL.layout.key);
    html = render();
    expect(html).not.toContain("Add its anomalies");
  });

  it("says when the galaxy's own copy keeps the event chain, and what is not added", () => {
    picker().openAt({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(SOL.layout.key);
    const html = render();
    expect(html).toContain(
      "Sol is already in this galaxy, so its event chain stays with that one.",
    );
    expect(shown(html)).toContain("Comes without a pre-FTL civilisation");
  });

  it("places the highlighted layout at the point and closes, noting it as recent", async () => {
    picker().openAt({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(METAL.layout.key);
    render();
    drawnButton("Place").onClick();

    await until(() => expect(picker().open).toBe(false));
    const [seed, x, y, key, extras] = mockedIpc.addSpecialSystem.mock.calls[0];
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect([x, y, key, extras]).toEqual([-50, -20, "metal", true]);
    expect(picker().recent).toEqual(["metal"]);
  });

  it("places on Enter and on a double click", async () => {
    picker().openAt({ x: -50, y: -20 }, { x: 0, y: 0 });
    picker().highlight(METAL.layout.key);
    press("Enter");
    await until(() => expect(mockedIpc.addSpecialSystem).toHaveBeenCalledTimes(1));

    picker().openAt({ x: -50, y: -20 }, { x: 0, y: 0 });
    render();
    (
      lastDrawn(({ props }) => props.id === "sp-row-metal", "the row") as { onDoubleClick(): void }
    ).onDoubleClick();
    await until(() => expect(mockedIpc.addSpecialSystem).toHaveBeenCalledTimes(2));
  });

  it("sends the option to the add, lists the plantings as left out without it, and remembers it", async () => {
    picker().openAt({ x: -50, y: -20 }, { x: 0, y: 0 });
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
    expect(mockedIpc.addSpecialSystem.mock.calls[0].slice(1)).toEqual([
      -50,
      -20,
      "breachsealer_system",
      false,
    ]);
  });

  it("shows why a refused point can't take a system, and won't place there", () => {
    picker().openAt({ x: 3, y: 0 }, { x: 0, y: 0 });
    picker().highlight(METAL.layout.key);
    const html = render();
    expect(html).toMatch(/Too close to [^<]+: 3 away, the game needs 10/);
    expect(drawnButton("Place").disabled).toBe(true);

    press("Enter");
    expect(mockedIpc.addSpecialSystem).not.toHaveBeenCalled();
  });
});
