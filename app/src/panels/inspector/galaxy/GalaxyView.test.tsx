import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LGateModTouch } from "../../../generated/LGateModTouch";
import type { LGateOutcome } from "../../../generated/LGateOutcome";
import type { GalaxySettings } from "../../../generated/GalaxySettings";
import type { PreparePreview } from "../../../generated/PreparePreview";
import type { PrepareRow } from "../../../generated/PrepareRow";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { LGATE_OPENED_TITLE, LGATE_TEMPEST_NOTE } from "../../../lib/lgate";
import {
  CLEAR_AROUND_LABEL,
  FAITHFUL_PLAIN,
  lineText,
  NO_FALLEN_EMPIRES,
  NOT_KEPT_CLEAR,
  PREPARE_COPY,
  PREPARE_TITLE,
  PRESET_ANSWERS,
  REROLL_HINT,
} from "../../../lib/prepareCopy";
import { bindStores } from "../../../store/bindStores";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { useLGateStore } from "../../../store/lgateStore";
import {
  PREPARE_ROWS,
  PREPARE_SECTION,
  ringedSystems,
  usePrepareStore,
} from "../../../store/prepareStore";
import { armSession, resetStores } from "../../../store/storeFixture";
import { drawnBy, drawnButton, drawnCheckbox, drawnField } from "../../../test/drawn";
import { openWith } from "../../../test/session";
import { PickerField } from "../../EditField";
import {
  editResult,
  OPEN_RESULT,
  SCENARIO_BYPASSES,
  SCENARIO_RESULT,
  SYSTEMS,
} from "../../../store/fixture";
import { GalaxyView } from "./GalaxyView";
import { SCRIPTS_LINE_TITLE } from "./gameSetup";
import { KALEIDOSCOPE_VALUE } from "./saveSetup";
import { mockedIpc } from "../../../test/ipc";
import { until } from "../../../test/wait";

bindStores();

