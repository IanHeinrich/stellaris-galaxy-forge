import type { PlanetPage } from "../../../generated/PlanetPage";
import { planetSummary } from "../../../store/fixture";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import type { AnomalyChoice } from "../../../generated/AnomalyChoice";
import type { DepositChoice } from "../../../generated/DepositChoice";
import type { ModifierChoice } from "../../../generated/ModifierChoice";
import { depositRows } from "../../../lib/details/depositPicker";
import { planetPage } from "../../../test/builders";
import { useAnomalyPickerStore } from "../../../store/anomalyPickerStore";
import { bindStores } from "../../../store/bindStores";
import { useDepositPickerStore } from "../../../store/depositPickerStore";
import { useModifierPickerStore } from "../../../store/modifierPickerStore";
import { heldAnomaly, savePickerTarget } from "../../../store/planetEditAdapter";
import { resetStores } from "../../../store/storeFixture";
import { ANOMALY_PICKER } from "./AnomalyPicker";
import { ConfirmLine } from "./ConfirmLine";
import { DEPOSIT_PICKERS } from "./DepositPicker";
import { MODIFIER_PICKER } from "./ModifierPicker";
import { PlanetPicker } from "./PlanetPicker";

/** Save body `page` in system 1, as its page hands it to the pickers. */
const pickerTarget = (page: PlanetPage) =>
  savePickerTarget(
    1,
    planetSummary({ id: page.id, class: page.class, size: page.size }),
    page,
    heldAnomaly(page),
  );

bindStores();

const TARGET = pickerTarget(planetPage({ id: 40, class: "pc_barren", size: 12 }));

const MODIFIERS: ModifierChoice[] = [
  {
    modifier: "mineral_poor",
    feature: "pm_mineral_poor",
    category: "Feature",
    description: null,
    view: {
      key: "pm_mineral_poor",
      name: "Mineral Poor",
      static_modifier: "mineral_poor",
      icon: null,
      icon_frame: null,
      effects: [],
    },
  },
];
const ANOMALIES: AnomalyChoice[] = [
  { key: "asteroid_category", name: "Asteroid in Orbit", level: 2, description: null, usual: true },
];
const DEPOSITS: DepositChoice[] = [
  {
    key: "d_energy_1",
    family: "d_energy",
    amount: 1,
    category: "Energy",
    usual: true,
    description: null,
    event_only: false,
  },
];

beforeEach(() => {
  resetStores();
});

describe("a planet picker", () => {
  it("shows its opener while closed", () => {
    const html = renderToStaticMarkup(<PlanetPicker kind={MODIFIER_PICKER} target={TARGET} />);
    expect(html).toContain("+ Add modifier…");
    expect(html).not.toContain("Search modifiers");
  });

  it("lists the modifiers once open on the body", () => {
    useModifierPickerStore.setState({
      target: TARGET,
      choices: { body: "", list: MODIFIERS },
    });
    const html = renderToStaticMarkup(<PlanetPicker kind={MODIFIER_PICKER} target={TARGET} />);
    expect(html).toContain('aria-label="Search modifiers"');
    expect(html).toContain("Mineral Poor");
    expect(html).toContain("Permanent");
  });

  it("lists the anomaly categories once open on the body", () => {
    useAnomalyPickerStore.setState({
      target: TARGET,
      choices: { body: "", list: ANOMALIES },
    });
    const html = renderToStaticMarkup(<PlanetPicker kind={ANOMALY_PICKER} target={TARGET} />);
    expect(html).toContain('aria-label="Search anomalies"');
    expect(html).toContain("Asteroid in Orbit");
  });

  it("shows the confirm for a deposit add waiting on the game's warnings", () => {
    const [row] = depositRows(DEPOSITS, new Map(), "deposits");
    useDepositPickerStore.setState({
      target: TARGET,
      mode: "deposits",
      choices: { body: "", list: DEPOSITS },
      pending: { row, amount: row.amounts[0], warnings: ["Terraforming stops"] },
    });
    const html = renderToStaticMarkup(
      <PlanetPicker kind={DEPOSIT_PICKERS.deposits} target={TARGET} />,
    );
    expect(html).toContain("Terraforming stops");
    expect(html).toContain("Add anyway");
    expect(html).not.toContain("Remove anyway");
  });

  it("holds a deposit add for the warnings the page hands it", () => {
    const [row] = depositRows(DEPOSITS, new Map(), "deposits");
    useDepositPickerStore.setState({ target: TARGET, mode: "deposits" });
    DEPOSIT_PICKERS.deposits.onAdd(row, 0, () => ["Terraforming stops"]);
    expect(useDepositPickerStore.getState().pending?.warnings).toEqual(["Terraforming stops"]);
  });
});

