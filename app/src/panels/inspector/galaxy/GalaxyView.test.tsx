import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LGateModTouch } from "../../../generated/LGateModTouch";
import type { LGateOutcome } from "../../../generated/LGateOutcome";
import type { GalaxySettings } from "../../../generated/GalaxySettings";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { LGATE_OPENED_TITLE, LGATE_TEMPEST_NOTE } from "../../../lib/lgate";
import { bindStores } from "../../../store/bindStores";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useLGateStore } from "../../../store/lgateStore";
import { armSession, resetStores } from "../../../store/storeFixture";
import { drawnBy, drawnButton, drawnField } from "../../../test/drawn";
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

async function open(kind: "save" | "scenario"): Promise<void> {
  const session = useFileSessionStore.getState();
  await (kind === "save"
    ? session.openSave(OPEN_RESULT.path)
    : session.openScenarioFrom(SCENARIO_RESULT.path));
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