beforeEach(() => {
  resetStores();
  armSession();
  mockedIpc.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

const galaxy = () => renderToStaticMarkup(<GalaxyView />);

/** Opens the sample save, or takes it as a scenario with the setup screen set aside unless `setup`. */
async function open(kind: "save" | "scenario", setup = false): Promise<void> {
  const session = useFileSessionStore.getState();
  await (kind === "save"
    ? session.openSave(OPEN_RESULT.path)
    : session.openScenarioFrom(SCENARIO_RESULT.path));
  if (kind === "scenario" && !setup) usePrepareStore.setState({ dismissed: true });
}

const modTouch = (mod: string, file: string, what: LGateModTouch["what"]): LGateModTouch => ({
  mod_name: mod,
  file,
  what,
});

describe("the components row", () => {
  const JOIN = /<button type="button" class="link" title="[^"]*">Join<\/button>/;

  it("offers Join while the lanes leave more than one piece, on a save as on a scenario", async () => {
    await open("save");
    expect(galaxy()).toContain(">Components</span><span>2 <button");
    expect(galaxy()).toMatch(JOIN);

    await open("scenario");
    expect(galaxy()).toMatch(JOIN);
  });

  it("leaves the L-Cluster out, since it is cut off on purpose", async () => {
    await open("save");
    useGalaxyStore.getState().applyDelta({
      systems: [{ ...SYSTEMS[5], initializer: "lcluster_1", lanes: [] }],
    });
    const html = galaxy();
    expect(html).toContain(">Components</span><span>1</span>");
    expect(html).not.toMatch(JOIN);
  });

  it("counts the pieces as the galaxy stands, and offers nothing once it is one", async () => {
    await open("save");
    const lane = { to: 0, length: 56, bridge: false, stale: false };
    useGalaxyStore.getState().applyDelta({
      systems: [
        { ...SYSTEMS[0], lanes: [...SYSTEMS[0].lanes, { ...lane, to: 5 }] },
        { ...SYSTEMS[5], lanes: [lane] },
      ],
    });
    const html = galaxy();
    expect(html).toContain(">Components</span><span>1</span>");
    expect(html).not.toMatch(JOIN);
  });
});

describe("the bypasses a scenario places", () => {
  it("counts the drawn ones and says under the bypass rows how many the scripts add", async () => {
    await open("scenario");
    useGameDataStore.setState({ scenarioBypasses: SCENARIO_BYPASSES });

    const html = galaxy();
    expect(html).toContain(">Bypasses</span><span>3</span>");
    const line = html.indexOf(
      `<div class="muted ins-hint ins-setup-note" title="${SCRIPTS_LINE_TITLE.replace("'", "&#x27;")}">Also from scripts: 3 wormhole pairs and 1 gateway placed at random on day one</div>`,
    );
    expect(line).toBeGreaterThan(html.indexOf("Gateways default"));
    expect(line).toBeLessThan(html.indexOf("Hyperlane density"));
  });

  it("says nothing about random ones on a save, whose file states every bypass it has", async () => {
    await open("save");
    useGameDataStore.setState({ scenarioBypasses: SCENARIO_BYPASSES });

    expect(galaxy()).not.toContain("placed at random");
  });
});

describe("the L-Gate outcome", () => {
  const openLGate = (outcome: LGateOutcome, opened = false) =>
    openWith(OPEN_RESULT, { galaxy: { lgate: { outcome, opened } } });

  it("stays hidden behind Reveal until it is clicked, then offers every outcome until hidden", async () => {
    await openLGate("gray_tempest");

    let html = drawnBy(galaxy);
    expect(html).toContain('aria-label="L-Gate"');
    expect(html).toContain(">Reveal</button>");
    expect(html).not.toContain("Gray Tempest");
    expect(html).not.toContain(LGATE_TEMPEST_NOTE);

    drawnButton("Reveal").onClick();
    html = drawnBy(galaxy);
    expect(html).not.toContain(">Reveal</button>");
    expect(html).toContain('aria-label="L-Gate outcome: Gray Tempest"');
    expect(drawnField(PickerField, "L-Gate outcome").items.map((item) => item.label)).toEqual([
      "Gray Tempest",
      "L-Drakes",
      "Dessanu Consonance",
      "Empty cluster",
    ]);

    drawnButton("Hide").onClick();
    expect(galaxy()).not.toContain("Gray Tempest");
  });

  it("applies the outcome picked and shows it once the edit comes back", async () => {
    await openLGate("gray_tempest");
    useLGateStore.getState().reveal();
    expect(drawnBy(galaxy)).toContain(LGATE_TEMPEST_NOTE);

    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], lgate: { outcome: "l_drakes", opened: false } } }),
    );
    drawnField(PickerField, "L-Gate outcome").onPick("l_drakes");
    await until(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetLGateOutcome",
        outcome: "l_drakes",
      }),
    );
    await until(() => expect(useGalaxyStore.getState().lgate?.outcome).toBe("l_drakes"));

    const html = galaxy();
    expect(html).toContain('aria-label="L-Gate outcome: L-Drakes"');
    expect(html).not.toContain(LGATE_TEMPEST_NOTE);
  });

  it("locks the choice once a gate has opened", async () => {
    await openLGate("gray_tempest", true);
    useLGateStore.getState().reveal();

    const html = drawnBy(galaxy);
    expect(drawnField(PickerField, "L-Gate outcome").disabledReason).toBe(LGATE_OPENED_TITLE);
    expect(html).not.toContain(LGATE_TEMPEST_NOTE);
  });

  it("warns under the picker when an enabled mod also touches the outcome, folding past three", async () => {
    await openLGate("gray_tempest");
    useLGateStore.getState().reveal();
    useGameDataStore.setState({
      lgateMods: [
        modTouch("Alpha Mod", "events/alpha.txt", { type: "overrides_roll" }),
        modTouch("Alpha Mod", "events/alpha_2.txt", { type: "sets_flag", flag: "dragon_season" }),
        modTouch("Beta Mod", "events/beta.txt", { type: "overrides_gate_opening" }),
        modTouch("Gamma Mod", "events/gamma.txt", { type: "reads_flag", flag: "l_cluster_opened" }),
        modTouch("Delta Mod", "events/delta.txt", {
          type: "removes_flag",
          flag: "active_gray_goo",
        }),
      ],
    });

    const html = galaxy();
    expect(html).toContain(
      '<div class="edit-note"><span title="events/alpha.txt: overrides the day-one roll (distar.8000); events/alpha_2.txt: sets dragon_season">Alpha Mod also changes the L-Gate outcome, so the game may not follow this choice.</span></div>',
    );
    expect(html).toContain("Beta Mod also changes the L-Gate outcome");
    expect(html).toContain("Gamma Mod also changes the L-Gate outcome");
    expect(html).not.toContain("Delta Mod also changes");
    expect(html).toContain('<div class="edit-note">and 1 more</div>');
  });

  it("says nothing about mods while none of the loaded ones touch the outcome", async () => {
    await openLGate("gray_tempest");
    useLGateStore.getState().reveal();

    expect(galaxy()).not.toContain("also changes the L-Gate outcome");
  });

  it("says nothing when the galaxy has no L-Gate", async () => {
    await open("save");
    expect(galaxy()).not.toContain('aria-label="L-Gate"');
  });
});