describe("a picker's rows and card", () => {
  const effect = (text: string) => ({ key: "planet_stability_add", value: 1, text });
  const ROCKY: ModifierChoice = {
    modifier: "rocky_planet",
    feature: null,
    category: "Positive",
    description: "A world of stone.",
    view: {
      key: "rocky_planet",
      name: "Rocky Planet",
      static_modifier: "rocky_planet",
      icon: null,
      icon_frame: null,
      effects: [
        effect("+10% Minerals"),
        effect("+5 Stability"),
        effect("-1 Max Districts"),
        effect("+2 Housing"),
      ],
    },
  };

  it("names a row's first two effects and counts the rest, or says it has none", () => {
    useModifierPickerStore.setState({
      target: TARGET,
      choices: { body: "", list: [ROCKY, ...MODIFIERS] },
    });
    const html = renderToStaticMarkup(<PlanetPicker kind={MODIFIER_PICKER} target={TARGET} />);
    expect(html).toContain(
      '<span class="l2"><span>+10% Minerals, +5 Stability<span class="muted dp-more"> +2 more</span></span></span>',
    );
    expect(html).toContain('<span class="l2"><span class="muted">No effect</span></span>');
  });

  it("shows the lit row's card, which the row names as its description", () => {
    useModifierPickerStore.setState({
      target: TARGET,
      choices: { body: "", list: [ROCKY] },
    });
    const html = renderToStaticMarkup(<PlanetPicker kind={MODIFIER_PICKER} target={TARGET} />);
    expect(html).toMatch(/class="dp-row active" aria-describedby="(mp-row-[^"]+-details)"/);
    expect(html).toMatch(/<div id="mp-row-[^"]+-details" class="dp-card"/);
    expect(html).toContain(
      '<span class="dp-card-name">Rocky Planet</span>' +
        '<span class="dp-card-category muted">Positive</span>' +
        '<ul class="dp-card-effects"><li>+10% Minerals</li><li>+5 Stability</li>' +
        "<li>-1 Max Districts</li><li>+2 Housing</li></ul>" +
        '<span class="dp-card-text">A world of stone.</span></div>',
    );
  });

  it("leaves a card without effects to its name, its category and the missing description", () => {
    useModifierPickerStore.setState({
      target: TARGET,
      choices: { body: "", list: MODIFIERS },
    });
    const html = renderToStaticMarkup(<PlanetPicker kind={MODIFIER_PICKER} target={TARGET} />);
    expect(html).toContain(
      '<span class="dp-card-name">Mineral Poor</span>' +
        '<span class="dp-card-category muted">Features</span>' +
        '<span class="dp-card-text"><span class="muted">No description</span></span></div>',
    );
  });
});

describe("a confirm line", () => {
  it("lists the warnings above its confirm and cancel buttons", () => {
    const html = renderToStaticMarkup(
      <ConfirmLine
        className="pl-dep-confirm"
        warnings={["The station stays"]}
        confirmLabel="Remove anyway"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain("The station stays");
    expect(html).toContain("Remove anyway");
    expect(html).toContain("Cancel");
  });
});
