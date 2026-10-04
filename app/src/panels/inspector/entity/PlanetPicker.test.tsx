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
import { planetPickerTarget } from "../../../store/planetEditAdapter";
import { resetStores } from "../../../store/storeFixture";
import { ANOMALY_PICKER } from "./AnomalyPicker";
import { ConfirmLine } from "./ConfirmLine";
import { DEPOSIT_PICKERS } from "./DepositPicker";
import { MODIFIER_PICKER } from "./ModifierPicker";
import { PlanetPicker } from "./PlanetPicker";

bindStores();

const TARGET = planetPickerTarget(planetPage({ id: 40, class: "pc_barren", size: 12 }), false);

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