describe("what day one rolled and set up", () => {
  /** The 4.4 sample's settings, less the storm devastation, with other scalings. */
  const SETTINGS: GalaxySettings = {
    template: "large",
    shape: "elliptical",
    num_empires: 13,
    num_advanced_empires: 0,
    num_fallen_empires: 3,
    num_marauder_empires: 2,
    num_nomad_empires: 2,
    habitability: 0.25,
    primitive: 0.25,
    resource_abundance: 2,
    num_gateways: 1,
    num_wormhole_pairs: 1,
    num_hyperlanes: 0.75,
    difficulty: "commodore",
    scaling: "scaling_off",
    ironman: false,
    core_radius: 112.5,
    crisis_type: "all",
    crises: 5,
    mid_game_start: 150,
    end_game_start: 225,
    victory_year: 1050,
    cosmic_storm_early_game_spawn_chance_scale: 1,
    cosmic_storm_mid_game_spawn_chance_scale: 5,
    cosmic_storm_late_game_spawn_chance_scale: 1,
    cosmic_storm_early_game_spawn_max_cap: 2,
    cosmic_storm_mid_game_spawn_max_cap: 5,
    cosmic_storm_late_game_spawn_max_cap: 8,
    cosmic_storm_spawn_cooldown_scale: 1,
    cosmic_storm_devastation: null,
    voidworms_scaling: 1,
    cutholoids_scaling: 0.5,
    fallen_empire_strength_scale: 2,
  };

  it("says the Kaleidoscope will appear only when the roll set its flag", async () => {
    await openWith(OPEN_RESULT, { galaxy: { kaleidoscope: true } });
    expect(galaxy()).toContain(`>Kaleidoscope</span><span>${KALEIDOSCOPE_VALUE}</span>`);

    await openWith(OPEN_RESULT);
    expect(galaxy()).not.toContain(">Kaleidoscope<");
  });

  it("lists the settings the game keeps reading, read-only, and skips a key the save lacks", async () => {
    await openWith(OPEN_RESULT, { galaxy: { settings: SETTINGS } });
    const html = galaxy();
    for (const [label, value] of [
      ["Crisis", "All · 5×"],
      ["Mid-game year", "2350"],
      ["End-game year", "2425"],
      ["Victory year", "3250"],
      ["Cosmic storm chance (early · mid · late)", "1× · 5× · 1×"],
      ["Cosmic storm cap (early · mid · late)", "2 · 5 · 8"],
      ["Cosmic storm cooldown", "1×"],
      ["Voidworm scaling", "1×"],
      ["Cutholoid scaling", "0.5×"],
      ["Fallen empire strength", "2×"],
    ]) {
      expect(html).toContain(`>${label}</span><span>${value}</span>`);
    }
    expect(html).not.toContain("Cosmic storm devastation");
    expect(html).not.toContain("<input");
  });

  it("shows no setup on a scenario's page beyond its header grid", async () => {
    await open("scenario");
    expect(galaxy()).not.toContain("Victory year");
  });
});

describe("the Prepare section", () => {
  const enclaves = PREPARE_COPY.plain.enclaves;

  /** A preview in which only the rows named hold systems. */
  function previewOf(
    filled: Partial<Record<PrepareRow, number[]>>,
    beside: Partial<PreparePreview> = {},
  ): PreparePreview {
    return {
      profile: "plain",
      rows: PREPARE_ROWS.map((row) => ({ row, systems: filled[row] ?? [] })),
      changes: 0,
      kept_clear: [],
      cut_off: [],
      new_seats: [],
      new_zones: [],
      ...beside,
    };
  }

  it("shows only on a scenario, with the preset's line and the rows open under Row by row", async () => {
    await open("save");
    expect(galaxy()).not.toContain(PREPARE_TITLE);

    await open("scenario");
    await until(() => expect(useInspectorStore.getState().sections[PREPARE_SECTION]).toBe(false));
    let html = drawnBy(galaxy);
    expect(html).toContain("Load the game data to sort this scenario&#x27;s systems into rows.");
    expect(html).toContain(PRESET_ANSWERS.faithful.replace("'", "&#x27;"));
    const preset = html.slice(
      html.indexOf('class="prep-preset"'),
      html.indexOf('class="prep-option"'),
    );
    expect(preset).not.toContain("prep-tag");
    expect(html).toContain(FAITHFUL_PLAIN);
    expect(html).toContain('<button type="button" class="prep-disclosure" aria-expanded="true">');
    for (const row of PREPARE_ROWS.filter((row) => row !== "sol")) {
      expect(drawnField(PickerField, `${PREPARE_COPY.plain[row].label} choice`)).toBeDefined();
    }
    expect(html).not.toContain(">Sol<");
    expect(drawnCheckbox().checked).toBe(true);
    expect(drawnButton("Apply").disabled).toBe(true);

    const items = drawnField(PickerField, `${enclaves.label} choice`).items;
    expect(items.map((item) => item.label)).toEqual([
      "Keep as is",
      "Normal systems",
      "Let the game roll",
    ]);
    expect(renderToStaticMarkup(<>{items[2].note}</>)).toBe(
      `<div class="prep-choice-line"><span class="prep-tag game">The game</span> ${enclaves.answers.game_decides!.text as string}</div>`,
    );
    drawnField(PickerField, `${enclaves.label} choice`).onPick("plain");
    expect(usePrepareStore.getState().choices.enclaves).toBe("plain");

    drawnButton("Row by row").onClick();
    html = drawnBy(galaxy);
    expect(html).toContain('class="prep-disclosure" aria-expanded="false"');
    expect(() => drawnField(PickerField, `${enclaves.label} choice`)).toThrow();
    expect(html).toContain("Custom: Keep everything with 1 row changed.");
  });

  it("says under every row with systems what its choice does, Keep as is included", async () => {
    await open("scenario");
    usePrepareStore.setState({
      preview: previewOf({ wormhole_pairs: [5, 6], ordinary_systems: [1, 2, 3] }),
      current: true,
    });
    const html = galaxy();
    const regular = PREPARE_COPY.plain.ordinary_systems.answers.keep!;
    expect(html).toContain(
      `<span class="prep-tag forge">Galaxy Forge</span> ${lineText(regular.text, 3)}</div>`,
    );
    expect(html).toContain(lineText(PREPARE_COPY.plain.wormhole_pairs.answers.keep!.text, 2));
    expect(html.split('class="muted prep-note"').length - 1).toBe(2);
  });

  it("says under a changed row what the new game gets, and counts what Apply changes", async () => {
    await open("scenario");
    usePrepareStore.setState({
      choices: { ...usePrepareStore.getState().choices, enclaves: "game_decides" },
      preview: previewOf({ enclaves: [3, 4] }, { changes: 2 }),
      current: false,
    });
    expect(drawnBy(galaxy)).toContain("Counting the changes…");
    expect(drawnButton("Apply").disabled).toBe(true);

    usePrepareStore.setState({ current: true });
    const html = drawnBy(galaxy);
    expect(html).toContain(
      `<span class="prep-tag game">The game</span> ${enclaves.answers.game_decides!.text as string}</div>`,
    );
    expect(html).toContain("Changes 2 systems. One step to undo.");
    expect(html).not.toMatch(/left out/i);
    expect(drawnButton("Apply").disabled).toBe(false);
    // Guardians hold no system here, so they take no line.
    expect(html.split('class="muted prep-note"').length - 1).toBe(1);

    useInspectorStore.getState().closeSection(PREPARE_SECTION);
    const closed = galaxy();
    expect(closed).toContain(`<span class="ins-sec-title">${PREPARE_TITLE}</span>`);
    expect(closed).toContain('<span class="ins-sec-aside" title="Custom · changes 2 systems">');
  });

  it("shows the hovered row's card: what it holds and every choice's tag and line", async () => {
    await open("scenario");
    usePrepareStore.setState({
      preview: previewOf({ guardians: [3, 4] }),
      current: true,
      rowsOpen: true,
    });
    expect(galaxy()).not.toContain('id="prep-card"');
    usePrepareStore.getState().hover("guardians");
    const html = galaxy();
    const card = html.slice(html.indexOf('id="prep-card"'));
    expect(html).toContain('id="prep-row-guardians"');
    expect(card).toContain(PREPARE_COPY.plain.guardians.holds);
    expect(card).toContain("These 2 spawn where they are now.");
    expect(card).toContain('Keep as is<span class="muted"> · current</span>');
    expect(card).toContain("Normal systems");
    expect(card).toContain("Let the game roll");
    expect(card.split("prep-tag").length - 1).toBe(3);
    expect(card).not.toMatch(/Decided by|Shown here|New game:/);
  });

  it("disables Fallen empires on a plain map and says why", async () => {
    await open("scenario");
    usePrepareStore.setState({ preview: previewOf({ fallen_empires: [9] }), rowsOpen: true });
    drawnBy(galaxy);
    expect(drawnField(PickerField, "Fallen empires choice").disabledReason).toBe(NO_FALLEN_EMPIRES);

    usePrepareStore.setState({
      preview: previewOf({ fallen_empires: [9] }, { profile: "paint_a_galaxy" }),
    });
    drawnBy(galaxy);
    expect(drawnField(PickerField, "Fallen empires choice").disabledReason).toBeUndefined();
  });

  it("shows Sol only when the map has one, and a UNE seat only on a Paint a Galaxy map", async () => {
    await open("scenario");
    usePrepareStore.setState({ preview: previewOf({ sol: [7] }), current: true, rowsOpen: true });
    drawnBy(galaxy);
    const sol = drawnField(PickerField, "Sol choice");
    expect(sol.items.map((item) => item.label)).toEqual([
      "Keep as is",
      "Normal system",
      "Pre-FTL Earth",
      "Let the game roll",
    ]);

    usePrepareStore.setState({ preview: previewOf({ sol: [7] }, { profile: "paint_a_galaxy" }) });
    drawnBy(galaxy);
    expect(drawnField(PickerField, "Sol choice").items.map((item) => item.label)).toContain(
      "United Nations of Earth start",
    );
  });

  it("counts what keeping threats away turns into normal systems, and shows both states on hover", async () => {
    await open("scenario");
    usePrepareStore.setState({
      preview: previewOf({ guardians: [3, 4] }, { kept_clear: [3, 5, 6], changes: 2 }),
      current: true,
    });
    const on = drawnBy(galaxy);
    expect(on).toContain(`<span>${CLEAR_AROUND_LABEL}</span><span class="muted">3 systems</span>`);
    expect(on).not.toContain("Turns the");
    expect(on).not.toContain(NOT_KEPT_CLEAR.text as string);
    expect(on).not.toContain('id="prep-card"');

    usePrepareStore.getState().hover("clear_around");
    const hovered = galaxy();
    const card = hovered.slice(hovered.indexOf('id="prep-card"'));
    expect(card).toContain(CLEAR_AROUND_LABEL);
    expect(card).toContain('On<span class="muted"> · current</span>');
    expect(card).toContain(
      '<span class="prep-tag forge">Galaxy Forge</span> Turns the 3 systems within 2 jumps',
    );
    expect(card).toContain(
      `<span class="prep-tag game">The game</span> ${NOT_KEPT_CLEAR.text as string}`,
    );
    expect(ringedSystems(usePrepareStore.getState())).toEqual([3, 5, 6]);

    drawnCheckbox().onChange();
    expect(usePrepareStore.getState().options.clear_around_seats).toBe(false);
    const off = galaxy();
    expect(off).not.toContain('<span class="muted">3 systems</span>');
    expect(off).toContain('Off<span class="muted"> · current</span>');
    expect(off.split(NOT_KEPT_CLEAR.text as string).length - 1).toBe(1);
    usePrepareStore.getState().hover(null);
    usePrepareStore.getState().setClearAroundSeats(true);
  });

  it("offers Reroll while a row draws new seats or zones", async () => {
    await open("scenario");
    expect(galaxy()).not.toContain(REROLL_HINT);
    usePrepareStore.setState({
      choices: { ...usePrepareStore.getState().choices, empire_seats: "random_seats" },
    });
    expect(drawnBy(galaxy)).toContain(REROLL_HINT);
    const { seed } = usePrepareStore.getState().options;
    drawnButton("Reroll").onClick();
    expect(usePrepareStore.getState().options.seed).not.toBe(seed);
  });

  it("warns under Wormhole pairs when taking them out cuts systems off", async () => {
    await open("scenario");
    usePrepareStore.setState({
      choices: { ...usePrepareStore.getState().choices, wormhole_pairs: "none" },
      preview: previewOf(
        { wormhole_pairs: [5, 6], empire_seats: [8] },
        { cut_off: [6, 7, 8], changes: 2 },
      ),
      current: true,
    });
    expect(galaxy()).toContain(
      "Taking these pairs out cuts 3 systems off from the rest of the map, including a starting position.",
    );
  });
});

describe("the setup screen", () => {
  it("shows only Prepare and its footer for a scenario just taken from a save", async () => {
    await open("scenario", true);
    const html = drawnBy(galaxy);
    expect(html).toContain('<div class="prep-setup">');
    expect(html).toContain(`<div class="prep-setup-title">${PREPARE_TITLE} <button`);
    expect(html).not.toContain('class="ins-sec"');
    expect(html).not.toContain(">Components<");
    expect(html).toContain(">Apply</button>");
    expect(html.indexOf('class="prep-footer"')).toBeGreaterThan(html.indexOf('class="prep"'));

    drawnButton("Not now").onClick();
    const page = galaxy();
    expect(page).not.toContain("prep-setup");
    expect(page).toContain(">Components<");
    expect(page).toContain(`<span class="ins-sec-title">${PREPARE_TITLE}</span>`);
    expect(useInspectorStore.getState().sections[PREPARE_SECTION]).toBe(true);
  });

  it("comes back when undo takes the Apply back", async () => {
    await open("scenario", true);
    usePrepareStore.setState({
      applied: { preset: "faithful", changed: 3, seq: 4 },
    });
    expect(galaxy()).not.toContain("prep-setup");
    usePrepareStore.getState().followHistory([]);
    expect(galaxy()).toContain('<div class="prep-setup">');
  });
});
